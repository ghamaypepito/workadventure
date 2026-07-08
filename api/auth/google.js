const crypto = require('crypto');
const { baseUrl } = require('../_lib/session');

module.exports = (req, res) => {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
        res.statusCode = 500;
        res.end('Google SSO is not configured (missing GOOGLE_CLIENT_ID).');
        return;
    }

    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = `${baseUrl(req)}/api/auth/google-callback`;

    res.setHeader('Set-Cookie', `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);

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
