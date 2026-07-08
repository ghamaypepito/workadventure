const { requireAdmin } = require('../_lib/requireAdmin');
const { readJsonBody } = require('../_lib/readBody');
const { withRedis } = require('../_lib/redis');
const { ADMINS_KEY, APPROVED_KEY, PENDING_KEY, REDIS_URL } = require('../_lib/admin');

module.exports = async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    res.setHeader('Content-Type', 'application/json');

    const { email } = await readJsonBody(req);
    if (!email) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'email is required' }));
        return;
    }
    const normalized = String(email).toLowerCase();

    try {
        await withRedis(REDIS_URL, async (client) => {
            await client.command('SADD', ADMINS_KEY, normalized);
            await client.command('SADD', APPROVED_KEY, normalized);
            await client.command('HDEL', PENDING_KEY, normalized);
        });
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
};
