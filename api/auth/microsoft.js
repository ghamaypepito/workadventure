const crypto = require('crypto');
const { baseUrl } = require('../_lib/session');

module.exports = (req, res) => {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    if (!clientId) {
        res.statusCode = 500;
        res.end('Microsoft SSO is not configured (missing MICROSOFT_CLIENT_ID).');
        return;
    }

    const url = new URL(req.url, baseUrl(req));
    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = `${baseUrl(req)}/api/auth/microsoft-callback`;
    const tenant = process.env.MICROSOFT_TENANT_ID || 'common';
    // See google.js for why this is captured - handed to google-callback.js's Microsoft twin.
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
        response_mode: 'query',
        scope: 'openid email profile',
        state,
    });

    res.statusCode = 302;
    res.setHeader('Location', `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params.toString()}`);
    res.end();
};
