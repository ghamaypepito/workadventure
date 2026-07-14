const { verifySession, parseCookies } = require('./session');
const { isActiveSession } = require('./sessionRegistry');

// Any signed-in (non-guest) user — unlike requireAdmin, does not check admin status.
async function requireUser(req, res) {
    const cookies = parseCookies(req);
    const session = verifySession(cookies.wa_session);
    if (!session || !session.email) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'Not signed in' }));
        return null;
    }
    if (session.sessionId && !(await isActiveSession(session.email, session.sessionId))) {
        res.statusCode = 401;
        res.end(JSON.stringify({ error: 'Session has been signed in from another device' }));
        return null;
    }
    return session;
}

module.exports = { requireUser };
