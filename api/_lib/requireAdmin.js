const { verifySession, parseCookies } = require('./session');
const { isAdminEmail } = require('./admin');

async function requireAdmin(req, res) {
    const cookies = parseCookies(req);
    const session = verifySession(cookies.wa_session);
    if (!session || !session.email) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'Not signed in' }));
        return null;
    }
    const isAdmin = await isAdminEmail(session.email);
    if (!isAdmin) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Admin access required' }));
        return null;
    }
    return session;
}

module.exports = { requireAdmin };
