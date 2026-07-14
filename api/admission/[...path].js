const crypto = require('crypto');
const { requireUser } = require('../_lib/requireUser');
const { withRedis } = require('../_lib/redis');
const { REDIS_URL } = require('../_lib/admin');

const PENDING_KEY = 'wa:pending-admission';
const MAX_AGE_MS = 10 * 60 * 1000; // ignore stale requests older than 10 minutes

async function readBody(req) {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
        return JSON.parse(body || '{}');
    } catch {
        return null;
    }
}

// No auth required: called by a guest who has no session at all.
async function request(req, res) {
    const parsed = await readBody(req);
    if (parsed === null) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
    }
    const requestId = crypto.randomBytes(12).toString('hex');

    await withRedis(REDIS_URL, async (client) => {
        await client.command(
            'HSET',
            PENDING_KEY,
            requestId,
            JSON.stringify({ name: parsed.name || 'Guest', ts: Date.now(), status: 'pending' }),
        );
    });

    res.statusCode = 200;
    res.end(JSON.stringify({ requestId }));
}

// No auth required: the waiting guest polls this.
async function status(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const requestId = url.searchParams.get('requestId');
    if (!requestId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing requestId' }));
        return;
    }

    const raw = await withRedis(REDIS_URL, async (client) => {
        return client.command('HGET', PENDING_KEY, requestId);
    });

    if (!raw) {
        res.statusCode = 200;
        res.end(JSON.stringify({ status: 'not_found' }));
        return;
    }

    const data = JSON.parse(raw);

    // Once the waiting client has seen "approved", consume the entry so it can't be reused.
    if (data.status === 'approved') {
        await withRedis(REDIS_URL, async (client) => {
            await client.command('HDEL', PENDING_KEY, requestId);
        });
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ status: data.status }));
}

// Requires a signed-in (non-guest) user.
async function pending(req, res) {
    const user = await requireUser(req, res);
    if (!user) return;

    const raw = await withRedis(REDIS_URL, async (client) => {
        return client.command('HGETALL', PENDING_KEY);
    });

    const requests = [];
    for (let i = 0; i < raw.length; i += 2) {
        const requestId = raw[i];
        try {
            const data = JSON.parse(raw[i + 1]);
            if (data.status === 'pending' && Date.now() - data.ts < MAX_AGE_MS) {
                requests.push({ requestId, name: data.name, ts: data.ts });
            }
        } catch {
            // skip malformed entry
        }
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ requests }));
}

// Requires a signed-in (non-guest) user.
async function approve(req, res) {
    const user = await requireUser(req, res);
    if (!user) return;

    const parsed = await readBody(req);
    if (parsed === null || !parsed.requestId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing requestId' }));
        return;
    }

    const updated = await withRedis(REDIS_URL, async (client) => {
        const raw = await client.command('HGET', PENDING_KEY, parsed.requestId);
        if (!raw) return false;
        const data = JSON.parse(raw);
        data.status = 'approved';
        data.approvedBy = user.email;
        await client.command('HSET', PENDING_KEY, parsed.requestId, JSON.stringify(data));
        return true;
    });

    if (!updated) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Request not found (may have expired or already been handled)' }));
        return;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
}

module.exports = async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    const segment = Array.isArray(req.query.path) ? req.query.path[0] : req.query.path;

    try {
        if (segment === 'request') {
            await request(req, res);
        } else if (segment === 'status') {
            await status(req, res);
        } else if (segment === 'pending') {
            await pending(req, res);
        } else if (segment === 'approve') {
            await approve(req, res);
        } else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
};
