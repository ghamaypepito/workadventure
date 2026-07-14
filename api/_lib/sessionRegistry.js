const { withRedis } = require('./redis');
const { REDIS_URL } = require('./admin');

const ACTIVE_SESSION_PREFIX = 'wa:active-session:';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // matches the 7-day session cookie lifetime

function keyFor(email) {
    return `${ACTIVE_SESSION_PREFIX}${email.toLowerCase()}`;
}

// Marks sessionId as the one-and-only active session for this email, replacing any previous one.
async function setActiveSession(email, sessionId) {
    return withRedis(REDIS_URL, async (client) => {
        await client.command('SET', keyFor(email), sessionId, 'EX', SESSION_TTL_SECONDS);
    });
}

// Returns true if sessionId is still the active session for this email (i.e. no newer login has superseded it).
async function isActiveSession(email, sessionId) {
    return withRedis(REDIS_URL, async (client) => {
        const current = await client.command('GET', keyFor(email));
        return current === sessionId;
    });
}

async function clearActiveSession(email) {
    return withRedis(REDIS_URL, async (client) => {
        await client.command('DEL', keyFor(email));
    });
}

module.exports = { setActiveSession, isActiveSession, clearActiveSession };
