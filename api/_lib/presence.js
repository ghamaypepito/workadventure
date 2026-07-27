const { withRedis } = require('./redis');
const { REDIS_URL, ADMINS_KEY, APPROVED_KEY } = require('./admin');

const PRESENCE_TTL_SECONDS = 30;
const HEARTBEAT_PREFIX = 'wa:presence:';
const LAST_ROOM_PREFIX = 'wa:last-room:';

function presenceKey(email) {
    return `${HEARTBEAT_PREFIX}${email.toLowerCase()}`;
}

function lastRoomKey(email) {
    return `${LAST_ROOM_PREFIX}${email.toLowerCase()}`;
}

// Called periodically by an online recognized user's client to keep them "Active now".
async function heartbeat(email) {
    return withRedis(REDIS_URL, async (client) => {
        await client.command('SET', presenceKey(email), '1', 'EX', String(PRESENCE_TTL_SECONDS));
    });
}

// Everyone who's ever logged in or been approved (union of the two admin-managed sets),
// each flagged with live online status for the guest picker UI.
async function listKnownMembers() {
    return withRedis(REDIS_URL, async (client) => {
        const admins = await client.command('SMEMBERS', ADMINS_KEY);
        const approved = await client.command('SMEMBERS', APPROVED_KEY);
        const emails = Array.from(new Set([...(admins || []), ...(approved || [])]));
        const members = [];
        for (const email of emails) {
            const online = (await client.command('GET', presenceKey(email))) !== null;
            members.push({ email, online });
        }
        return members;
    });
}

async function setLastRoom(email, room) {
    return withRedis(REDIS_URL, async (client) => {
        await client.command('SET', lastRoomKey(email), room);
    });
}

async function getLastRoom(email) {
    return withRedis(REDIS_URL, async (client) => {
        return client.command('GET', lastRoomKey(email));
    });
}

module.exports = { heartbeat, listKnownMembers, setLastRoom, getLastRoom };
