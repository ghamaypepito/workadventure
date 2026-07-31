const crypto = require('crypto');
const { baseUrl } = require('../_lib/session');

module.exports = (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
        res.statusCode = 500;
        res.end('Google SSO is not configured (missing GOOGLE_CLIENT_ID).');
        return;
    }

    const url = new URL(req.url, baseUrl(req));
    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = `${baseUrl(req)}/api/auth/google-callback`;
    // The room URL the user was on when they clicked "Sign in with Google" (set dynamically by
    // the SSO gate script, since this is a static build-time link otherwise) - stashed in a
    // cookie so google-callback.js can hand it off to Matrix login as the playUri to return to.
    const returnTo = url.searchParams.get('returnTo');

    const cookies = [`oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`];
    if (returnTo) {
        cookies.push(`return_to=${encodeURIComponent(returnTo)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    }
    res.setHeader('Set-Cookie', cookies);

    const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        prompt: 'select_account',
    });

    res.statusCode = 302;
    res.setHeader('Location', `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
    res.end();
};
