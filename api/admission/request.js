const crypto = require('crypto');
const { withRedis } = require('../_lib/redis');
const { REDIS_URL } = require('../_lib/admin');

const PENDING_KEY = 'wa:pending-admission';

module.exports = async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    let body = '';
    for await (const chunk of req) body += chunk;
    let name;
    try {
        ({ name } = JSON.parse(body || '{}'));
    } catch {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
    }

    const requestId = crypto.randomBytes(12).toString('hex');

    try {
        await withRedis(REDIS_URL, async (client) => {
            await client.command(
                'HSET',
                PENDING_KEY,
                requestId,
                JSON.stringify({ name: name || 'Guest', ts: Date.now(), status: 'pending' }),
            );
        });

        res.statusCode = 200;
        res.end(JSON.stringify({ requestId }));
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
};
