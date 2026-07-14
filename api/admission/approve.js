const { requireUser } = require('../_lib/requireUser');
const { withRedis } = require('../_lib/redis');
const { REDIS_URL } = require('../_lib/admin');

const PENDING_KEY = 'wa:pending-admission';

module.exports = async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    const user = await requireUser(req, res);
    if (!user) return;

    let body = '';
    for await (const chunk of req) body += chunk;
    let requestId;
    try {
        ({ requestId } = JSON.parse(body || '{}'));
    } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
    }
    if (!requestId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing requestId' }));
        return;
    }

    try {
        const updated = await withRedis(REDIS_URL, async (client) => {
            const raw = await client.command('HGET', PENDING_KEY, requestId);
            if (!raw) return false;
            const data = JSON.parse(raw);
            data.status = 'approved';
            data.approvedBy = user.email;
            await client.command('HSET', PENDING_KEY, requestId, JSON.stringify(data));
            return true;
        });

        if (!updated) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Request not found (may have expired or already been handled)' }));
            return;
        }

        res.statusCode = 200;
        res.end(JSON.stringify({ success: true }));
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
};
