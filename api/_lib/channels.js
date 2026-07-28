const crypto = require('crypto');
const { withRedis } = require('./redis');
const { REDIS_URL } = require('./admin');

const CHANNEL_PREFIX = 'wa:channel:';
const MEMBERS_PREFIX = 'wa:channel:members:';
const BY_MEMBER_PREFIX = 'wa:channels:by-member:';
const HISTORY_PREFIX = 'wa:channel-history:';
const LAST_READ_PREFIX = 'wa:channel-lastread:';
const NOTIF_PREFIX = 'wa:channel-notif:';
const ALL_CHANNELS_KEY = 'wa:all-channel-ids';

function normalizeEmails(emails) {
    return Array.from(new Set((emails || []).map((e) => e.toLowerCase())));
}

async function createChannel(name, memberEmails, createdBy) {
    if (!createdBy) {
        throw new Error('createdBy is required');
    }
    const emails = normalizeEmails(memberEmails);
    if (emails.length === 0) {
        throw new Error('A channel needs at least one member');
    }
    const id = crypto.randomBytes(9).toString('hex');

    await withRedis(REDIS_URL, async (client) => {
        await client.command('SADD', ALL_CHANNELS_KEY, id);
        await client.command(
            'HSET',
            `${CHANNEL_PREFIX}${id}`,
            'name',
            name,
            'createdAt',
            String(Date.now()),
            'createdBy',
            createdBy,
        );
        for (const email of emails) {
            await client.command('SADD', `${MEMBERS_PREFIX}${id}`, email);
            await client.command('SADD', `${BY_MEMBER_PREFIX}${email}`, id);
        }
    });

    return { id };
}

async function renameChannel(id, name) {
    return withRedis(REDIS_URL, async (client) => {
        const exists = await client.command('EXISTS', `${CHANNEL_PREFIX}${id}`);
        if (exists !== '1') return false;
        await client.command('HSET', `${CHANNEL_PREFIX}${id}`, 'name', name);
        return true;
    });
}

async function channelExists(id) {
    return withRedis(REDIS_URL, async (client) => {
        const exists = await client.command('EXISTS', `${CHANNEL_PREFIX}${id}`);
        return exists === '1';
    });
}

async function addMembers(id, emails) {
    const normalized = normalizeEmails(emails);
    await withRedis(REDIS_URL, async (client) => {
        for (const email of normalized) {
            await client.command('SADD', `${MEMBERS_PREFIX}${id}`, email);
            await client.command('SADD', `${BY_MEMBER_PREFIX}${email}`, id);
        }
    });
}

async function removeMembers(id, emails) {
    const normalized = normalizeEmails(emails);
    await withRedis(REDIS_URL, async (client) => {
        for (const email of normalized) {
            await client.command('SREM', `${MEMBERS_PREFIX}${id}`, email);
            await client.command('SREM', `${BY_MEMBER_PREFIX}${email}`, id);
            // Clear this user's per-channel state too, so if they're later re-added they
            // don't inherit stale lastread/notification settings from before their removal.
            await client.command('DEL', `${LAST_READ_PREFIX}${email}:${id}`);
            await client.command('HDEL', `${NOTIF_PREFIX}${email}`, id);
        }
    });
}

async function getMembers(id) {
    return withRedis(REDIS_URL, async (client) => {
        return (await client.command('SMEMBERS', `${MEMBERS_PREFIX}${id}`)) || [];
    });
}

async function isMember(id, email) {
    return withRedis(REDIS_URL, async (client) => {
        return (await client.command('SISMEMBER', `${MEMBERS_PREFIX}${id}`, email.toLowerCase())) === '1';
    });
}

async function isArchived(id) {
    return withRedis(REDIS_URL, async (client) => {
        const archived = await client.command('HGET', `${CHANNEL_PREFIX}${id}`, 'archived');
        return archived === '1';
    });
}

async function archiveChannel(id) {
    return withRedis(REDIS_URL, async (client) => {
        const exists = await client.command('EXISTS', `${CHANNEL_PREFIX}${id}`);
        if (exists !== '1') return false;
        // Self-healing: ensures channels created before wa:all-channel-ids existed (or by any
        // other path that missed the index) still become visible in listArchivedChannels once
        // archived - the only point at which an admin would ever need to find them there.
        await client.command('SADD', ALL_CHANNELS_KEY, id);
        await client.command('HSET', `${CHANNEL_PREFIX}${id}`, 'archived', '1');
        return true;
    });
}

async function restoreChannel(id) {
    return withRedis(REDIS_URL, async (client) => {
        const exists = await client.command('EXISTS', `${CHANNEL_PREFIX}${id}`);
        if (exists !== '1') return false;
        await client.command('HDEL', `${CHANNEL_PREFIX}${id}`, 'archived');
        return true;
    });
}

// Permanently erases a channel and everything about it: the channel hash itself, its
// membership set and every member's reverse by-member/lastread/notification entries for
// it, and its full message history. Unlike archiveChannel, there is no recovery from this.
async function deleteChannelPermanently(id) {
    const members = await getMembers(id);
    await withRedis(REDIS_URL, async (client) => {
        for (const email of members) {
            await client.command('SREM', `${BY_MEMBER_PREFIX}${email}`, id);
            await client.command('DEL', `${LAST_READ_PREFIX}${email}:${id}`);
            await client.command('HDEL', `${NOTIF_PREFIX}${email}`, id);
        }
        await client.command('DEL', `${CHANNEL_PREFIX}${id}`);
        await client.command('DEL', `${MEMBERS_PREFIX}${id}`);
        await client.command('DEL', `${HISTORY_PREFIX}${id}`);
        await client.command('SREM', ALL_CHANNELS_KEY, id);
    });
}

// Lists every archived channel, regardless of the admin's own membership, for the
// admin-only archived-channels management view.
async function listArchivedChannels() {
    return withRedis(REDIS_URL, async (client) => {
        const ids = (await client.command('SMEMBERS', ALL_CHANNELS_KEY)) || [];
        const result = [];
        for (const id of ids) {
            const raw = await client.command('HGETALL', `${CHANNEL_PREFIX}${id}`);
            if (!raw || raw.length === 0) continue;
            const data = {};
            for (let i = 0; i < raw.length; i += 2) data[raw[i]] = raw[i + 1];
            if (!data.name || data.archived !== '1') continue;
            result.push({ id, name: data.name, createdAt: parseInt(data.createdAt, 10) || 0, createdBy: data.createdBy });
        }
        return result;
    });
}

async function getChannel(id) {
    return withRedis(REDIS_URL, async (client) => {
        const raw = await client.command('HGETALL', `${CHANNEL_PREFIX}${id}`);
        if (!raw || raw.length === 0) return null;
        const data = {};
        for (let i = 0; i < raw.length; i += 2) data[raw[i]] = raw[i + 1];
        if (!data.name) return null;
        return { id, name: data.name, createdAt: parseInt(data.createdAt, 10) || 0, createdBy: data.createdBy };
    });
}

async function listChannelsForUser(email) {
    return withRedis(REDIS_URL, async (client) => {
        const ids = (await client.command('SMEMBERS', `${BY_MEMBER_PREFIX}${email.toLowerCase()}`)) || [];
        const result = [];
        for (const id of ids) {
            const raw = await client.command('HGETALL', `${CHANNEL_PREFIX}${id}`);
            if (!raw || raw.length === 0) continue;
            const data = {};
            for (let i = 0; i < raw.length; i += 2) data[raw[i]] = raw[i + 1];
            if (!data.name) continue;
            if (data.archived === '1') continue;

            const lastRead = (await client.command('GET', `${LAST_READ_PREFIX}${email.toLowerCase()}:${id}`)) || '0';
            const total = parseInt((await client.command('LLEN', `${HISTORY_PREFIX}${id}`)) || '0', 10);
            const raw2 = await client.command('LRANGE', `${HISTORY_PREFIX}${id}`, '0', '199');
            let unreadCount = 0;
            for (const entry of raw2 || []) {
                try {
                    const msg = JSON.parse(entry);
                    if (msg.ts > parseInt(lastRead, 10)) unreadCount++;
                } catch {
                    // skip malformed entry
                }
            }
            void total; // total kept for potential future use; unreadCount is computed from the recent window above

            const notifLevel = await client.command('HGET', `${NOTIF_PREFIX}${email.toLowerCase()}`, id);

            result.push({
                id,
                name: data.name,
                unreadCount,
                notificationLevel: notifLevel === 'none' ? 'none' : 'all',
                createdBy: data.createdBy,
            });
        }
        return result;
    });
}

async function appendMessage(id, author, message) {
    const entry = JSON.stringify({ author, message: String(message).slice(0, 4000), ts: Date.now() });
    await withRedis(REDIS_URL, async (client) => {
        await client.command('LPUSH', `${HISTORY_PREFIX}${id}`, entry);
    });
}

async function getMessages(id, offset, limit) {
    return withRedis(REDIS_URL, async (client) => {
        const raw = await client.command('LRANGE', `${HISTORY_PREFIX}${id}`, String(offset), String(offset + limit - 1));
        const total = parseInt((await client.command('LLEN', `${HISTORY_PREFIX}${id}`)) || '0', 10);
        const messages = (raw || [])
            .map((entry) => {
                try {
                    return JSON.parse(entry);
                } catch {
                    return null;
                }
            })
            .filter(Boolean)
            .reverse();
        return { messages, hasMore: offset + (raw || []).length < total };
    });
}

async function markRead(id, email) {
    await withRedis(REDIS_URL, async (client) => {
        await client.command('SET', `${LAST_READ_PREFIX}${email.toLowerCase()}:${id}`, String(Date.now()));
    });
}

async function getNotificationLevel(id, email) {
    return withRedis(REDIS_URL, async (client) => {
        const level = await client.command('HGET', `${NOTIF_PREFIX}${email.toLowerCase()}`, id);
        return level === 'none' ? 'none' : 'all';
    });
}

async function setNotificationLevel(id, email, level) {
    await withRedis(REDIS_URL, async (client) => {
        await client.command('HSET', `${NOTIF_PREFIX}${email.toLowerCase()}`, id, level === 'none' ? 'none' : 'all');
    });
}

module.exports = {
    createChannel,
    renameChannel,
    channelExists,
    addMembers,
    removeMembers,
    getMembers,
    isMember,
    isArchived,
    getChannel,
    listChannelsForUser,
    appendMessage,
    getMessages,
    markRead,
    getNotificationLevel,
    setNotificationLevel,
    archiveChannel,
    restoreChannel,
    deleteChannelPermanently,
    listArchivedChannels,
};
