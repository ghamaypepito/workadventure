const { requireAdmin } = require('../_lib/requireAdmin');
const { readJsonBody } = require('../_lib/readBody');
const { withRedis } = require('../_lib/redis');
const { ADMINS_KEY, APPROVED_KEY, PENDING_KEY, REDIS_URL } = require('../_lib/admin');

// Fully removes an approved user's access to the map (and, if they were an admin, their admin
// rights too - a revoked user has no business staying in the admins set). Refuses to remove the
// last remaining admin so the admin panel itself can't be locked out.
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
            const isAdmin = (await client.command('SISMEMBER', ADMINS_KEY, normalized)) === '1';
            if (isAdmin) {
                const adminCount = Number(await client.command('SCARD', ADMINS_KEY));
                if (adminCount <= 1) {
                    throw new Error('Cannot remove the last remaining admin');
                }
            }

            await client.command('SREM', APPROVED_KEY, normalized);
            await client.command('SREM', ADMINS_KEY, normalized);
            await client.command('HDEL', PENDING_KEY, normalized);
        });
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
    } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: err.message }));
    }
};
