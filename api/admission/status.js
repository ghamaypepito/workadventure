const { withRedis } = require('../_lib/redis');
const { REDIS_URL } = require('../_lib/admin');

const PENDING_KEY = 'wa:pending-admission';

module.exports = async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    const url = new URL(req.url, `http://${req.headers.host}`);
    const requestId = url.searchParams.get('requestId');
    if (!requestId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing requestId' }));
        return;
    }

    try {
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
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
};
