module.exports = (req, res) => {
    res.setHeader('Set-Cookie', [
        'wa_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0',
        'wa_user=; Path=/; Secure; SameSite=Lax; Max-Age=0',
    ]);
    res.statusCode = 302;
    res.setHeader('Location', '/');
    res.end();
};
