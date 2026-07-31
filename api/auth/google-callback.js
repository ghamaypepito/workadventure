const crypto = require('crypto');
const { signSession, parseCookies, baseUrl, b64url } = require('../_lib/session');
const { getAccessStatus, addPendingRequest } = require('../_lib/admin');
const { setActiveSession } = require('../_lib/sessionRegistry');

// Same value as PLAY_URL in process-template.cjs for this branch - hardcoded per-branch here too
// since this file (like process-template.cjs) is one of the small set of files this deployment's
// two branches (pxlcode-workplace / master) intentionally keep different.
const PUSHER_URL = 'https://play-production-7ae3.up.railway.app';

// Signs a short-lived {email, exp} token for the pusher /custom-sso-matrix-login bridge, using a
// dedicated secret (MATRIX_BRIDGE_SECRET) separate from this file's own SESSION_SECRET - a leak
// of one doesn't compromise the other. Same HMAC-SHA256 scheme as signSession, kept as a small
// local helper since pusher must independently re-derive the same signature in TypeScript and
// the two implementations should be easy to compare side by side rather than sharing a module
// across two completely separate deployed services.
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

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = `${baseUrl(req)}/api/auth/google-callback`;

    try {
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
            }),
        });

        if (!tokenRes.ok) {
            throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
        }

        const tokenData = await tokenRes.json();
        const idTokenParts = tokenData.id_token.split('.');
        const claims = JSON.parse(Buffer.from(idTokenParts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());

        if (claims.aud !== clientId) throw new Error('Token audience mismatch');
        if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') {
            throw new Error('Token issuer mismatch');
        }

        const name = claims.name || claims.email;
        const status = await getAccessStatus(claims.email);
        if (status === 'pending') {
            await addPendingRequest(claims.email, name, 'google');
        }

        // Only one active session per email: this login supersedes any other device/browser
        // already signed in with the same email.
        const sessionId = crypto.randomBytes(16).toString('hex');
        await setActiveSession(claims.email, sessionId);

        const session = signSession({
            provider: 'google',
            email: claims.email,
            name,
            status,
            sessionId,
            exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
        });

        const clearedCookies = [
            `wa_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
            `wa_user=${encodeURIComponent(JSON.stringify({ name, email: claims.email, provider: 'google', status, isAdmin: status === 'admin' }))}; Path=/; Secure; SameSite=Lax; Max-Age=604800`,
            `oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
            `return_to=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
        ];

        // Only bridge into Matrix login for an already-approved user with a real playUri to
        // return to - not for a still-pending user (nothing to gain from a Matrix identity
        // before they're approved), and not if MATRIX_BRIDGE_SECRET isn't set yet (this
        // deployment may not have Matrix chat wired up at all, or not yet on this branch).
        const returnTo = cookies.return_to;
        const bridgeToken = status !== 'pending' && returnTo ? signMatrixBridgeToken(claims.email) : null;

        res.setHeader('Set-Cookie', clearedCookies);

        res.statusCode = 302;
        if (bridgeToken) {
            const bridgeUrl = new URL('/custom-sso-matrix-login', PUSHER_URL);
            bridgeUrl.searchParams.set('token', bridgeToken);
            // Synapse namespaces generic OIDC providers as "oidc-<idp_id>" internally regardless
            // of the idp_id value in homeserver.template.yaml (confirmed by hitting
            // /_matrix/client/v3/login - plain "google" 404s, "oidc-google" redirects correctly).
            bridgeUrl.searchParams.set('providerId', 'oidc-google');
            bridgeUrl.searchParams.set('playUri', returnTo);
            res.setHeader('Location', bridgeUrl.toString());
        } else {
            res.setHeader('Location', '/');
        }
        res.end();
    } catch (err) {
        res.statusCode = 500;
        res.end(`Google sign-in failed: ${err.message}`);
    }
};
