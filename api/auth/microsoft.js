const crypto = require('crypto');
const { baseUrl } = require('../_lib/session');

module.exports = (req, res) => {
    const clientId = process.env.MICROSOFT_CLIENT_ID;
    if (!clientId) {
        res.statusCode = 500;
        res.end('Microsoft SSO is not configured (missing MICROSOFT_CLIENT_ID).');
        return;
    }

    const state = crypto.randomBytes(16).toString('hex');
    const redirectUri = `${baseUrl(req)}/api/auth/microsoft-callback`;
    const tenant = process.env.MICROSOFT_TENANT_ID || 'common';

    res.setHeader('Set-Cookie', `oauth_state=${state}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);

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
