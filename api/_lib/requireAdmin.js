const { verifySession, parseCookies } = require('./session');
const { isAdminEmail } = require('./admin');
const { isActiveSession } = require('./sessionRegistry');

async function requireAdmin(req, res) {
    const cookies = parseCookies(req);
    const session = verifySession(cookies.wa_session);
    if (!session || !session.email) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'Not signed in' }));
        return null;
    }
    // If someone else logged into this email elsewhere, this older session has been superseded.
    if (session.sessionId && !(await isActiveSession(session.email, session.sessionId))) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'Session has been signed in from another device' }));
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
