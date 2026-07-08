const { signSession, parseCookies, baseUrl } = require('../_lib/session');
const { getAccessStatus, addPendingRequest } = require('../_lib/admin');

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

        const session = signSession({
            provider: 'google',
            email: claims.email,
            name,
            status,
            exp: Date.now() + 1000 * 60 * 60 * 24 * 7,
        });

        res.setHeader('Set-Cookie', [
            `wa_session=${session}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`,
            `wa_user=${encodeURIComponent(JSON.stringify({ name, email: claims.email, provider: 'google', status, isAdmin: status === 'admin' }))}; Path=/; Secure; SameSite=Lax; Max-Age=604800`,
            `oauth_state=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
        ]);

        res.statusCode = 302;
        res.setHeader('Location', '/');
        res.end();
    } catch (err) {
        res.statusCode = 500;
        res.end(`Google sign-in failed: ${err.message}`);
    }
};
