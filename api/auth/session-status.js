const { verifySession, parseCookies } = require('../_lib/session');
const { isActiveSession } = require('../_lib/sessionRegistry');

const CLEAR_COOKIES = [
    'wa_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
    'wa_user=; Path=/; Secure; SameSite=Lax; Max-Age=0',
];

// Lets any signed-in page check whether its session is still the active one for its email,
// so a user who got signed in on another device is cleanly logged out here instead of
// silently keeping stale cookies.
module.exports = async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    const cookies = parseCookies(req);
    const session = verifySession(cookies.wa_session);
    if (!session || !session.email) {
        res.statusCode = 200;
        res.end(JSON.stringify({ authenticated: false }));
        return;
    }

    if (session.sessionId && !(await isActiveSession(session.email, session.sessionId))) {
        res.setHeader('Set-Cookie', CLEAR_COOKIES);
        res.statusCode = 200;
        res.end(JSON.stringify({ authenticated: false, reason: 'superseded' }));
        return;
    }

    res.statusCode = 200;
    res.end(
        JSON.stringify({
            authenticated: true,
            user: { name: session.name, email: session.email, provider: session.provider, status: session.status },
        }),
    );
};
