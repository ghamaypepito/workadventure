const { requireUser } = require('../_lib/requireUser');
const { requireAdmin } = require('../_lib/requireAdmin');
const { withRedis } = require('../_lib/redis');
const { REDIS_URL } = require('../_lib/admin');
const {
    createChannel,
    renameChannel,
    channelExists,
    addMembers,
    removeMembers,
    getMembers,
    isMember,
    isArchived,
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
} = require('../_lib/channels');

const CHAT_HISTORY_DEFAULT_LIMIT = 50;
const CHAT_HISTORY_MAX_LIMIT = 200;

async function readBody(req) {
    let body = '';
    for await (const chunk of req) body += chunk;
    try {
        return JSON.parse(body || '{}');
    } catch {
        return null;
    }
}

// Requires admin. Creates a channel with the given members (creator is always included).
async function create(req, res, user) {
    const parsed = await readBody(req);
    if (parsed === null || !parsed.name) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing name' }));
        return;
    }
    const memberEmails = Array.isArray(parsed.memberEmails) ? parsed.memberEmails : [];
    if (!memberEmails.includes(user.email)) memberEmails.push(user.email);

    try {
        const { id } = await createChannel(parsed.name, memberEmails, user.email);
        res.statusCode = 200;
        res.end(JSON.stringify({ id }));
    } catch (err) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: err.message }));
    }
}

// Requires signed-in user. Lists channels the caller belongs to, with unread counts.
async function list(req, res, user) {
    const channels = await listChannelsForUser(user.email);
    res.statusCode = 200;
    res.end(JSON.stringify({ channels }));
}

function getChannelId(req) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    return url.searchParams.get('id');
}

// Requires admin. Renames a channel (identity is by id, so this never breaks references).
async function rename(req, res, user) {
    const channelId = getChannelId(req);
    if (!channelId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing id' }));
        return;
    }
    const parsed = await readBody(req);
    if (parsed === null || !parsed.name) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing name' }));
        return;
    }
    const updated = await renameChannel(channelId, parsed.name);
    if (!updated) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Channel not found' }));
        return;
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
}

// Requires admin. Adds/removes members.
async function members(req, res, user) {
    const channelId = getChannelId(req);
    if (!channelId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing id' }));
        return;
    }
    const parsed = await readBody(req);
    if (parsed === null) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid body' }));
        return;
    }
    if (!(await channelExists(channelId))) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Channel not found' }));
        return;
    }
    if (Array.isArray(parsed.add) && parsed.add.length > 0) await addMembers(channelId, parsed.add);
    if (Array.isArray(parsed.remove) && parsed.remove.length > 0) await removeMembers(channelId, parsed.remove);
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
}

// Requires admin. Lists the channel's current members (email addresses).
async function membersList(req, res, user) {
    const channelId = getChannelId(req);
    if (!channelId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing id' }));
        return;
    }
    if (!(await channelExists(channelId))) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Channel not found' }));
        return;
    }
    const members = await getMembers(channelId);
    res.statusCode = 200;
    res.end(JSON.stringify({ members }));
}

// Requires admin. Resolves a WA player uuid to the SSO email registered for it (see the
// identity endpoint in api/admission/[...admissionPath].js, which writes wa:uuid-email:*),
// so the online-user-list's "Add to channel" action can target this specific user by email
// even though it only has their uuid client-side.
// Caveat: WA player uuids are per-browser (localStorage), not per-account, and the
// wa:uuid-email:<uuid> mapping has a 30-day TTL with last-write-wins semantics. On a
// shared/kiosk browser, a different person using that browser within 30 days of someone
// else's last login can cause this uuid to resolve to the PREVIOUS account's email. Callers
// that act on the resolved email (e.g. adding to a channel) should surface it to an admin
// for confirmation rather than acting on it silently.
async function resolveEmail(req, res, user) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const uuid = url.searchParams.get('uuid');
    if (!uuid) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing uuid' }));
        return;
    }
    const email = await withRedis(REDIS_URL, async (client) => {
        return client.command('GET', `wa:uuid-email:${uuid}`);
    });
    res.statusCode = 200;
    res.end(JSON.stringify({ email: email || null }));
}

// Requires admin. Soft-deletes a channel: hides it from every member's list, but keeps
// all its data intact so it can be restored later.
async function archive(req, res, user) {
    const channelId = getChannelId(req);
    if (!channelId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing id' }));
        return;
    }
    const updated = await archiveChannel(channelId);
    if (!updated) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Channel not found' }));
        return;
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
}

// Requires admin. Un-archives a previously archived channel.
async function restore(req, res, user) {
    const channelId = getChannelId(req);
    if (!channelId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing id' }));
        return;
    }
    const updated = await restoreChannel(channelId);
    if (!updated) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Channel not found' }));
        return;
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
}

// Requires admin. Permanently erases the channel and all its data - no recovery.
async function deletePermanently(req, res, user) {
    const channelId = getChannelId(req);
    if (!channelId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing id' }));
        return;
    }
    if (!(await channelExists(channelId))) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Channel not found' }));
        return;
    }
    await deleteChannelPermanently(channelId);
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
}

// Requires admin. Lists every archived channel, regardless of the admin's own membership,
// for the admin-only archived-channels management view.
async function archived(req, res, user) {
    const channels = await listArchivedChannels();
    res.statusCode = 200;
    res.end(JSON.stringify({ channels }));
}

// Requires the caller to be a member of the channel.
async function messagesGet(req, res, user) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const channelId = url.searchParams.get('id');
    if (!channelId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing id' }));
        return;
    }
    if (!(await isMember(channelId, user.email))) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Not a member of this channel' }));
        return;
    }
    if (await isArchived(channelId)) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'This channel has been archived' }));
        return;
    }
    const offset = Math.max(0, parseInt(url.searchParams.get('offset'), 10) || 0);
    const limit = Math.min(
        CHAT_HISTORY_MAX_LIMIT,
        Math.max(1, parseInt(url.searchParams.get('limit'), 10) || CHAT_HISTORY_DEFAULT_LIMIT),
    );
    const { messages, hasMore } = await getMessages(channelId, offset, limit);
    res.statusCode = 200;
    res.end(JSON.stringify({ messages, hasMore }));
}

async function messagesPost(req, res, user) {
    const channelId = getChannelId(req);
    if (!channelId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing id' }));
        return;
    }
    if (!(await isMember(channelId, user.email))) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Not a member of this channel' }));
        return;
    }
    if (await isArchived(channelId)) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'This channel has been archived' }));
        return;
    }
    const parsed = await readBody(req);
    if (parsed === null || !parsed.message) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing message' }));
        return;
    }
    await appendMessage(channelId, user.name || user.email, parsed.message);
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
}

async function read(req, res, user) {
    const channelId = getChannelId(req);
    if (!channelId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing id' }));
        return;
    }
    if (!(await isMember(channelId, user.email))) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Not a member of this channel' }));
        return;
    }
    if (await isArchived(channelId)) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'This channel has been archived' }));
        return;
    }
    await markRead(channelId, user.email);
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
}

async function notificationLevel(req, res, user) {
    const channelId = getChannelId(req);
    if (!channelId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing id' }));
        return;
    }
    if (!(await isMember(channelId, user.email))) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Not a member of this channel' }));
        return;
    }
    if (await isArchived(channelId)) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'This channel has been archived' }));
        return;
    }
    const parsed = await readBody(req);
    if (parsed === null || (parsed.level !== 'all' && parsed.level !== 'none')) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'level must be "all" or "none"' }));
        return;
    }
    await setNotificationLevel(channelId, user.email, parsed.level);
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
}

// Requires the caller to be a member. Returns the currently-registered WA player uuid
// for every OTHER online member of this channel, so the caller's client can send an
// instant SocialSignalRequestMessage-based notification to each (see RoomConnection's
// existing emitSocialSignalRequest, reused rather than adding a new protobuf message).
async function onlineMemberUuids(req, res, user) {
    const channelId = getChannelId(req);
    if (!channelId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing id' }));
        return;
    }
    if (!(await isMember(channelId, user.email))) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Not a member of this channel' }));
        return;
    }
    if (await isArchived(channelId)) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'This channel has been archived' }));
        return;
    }
    const allMembers = await getMembers(channelId);
    const uuids = await withRedis(REDIS_URL, async (client) => {
        const result = [];
        for (const email of allMembers) {
            if (email === user.email.toLowerCase()) continue;
            const uuid = await client.command('GET', `wa:email-uuid:${email}`);
            if (uuid) result.push(uuid);
        }
        return result;
    });
    res.statusCode = 200;
    res.end(JSON.stringify({ uuids }));
}

module.exports = async (req, res) => {
    res.setHeader('Content-Type', 'application/json');

    const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
    const action = pathname.split('/').filter(Boolean).pop(); // e.g. 'create', 'messages'

    try {
        if (action === 'create') {
            const user = await requireAdmin(req, res);
            if (!user) return;
            await create(req, res, user);
            return;
        }
        if (action === 'list') {
            const user = await requireUser(req, res);
            if (!user) return;
            await list(req, res, user);
            return;
        }
        if (action === 'rename') {
            const user = await requireAdmin(req, res);
            if (!user) return;
            await rename(req, res, user);
            return;
        }
        if (action === 'members') {
            const user = await requireAdmin(req, res);
            if (!user) return;
            if (req.method === 'GET') await membersList(req, res, user);
            else await members(req, res, user);
            return;
        }
        if (action === 'resolve-email') {
            const user = await requireAdmin(req, res);
            if (!user) return;
            await resolveEmail(req, res, user);
            return;
        }
        if (action === 'messages') {
            const user = await requireUser(req, res);
            if (!user) return;
            if (req.method === 'POST') await messagesPost(req, res, user);
            else await messagesGet(req, res, user);
            return;
        }
        if (action === 'read') {
            const user = await requireUser(req, res);
            if (!user) return;
            await read(req, res, user);
            return;
        }
        if (action === 'notification-level') {
            const user = await requireUser(req, res);
            if (!user) return;
            await notificationLevel(req, res, user);
            return;
        }
        if (action === 'online-member-uuids') {
            const user = await requireUser(req, res);
            if (!user) return;
            await onlineMemberUuids(req, res, user);
            return;
        }
        if (action === 'archive') {
            const user = await requireAdmin(req, res);
            if (!user) return;
            await archive(req, res, user);
            return;
        }
        if (action === 'restore') {
            const user = await requireAdmin(req, res);
            if (!user) return;
            await restore(req, res, user);
            return;
        }
        if (action === 'delete') {
            const user = await requireAdmin(req, res);
            if (!user) return;
            await deletePermanently(req, res, user);
            return;
        }
        if (action === 'archived') {
            const user = await requireAdmin(req, res);
            if (!user) return;
            await archived(req, res, user);
            return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
};
