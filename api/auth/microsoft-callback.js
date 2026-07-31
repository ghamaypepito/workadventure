const crypto = require('crypto');
const { signSession, parseCookies, baseUrl, b64url } = require('../_lib/session');
const { getAccessStatus, addPendingRequest } = require('../_lib/admin');
const { setActiveSession } = require('../_lib/sessionRegistry');

// See google-callback.js for the full rationale behind both of these - identical pattern, kept
// as a separate local copy per file rather than a shared module (see google-callback.js).
const PUSHER_URL = 'https://play-production-5dcd.up.railway.app';

function signMatrixBridgeToken(email) {
    const secret = process.env.MATRIX_BRIDGE_SECRET;
    if (!secret) return null;
    const payload = b64url(Buffer.from(JSON.stringify({ email, exp: Date.now() + 60_000 })));
    const sig = b64url(crypto.createHmac('sha256', secret).update(payload).digest());
    return `${payload}.${sig}`;
}

module.exports = async (req, res) => {
    const url = new URL(req.url, baseUrl(req));
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const cookies = parseCookies(req);

    if (!code || !state || state !== cookies.oauth_state) {
        res.statusCode = 400;
        res.end('Invalid OAuth state or missing code.');
        return;
    }

    const clientId = process.env.MICROSOFT_CLIENT_ID;
    const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
    const tenant = process.env.MICROSOFT_TENANT_ID || 'common';
    const redirectUri = `${baseUrl(req)}/api/auth/microsoft-callback`;

    try {
        const tokenRes = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
                scope: 'openid email profile',
            }),
        });

        if (!tokenRes.ok) {
            throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
        }

        const tokenData = await tokenRes.json();
        const idTokenParts = tokenData.id_token.split('.');
        const claims = JSON.parse(Buffer.from(idTokenParts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());

        if (claims.aud !== clientId) throw new Error('Token audience mismatch');

        const name = claims.name || claims.preferred_username || claims.email;
        const email = claims.email || claims.preferred_username;

        const status = await getAccessStatus(email);
        if (status === 'pending') {
            await addPendingRequest(email, name, 'microsoft');
        }

        // Only one active session per email: this login supersedes any other device/browser
        // already signed in with the same email.
        const sessionId = crypto.randomBytes(16).toString('hex');
        await setActiveSession(email, sessionId);

        const session = signSession({
            provider: 'microsoft',
            email,
            name,
            status,
            sessionId,
            exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
        });

        const clearedCookies = [
            `wa_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
            `wa_user=${encodeURIComponent(JSON.stringify({ name, email, provider: 'microsoft', status, isAdmin: status === 'admin' }))}; Path=/; Secure; SameSite=Lax; Max-Age=604800`,
            `oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
            `return_to=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
        ];

        const returnTo = cookies.return_to;
        const bridgeToken = status !== 'pending' && returnTo ? signMatrixBridgeToken(email) : null;

        res.setHeader('Set-Cookie', clearedCookies);

        res.statusCode = 302;
        if (bridgeToken) {
            const bridgeUrl = new URL('/custom-sso-matrix-login', PUSHER_URL);
            bridgeUrl.searchParams.set('token', bridgeToken);
            bridgeUrl.searchParams.set('providerId', 'microsoft');
            bridgeUrl.searchParams.set('playUri', returnTo);
            res.setHeader('Location', bridgeUrl.toString());
        } else {
            res.setHeader('Location', '/');
        }
        res.end();
    } catch (err) {
        res.statusCode = 500;
        res.end(`Microsoft sign-in failed: ${err.message}`);
    }
};
