const { requireAdmin } = require('../_lib/requireAdmin');
const { readJsonBody } = require('../_lib/readBody');
const { withRedis } = require('../_lib/redis');
const { ADMINS_KEY, REDIS_URL } = require('../_lib/admin');

// Removes admin rights only - the user stays in the approved set and keeps map access, they just
// lose access to this admin panel. Refuses to demote the last remaining admin so the panel can't
// be locked out.
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
            const adminCount = Number(await client.command('SCARD', ADMINS_KEY));
            if (adminCount <= 1) {
                throw new Error('Cannot remove the last remaining admin');
            }
            await client.command('SREM', ADMINS_KEY, normalized);
        });
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
    } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: err.message }));
    }
};
