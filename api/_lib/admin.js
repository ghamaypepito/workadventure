const { withRedis } = require('./redis');

const REDIS_URL = process.env.ADMIN_REDIS_URL;

const ADMINS_KEY = 'wa:admins';
const APPROVED_KEY = 'wa:approved';
const PENDING_KEY = 'wa:pending';

async function getAccessStatus(email) {
    const normalized = email.toLowerCase();
    return withRedis(REDIS_URL, async (client) => {
        const isAdmin = (await client.command('SISMEMBER', ADMINS_KEY, normalized)) === '1';
        if (isAdmin) return 'admin';
        const isApproved = (await client.command('SISMEMBER', APPROVED_KEY, normalized)) === '1';
        if (isApproved) return 'approved';
        return 'pending';
    });
}

async function addPendingRequest(email, name, provider) {
    const normalized = email.toLowerCase();
    return withRedis(REDIS_URL, async (client) => {
        await client.command(
            'HSET',
            PENDING_KEY,
            normalized,
            JSON.stringify({ name, email: normalized, provider, ts: Date.now() }),
        );
    });
}

async function isAdminEmail(email) {
    const normalized = email.toLowerCase();
    return withRedis(REDIS_URL, async (client) => {
        return (await client.command('SISMEMBER', ADMINS_KEY, normalized)) === '1';
    });
}

module.exports = { getAccessStatus, addPendingRequest, isAdminEmail, ADMINS_KEY, APPROVED_KEY, PENDING_KEY, REDIS_URL };
