const crypto = require('crypto');
const { requireUser } = require('../_lib/requireUser');
const { withRedis } = require('../_lib/redis');
const { REDIS_URL } = require('../_lib/admin');
const { listKnownMembers, heartbeat, setLastRoom, getLastRoom } = require('../_lib/presence');
const { fetchWam, resolveRoomCoordinates } = require('../_lib/mapStorage');

const PENDING_KEY = 'wa:pending-admission';
const MAX_AGE_MS = 10 * 60 * 1000; // ignore stale requests older than 10 minutes
const CHAT_HISTORY_DEFAULT_LIMIT = 50; // messages per page when the client doesn't specify a limit
const CHAT_HISTORY_MAX_LIMIT = 200; // hard cap per single page request
const IDENTITY_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days; refreshed on every login

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
    if (parsed === null || !parsed.targetEmail) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing name or targetEmail' }));
        return;
    }
    const requestId = crypto.randomBytes(12).toString('hex');

    await withRedis(REDIS_URL, async (client) => {
        await client.command(
            'HSET',
            PENDING_KEY,
            requestId,
            JSON.stringify({
                name: parsed.name || 'Guest',
                target: parsed.targetEmail.toLowerCase(),
                ts: Date.now(),
                status: 'pending',
            }),
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

    if (data.status !== 'approved') {
        res.statusCode = 200;
        res.end(JSON.stringify({ status: data.status }));
        return;
    }

    // Once the waiting client has seen "approved", consume the entry so it can't be reused.
    await withRedis(REDIS_URL, async (client) => {
        await client.command('HDEL', PENDING_KEY, requestId);
    });

    let coords = null;
    if (data.room) {
        const wam = await fetchWam();
        coords = resolveRoomCoordinates(wam, data.room);
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'approved', x: coords ? coords.x : null, y: coords ? coords.y : null }));
}

// Requires a signed-in (non-guest) user. Only returns requests targeted at this caller
// (previously returned every pending request to every recognized user).
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
            if (
                data.status === 'pending' &&
                Date.now() - data.ts < MAX_AGE_MS &&
                data.target === user.email.toLowerCase()
            ) {
                requests.push({ requestId, name: data.name, ts: data.ts });
            }
        } catch {
            // skip malformed entry
        }
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ requests }));
}

// Requires a signed-in (non-guest) user. Optionally records the approver's current room
// (their client passes its locally-tracked zone, see admission-script.html) so the guest
// can be spawned into the same room/area as whoever let them in.
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
        if (parsed.room) data.room = parsed.room;
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

// Requires a signed-in (non-guest) user. Registers this WA player uuid -> SSO email for the
// current session, so chat history (keyed client-side by WA uuid, which is only stable per
// browser) can be resolved server-side to the account's email, which is stable across devices.
async function identity(req, res) {
    const user = await requireUser(req, res);
    if (!user) return;

    const parsed = await readBody(req);
    if (parsed === null || !parsed.uuid) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing uuid' }));
        return;
    }

    await withRedis(REDIS_URL, async (client) => {
        await client.command('SET', `wa:uuid-email:${parsed.uuid}`, user.email, 'EX', String(IDENTITY_TTL_SECONDS));
    });

    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
}

// No auth required: guests need this to populate the "who are you here to see?" picker
// before they have any session at all.
async function knownMembers(req, res) {
    const members = await listKnownMembers();
    res.statusCode = 200;
    res.end(JSON.stringify({ members }));
}

// Requires a signed-in (non-guest) user. Called periodically by their client to stay
// "Active now" in the known-members list (see PRESENCE_TTL_SECONDS in presence.js).
async function heartbeatRoute(req, res) {
    const user = await requireUser(req, res);
    if (!user) return;
    await heartbeat(user.email);
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
}

// Requires a signed-in (non-guest) user. Persists their current named zone so it can be
// restored as their spawn point next login, instead of always showing the seat-picker.
async function roomPost(req, res) {
    const user = await requireUser(req, res);
    if (!user) return;

    const parsed = await readBody(req);
    if (parsed === null || !parsed.room) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing room' }));
        return;
    }

    await setLastRoom(user.email, parsed.room);
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
}

// Requires a signed-in (non-guest) user. Returns their persisted last room, resolved to
// teleport-target coordinates via the current map (so a rename/move of the room since
// they last logged out doesn't silently teleport them to a stale position).
async function roomGet(req, res) {
    const user = await requireUser(req, res);
    if (!user) return;

    const room = await getLastRoom(user.email);
    if (!room) {
        res.statusCode = 200;
        res.end(JSON.stringify({ room: null, x: null, y: null }));
        return;
    }

    const wam = await fetchWam();
    const coords = resolveRoomCoordinates(wam, room);
    if (!coords) {
        // The room was renamed or removed since this user last logged out.
        res.statusCode = 200;
        res.end(JSON.stringify({ room: null, x: null, y: null }));
        return;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ room, x: coords.x, y: coords.y }));
}

// Resolves a conversation key built from WA player uuids (e.g. "uuidA|uuidB") into one built from
// the accounts' emails where known, falling back to the raw uuid for any segment that has no
// registered mapping (e.g. a guest, or a user who hasn't triggered identity registration yet).
// Sorted again after resolution so the key stays canonical regardless of segment order.
async function resolveConversationKey(rawKey) {
    const segments = rawKey.split('|').filter(Boolean);
    const resolved = await withRedis(REDIS_URL, async (client) => {
        const emails = [];
        for (const segment of segments) {
            const email = await client.command('GET', `wa:uuid-email:${segment}`);
            emails.push(email || segment);
        }
        return emails;
    });
    return Array.from(new Set(resolved)).sort().join('|');
}

// Requires a signed-in (non-guest) user: only real users' messages are persisted, and only
// real users can read history back (guests never see or contribute to saved history).
async function chatHistoryGet(req, res) {
    const user = await requireUser(req, res);
    if (!user) return;

    const url = new URL(req.url, `http://${req.headers.host}`);
    const room = url.searchParams.get('room');
    if (!room) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing room' }));
        return;
    }
    const offset = Math.max(0, parseInt(url.searchParams.get('offset'), 10) || 0);
    const limit = Math.min(
        CHAT_HISTORY_MAX_LIMIT,
        Math.max(1, parseInt(url.searchParams.get('limit'), 10) || CHAT_HISTORY_DEFAULT_LIMIT),
    );

    const key = `wa:chat:${await resolveConversationKey(room)}`;
    const { raw, total } = await withRedis(REDIS_URL, async (client) => {
        const raw = await client.command('LRANGE', key, String(offset), String(offset + limit - 1));
        const total = await client.command('LLEN', key);
        return { raw, total: parseInt(total, 10) || 0 };
    });

    const messages = (raw || [])
        .map((entry) => {
            try {
                return JSON.parse(entry);
            } catch {
                return null;
            }
        })
        .filter(Boolean)
        .reverse();

    res.statusCode = 200;
    res.end(JSON.stringify({ messages, hasMore: offset + (raw || []).length < total }));
}

async function chatHistoryPost(req, res) {
    const user = await requireUser(req, res);
    if (!user) return;

    const parsed = await readBody(req);
    if (parsed === null || !parsed.room || !parsed.message) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing room or message' }));
        return;
    }

    const entry = JSON.stringify({
        author: parsed.author || user.name || user.email,
        message: String(parsed.message).slice(0, 4000),
        ts: Date.now(),
    });

    const key = `wa:chat:${await resolveConversationKey(parsed.room)}`;

    // No LTRIM here on purpose: history is kept in full, from the first message onward.
    await withRedis(REDIS_URL, async (client) => {
        await client.command('LPUSH', key, entry);
    });

    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
}

module.exports = async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    // Read the sub-path directly from the URL rather than req.query: Vercel's catch-all
    // query key comes through as the literal bracket syntax (e.g. "...admissionPath"),
    // not the clean param name, so parsing the pathname ourselves is more robust.
    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
    const segment = pathname.split('/').filter(Boolean).pop();

    try {
        if (segment === 'request') {
            await request(req, res);
        } else if (segment === 'status') {
            await status(req, res);
        } else if (segment === 'pending') {
            await pending(req, res);
        } else if (segment === 'approve') {
            await approve(req, res);
        } else if (segment === 'chat-history') {
            if (req.method === 'POST') await chatHistoryPost(req, res);
            else await chatHistoryGet(req, res);
        } else if (segment === 'identity') {
            await identity(req, res);
        } else if (segment === 'known-members') {
            await knownMembers(req, res);
        } else if (segment === 'heartbeat') {
            await heartbeatRoute(req, res);
        } else if (segment === 'room') {
            if (req.method === 'POST') await roomPost(req, res);
            else await roomGet(req, res);
        } else {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'Not found' }));
        }
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
};
