const { requireUser } = require('../_lib/requireUser');
const { withRedis } = require('../_lib/redis');
const { REDIS_URL } = require('../_lib/admin');

const PENDING_KEY = 'wa:pending-admission';
const MAX_AGE_MS = 10 * 60 * 1000; // ignore stale requests older than 10 minutes

module.exports = async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    const user = await requireUser(req, res);
    if (!user) return;

    try {
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
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
};
