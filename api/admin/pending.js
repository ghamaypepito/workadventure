const { requireAdmin } = require('../_lib/requireAdmin');
const { withRedis } = require('../_lib/redis');
const { ADMINS_KEY, APPROVED_KEY, PENDING_KEY, REDIS_URL } = require('../_lib/admin');

module.exports = async (req, res) => {
    const admin = await requireAdmin(req, res);
    if (!admin) return;

    res.setHeader('Content-Type', 'application/json');

    try {
        const data = await withRedis(REDIS_URL, async (client) => {
            const pendingRaw = await client.command('HGETALL', PENDING_KEY);
            const pending = [];
            for (let i = 0; i < pendingRaw.length; i += 2) {
                try {
                    pending.push(JSON.parse(pendingRaw[i + 1]));
                } catch {
                    // skip malformed entry
                }
            }

            const approved = (await client.command('SMEMBERS', APPROVED_KEY)) || [];
            const admins = (await client.command('SMEMBERS', ADMINS_KEY)) || [];

            return { pending, approved, admins };
        });

        res.statusCode = 200;
        res.end(JSON.stringify(data));
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
};
