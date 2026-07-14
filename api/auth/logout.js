const { verifySession, parseCookies } = require('../_lib/session');
const { clearActiveSession } = require('../_lib/sessionRegistry');

module.exports = async (req, res) => {
    const cookies = parseCookies(req);
    const session = verifySession(cookies.wa_session);
    if (session && session.email) {
        try {
            await clearActiveSession(session.email);
        } catch (e) {
            // best-effort cleanup; still proceed to clear cookies below
        }
    }

    res.setHeader('Set-Cookie', [
        'wa_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        'wa_user=; Path=/; Secure; SameSite=Lax; Max-Age=0',
    ]);
    res.statusCode = 302;
    res.setHeader('Location', '/');
    res.end();
};
