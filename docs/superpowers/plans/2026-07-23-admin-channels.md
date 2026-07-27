# Admin-Created Chat Channels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Slack-style named channels to the chat bubble — admin-only creation and membership assignment, pull-on-open message history, and an instant per-channel-configurable unread badge.

**Architecture:** New Redis-backed data (channels, membership, history, unread tracking, notification levels) served by a new Vercel serverless catch-all at `api/channels/[...channelsPath].js`, following the exact same hand-rolled-Redis/`requireUser`/`requireAdmin` pattern as `api/admission/[...admissionPath].js`. The instant badge reuses the **existing, already-deployed** `SocialSignalRequestMessage`/`SocialSignalReceivedMessage` protobuf messages and their full pusher→back→pusher plumbing (built for wave/ping) rather than adding new protobuf messages — see "Deviation from the design doc" below. The channel list/messages UI is a new, self-contained Svelte section and panel, not an implementation of the existing rich `ChatRoom`/`ChatConnection` TypeScript interface (see "Deviation" below) — that interface (`ChatRoomMembershipManagement`, `ChatRoomModeration`, `ChatRoomNotificationControl`, thread support, etc.) is large and built for the Matrix chat backend; conforming to it for a much simpler bolt-on feature would be substantial unnecessary surface.

**Tech Stack:** Node.js Vercel serverless functions, the repo's hand-rolled Redis client (`api/_lib/redis.js`, RESP2 over raw TCP), Svelte 5 (runes: `$state`, `$derived`, `$effect`), the existing WorkAdventure `RoomConnection` pusher/back socket layer.

## Deviations from the design doc (`docs/superpowers/specs/2026-07-23-admin-channels-design.md`) — read before starting

1. **Real-time signal reuses `SocialSignalRequestMessage`/`SocialSignalReceivedMessage` verbatim, not a new protobuf message.** The design doc's "Real-time notification signal" section calls for a new `ChannelMessageNotification` message added to three protobuf oneofs plus a new `IoSocketController.ts` whitelist case. Investigation while writing this plan found the existing wave/ping messages already do exactly what's needed: `SocialSignalRequestMessage.kind` is an unstructured string (currently just `"wave"`/`"ping"` by convention, not by protobuf enum), and `RoomConnection.emitSocialSignalRequest(receiverUserUuid, kind, receiverUserId?)` / `RoomConnection.socialSignalReceivedStream` are already the exact client-side send/receive hooks, already fully wired through pusher and back (`back/src/Services/SocketManager.ts`'s `handleSocialSignalRequestMessage`, which looks up currently-connected users **by WA player UUID** and writes directly to their socket — no proto regeneration, no back/pusher deploy risk, no new whitelist case needed). This plan uses `kind: "channel:" + channelId` as the convention and sends one signal per online channel member (see Task 2's new `wa:email-uuid:*` reverse index and Task 4). Behaviorally this is identical to what the design doc asked for (an instant, content-free per-channel signal that online members can filter and react to); it's implemented via reuse instead of new proto surface, which is lower-risk given this repo's own documented history of proto-oneof mistakes causing silent runtime failures.
2. **Channel UI does not reuse `RoomTimeline.svelte` or the `ChatRoom` interface.** The design doc's UI section says channels reuse the existing DM/proximity chat timeline component. Investigation found `RoomTimeline.svelte` operates on objects conforming to the full Matrix-oriented `ChatRoom` type (via `selectedRoomStore`), which requires implementing membership management, moderation, and notification-control interfaces far beyond this feature's scope. This plan instead builds a small, self-contained `ChannelPanel.svelte` with its own pagination and message list, kept out of `selectedRoomStore` entirely (a separate `selectedChannelStore`), so no `ChatRoom` conformance is needed.
3. **The design doc's member picker source (`wa:admins` ∪ `wa:approved`) is served by the already-deployed `GET /api/admission/known-members` endpoint** (built for the guest-admission feature, same session, same Redis sets) — this plan's channel-creation UI calls that endpoint directly rather than duplicating it.

## Global Constraints

- Channel deletion/archiving is explicitly out of scope for v1 — create, rename, and manage-members only (per the design doc's non-goals).
- All new Redis keys are prefixed `wa:` to match existing convention.
- Channel IDs are random slugs (`crypto.randomBytes(9).toString('hex')`), independent of display name — renames never break references.
- No unit test framework exists for `api/*` handlers or these Svelte components in this repo — verification is via `node --check` (API files) and manual/curl checks (post-deploy), matching every other feature built this session. Do not introduce a new test framework.
- This plan targets the `pxlcode-workplace` branch first; the final task replicates the same commits to `master` for `vings-workplace`, matching this session's established pattern.
- Admin-only UI gating uses `typeof window !== "undefined" && (window as unknown as { __waIsAdmin?: boolean }).__waIsAdmin === true` — the exact pattern already used in `play/src/front/Components/ActionBar/MenuIcons/ProfileMenuContent.svelte:160`. This is set by the SSO gate script in `process-template.cjs` for admin users and is a client-side convenience on top of the real server-side `requireAdmin` gate, never a substitute for it.

---

### Task 1: Redis helpers for channels

**Files:**
- Create: `api/_lib/channels.js`

**Interfaces:**
- Consumes: `withRedis(url, fn)`, `REDIS_URL` from `api/_lib/redis.js`/`api/_lib/admin.js` (existing).
- Produces (all consumed by Task 2): `createChannel(name, memberEmails)` → `Promise<{id: string}>`, `renameChannel(id, name)` → `Promise<boolean>` (false if channel doesn't exist), `addMembers(id, emails)`, `removeMembers(id, emails)`, `getMembers(id)` → `Promise<string[]>`, `isMember(id, email)` → `Promise<boolean>`, `listChannelsForUser(email)` → `Promise<{id, name, unreadCount}[]>`, `getChannel(id)` → `Promise<{id, name, createdBy, createdAt} | null>`, `appendMessage(id, author, message)`, `getMessages(id, offset, limit)` → `Promise<{messages, hasMore}>`, `markRead(id, email)`, `getNotificationLevel(id, email)` → `Promise<"all"|"none">`, `setNotificationLevel(id, email, level)`.

- [ ] **Step 1: Write `api/_lib/channels.js`**

```javascript
const crypto = require('crypto');
const { withRedis } = require('./redis');
const { REDIS_URL } = require('./admin');

const CHANNEL_PREFIX = 'wa:channel:';
const MEMBERS_PREFIX = 'wa:channel:members:';
const BY_MEMBER_PREFIX = 'wa:channels:by-member:';
const HISTORY_PREFIX = 'wa:channel-history:';
const LAST_READ_PREFIX = 'wa:channel-lastread:';
const NOTIF_PREFIX = 'wa:channel-notif:';

function normalizeEmails(emails) {
    return Array.from(new Set((emails || []).map((e) => e.toLowerCase())));
}

async function createChannel(name, memberEmails) {
    const emails = normalizeEmails(memberEmails);
    if (emails.length === 0) {
        throw new Error('A channel needs at least one member');
    }
    const id = crypto.randomBytes(9).toString('hex');

    await withRedis(REDIS_URL, async (client) => {
        await client.command(
            'HSET',
            `${CHANNEL_PREFIX}${id}`,
            'name',
            name,
            'createdAt',
            String(Date.now()),
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

async function getChannel(id) {
    return withRedis(REDIS_URL, async (client) => {
        const raw = await client.command('HGETALL', `${CHANNEL_PREFIX}${id}`);
        if (!raw || raw.length === 0) return null;
        const data = {};
        for (let i = 0; i < raw.length; i += 2) data[raw[i]] = raw[i + 1];
        if (!data.name) return null;
        return { id, name: data.name, createdAt: parseInt(data.createdAt, 10) || 0 };
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
    addMembers,
    removeMembers,
    getMembers,
    isMember,
    getChannel,
    listChannelsForUser,
    appendMessage,
    getMessages,
    markRead,
    getNotificationLevel,
    setNotificationLevel,
};
```

- [ ] **Step 2: Verify syntax**

```bash
node --check api/_lib/channels.js
```

Expected: no output (success).

- [ ] **Step 3: Manual verification against real Redis**

```bash
ADMIN_REDIS_URL="<the deployment's real redis:// URL>" node -e "
const c = require('./api/_lib/channels');
(async () => {
    const { id } = await c.createChannel('Test Channel', ['a@example.com', 'b@example.com']);
    console.log('created', id);
    console.log('members', await c.getMembers(id));
    console.log('isMember a', await c.isMember(id, 'a@example.com'));
    console.log('isMember z', await c.isMember(id, 'z@example.com'));
    await c.appendMessage(id, 'a@example.com', 'hello');
    console.log('messages', await c.getMessages(id, 0, 50));
    console.log('list for a', await c.listChannelsForUser('a@example.com'));
    await c.markRead(id, 'a@example.com');
    console.log('list for a after read', await c.listChannelsForUser('a@example.com'));
    await c.setNotificationLevel(id, 'a@example.com', 'none');
    console.log('notif level a', await c.getNotificationLevel(id, 'a@example.com'));
    console.log('notif level b (default)', await c.getNotificationLevel(id, 'b@example.com'));
    console.log('list for a reflects notif level', await c.listChannelsForUser('a@example.com'));
    await c.renameChannel(id, 'Renamed Channel');
    console.log('renamed', await c.getChannel(id));
    await c.removeMembers(id, ['b@example.com']);
    console.log('members after remove', await c.getMembers(id));
})();
"
```

Expected: `isMember a: true`, `isMember z: false`, one message in history, unread count 1 before marking read and 0 after, notif level 'none' for a and 'all' (default) for b, the final `listChannelsForUser('a@example.com')` call shows `notificationLevel: 'none'` for that channel, channel name 'Renamed Channel' after rename, member list without 'b@example.com' after removal.

- [ ] **Step 4: Commit**

```bash
git add api/_lib/channels.js
git commit -m "Add Redis helpers for admin-created chat channels"
```

---

### Task 2: Reverse email-to-uuid index for real-time delivery

**Files:**
- Modify: `api/admission/[...admissionPath].js` (the existing `identity` handler)

**Interfaces:**
- Consumes: nothing new.
- Produces: a new Redis key `wa:email-uuid:<email>` written alongside the existing `wa:uuid-email:<uuid>`, consumed by Task 3's `online-member-uuids` route.

- [ ] **Step 1: Read the current `identity` handler**

```bash
grep -n "async function identity" -A 20 api/admission/\[...admissionPath\].js
```

Confirm it currently only writes `wa:uuid-email:<uuid> = email`.

- [ ] **Step 2: Add the reverse write**

In `api/admission/[...admissionPath].js`'s `identity` function, change the body from:

```javascript
    await withRedis(REDIS_URL, async (client) => {
        await client.command('SET', `wa:uuid-email:${parsed.uuid}`, user.email, 'EX', String(IDENTITY_TTL_SECONDS));
    });
```

to:

```javascript
    await withRedis(REDIS_URL, async (client) => {
        await client.command('SET', `wa:uuid-email:${parsed.uuid}`, user.email, 'EX', String(IDENTITY_TTL_SECONDS));
        // Reverse index: lets the channels feature resolve "which currently-connected
        // player uuid(s) belong to this email" to deliver an instant socket signal
        // (see api/channels/[...channelsPath].js's online-member-uuids route). Same TTL
        // and "last write wins" semantics as the forward mapping above — if a user has
        // multiple simultaneous sessions, only the most recently registered one receives
        // instant signals, which is an accepted limitation (they still see the channel's
        // correct unread count next time they open it, computed server-side from Redis).
        await client.command('SET', `wa:email-uuid:${user.email.toLowerCase()}`, parsed.uuid, 'EX', String(IDENTITY_TTL_SECONDS));
    });
```

- [ ] **Step 3: Verify syntax**

```bash
node --check api/admission/\[...admissionPath\].js
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add api/admission/\[...admissionPath\].js
git commit -m "Add reverse email-to-uuid Redis index for channel real-time delivery"
```

---

### Task 3: Channels API routes

**Files:**
- Create: `api/channels/[...channelsPath].js`

**Interfaces:**
- Consumes: everything from `api/_lib/channels.js` (Task 1); `requireUser`, `requireAdmin` (existing, `../_lib/requireUser`, `../_lib/requireAdmin`); `withRedis`, `REDIS_URL` (existing, for the `online-member-uuids` lookup).
- Produces: the full route surface below, consumed by Task 4/5 (frontend).

- [ ] **Step 1: Write `api/channels/[...channelsPath].js`**

```javascript
const { requireUser } = require('../_lib/requireUser');
const { requireAdmin } = require('../_lib/requireAdmin');
const { withRedis } = require('../_lib/redis');
const { REDIS_URL } = require('../_lib/admin');
const {
    createChannel,
    renameChannel,
    addMembers,
    removeMembers,
    getMembers,
    isMember,
    listChannelsForUser,
    appendMessage,
    getMessages,
    markRead,
    getNotificationLevel,
    setNotificationLevel,
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
        const { id } = await createChannel(parsed.name, memberEmails);
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

// Requires admin. Renames a channel (identity is by id, so this never breaks references).
async function rename(req, res, user, channelId) {
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
async function members(req, res, user, channelId) {
    const parsed = await readBody(req);
    if (parsed === null) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Invalid body' }));
        return;
    }
    if (Array.isArray(parsed.add) && parsed.add.length > 0) await addMembers(channelId, parsed.add);
    if (Array.isArray(parsed.remove) && parsed.remove.length > 0) await removeMembers(channelId, parsed.remove);
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
}

// Requires the caller to be a member of the channel.
async function messagesGet(req, res, user, channelId) {
    if (!(await isMember(channelId, user.email))) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Not a member of this channel' }));
        return;
    }
    const url = new URL(req.url, `http://${req.headers.host}`);
    const offset = Math.max(0, parseInt(url.searchParams.get('offset'), 10) || 0);
    const limit = Math.min(
        CHAT_HISTORY_MAX_LIMIT,
        Math.max(1, parseInt(url.searchParams.get('limit'), 10) || CHAT_HISTORY_DEFAULT_LIMIT),
    );
    const { messages, hasMore } = await getMessages(channelId, offset, limit);
    res.statusCode = 200;
    res.end(JSON.stringify({ messages, hasMore }));
}

async function messagesPost(req, res, user, channelId) {
    if (!(await isMember(channelId, user.email))) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Not a member of this channel' }));
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

async function read(req, res, user, channelId) {
    if (!(await isMember(channelId, user.email))) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Not a member of this channel' }));
        return;
    }
    await markRead(channelId, user.email);
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
}

async function notificationLevel(req, res, user, channelId) {
    if (!(await isMember(channelId, user.email))) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Not a member of this channel' }));
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
async function onlineMemberUuids(req, res, user, channelId) {
    if (!(await isMember(channelId, user.email))) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Not a member of this channel' }));
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
    const segments = pathname.split('/').filter(Boolean); // e.g. ['api','channels','create'] or ['api','channels','<id>','messages']
    const afterChannels = segments.slice(segments.indexOf('channels') + 1);

    try {
        if (afterChannels.length === 1 && afterChannels[0] === 'create') {
            const user = await requireAdmin(req, res);
            if (!user) return;
            await create(req, res, user);
            return;
        }
        if (afterChannels.length === 1 && afterChannels[0] === 'list') {
            const user = await requireUser(req, res);
            if (!user) return;
            await list(req, res, user);
            return;
        }
        if (afterChannels.length === 2) {
            const [channelId, action] = afterChannels;
            if (action === 'rename') {
                const user = await requireAdmin(req, res);
                if (!user) return;
                await rename(req, res, user, channelId);
                return;
            }
            if (action === 'members') {
                const user = await requireAdmin(req, res);
                if (!user) return;
                await members(req, res, user, channelId);
                return;
            }
            if (action === 'messages') {
                const user = await requireUser(req, res);
                if (!user) return;
                if (req.method === 'POST') await messagesPost(req, res, user, channelId);
                else await messagesGet(req, res, user, channelId);
                return;
            }
            if (action === 'read') {
                const user = await requireUser(req, res);
                if (!user) return;
                await read(req, res, user, channelId);
                return;
            }
            if (action === 'notification-level') {
                const user = await requireUser(req, res);
                if (!user) return;
                await notificationLevel(req, res, user, channelId);
                return;
            }
            if (action === 'online-member-uuids') {
                const user = await requireUser(req, res);
                if (!user) return;
                await onlineMemberUuids(req, res, user, channelId);
                return;
            }
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Not found' }));
    } catch (err) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err.message }));
    }
};
```

- [ ] **Step 2: Verify syntax**

```bash
node --check api/channels/\[...channelsPath\].js
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add api/channels/\[...channelsPath\].js
git commit -m "Add channels API: create, rename, members, messages, read, notification-level, online-member-uuids"
```

- [ ] **Step 4: Verify with curl (after deploy)**

```bash
echo "create without auth (expect 401):"
curl -s -o /dev/null -w "%{http_code}\n" https://pxlcode-workplace.vercel.app/api/channels/create -X POST -d '{"name":"Test"}'
echo "list without auth (expect 401):"
curl -s -o /dev/null -w "%{http_code}\n" https://pxlcode-workplace.vercel.app/api/channels/list
echo "unknown route (expect 404):"
curl -s -o /dev/null -w "%{http_code}\n" https://pxlcode-workplace.vercel.app/api/channels/nonexistent-route-xyz
```

Expected: `401`, `401`, `404`.

---

### Task 4: Frontend channels store with real-time badge

**Files:**
- Modify: `play/src/front/Connection/RoomConnection.ts:1515` (widen the `kind` parameter type)
- Create: `play/src/front/Chat/Stores/ChannelsStore.ts`

**Interfaces:**
- Consumes: `RoomConnection.emitSocialSignalRequest`, `RoomConnection.socialSignalReceivedStream` (existing, widened); `gameManager.getCurrentGameScene().connection` (existing, `play/src/front/Phaser/Game/GameScene.ts:297`); the API routes from Task 3.
- Produces: `channelsStore` (a Svelte writable store of `{id, name, unreadCount, notificationLevel}[]`), `selectedChannelStore` (writable `Channel | undefined`), `refreshChannels()`, `postChannelMessage(channelId, message)`, `markChannelRead(channelId)`, `setChannelNotificationLevel(channelId, level)` — all consumed by Task 5 (UI components).

- [ ] **Step 1: Widen `emitSocialSignalRequest`'s `kind` parameter**

In `play/src/front/Connection/RoomConnection.ts`, change:

```typescript
    public emitSocialSignalRequest(receiverUserUuid: string, kind: "wave" | "ping", receiverUserId?: number): void {
```

to:

```typescript
    public emitSocialSignalRequest(receiverUserUuid: string, kind: string, receiverUserId?: number): void {
```

This is a backward-compatible widening (`"wave" | "ping"` is already assignable to `string`); no other call site needs to change. It lets channels pass `"channel:" + channelId` without a new protobuf message (see this plan's "Deviations from the design doc" section).

- [ ] **Step 2: Write `play/src/front/Chat/Stores/ChannelsStore.ts`**

```typescript
import { writable, get } from "svelte/store";
import { gameManager } from "../../Phaser/Game/GameManager";

export interface Channel {
    id: string;
    name: string;
    unreadCount: number;
    notificationLevel: "all" | "none";
}

export const channelsStore = writable<Channel[]>([]);
export const selectedChannelStore = writable<Channel | undefined>(undefined);

const CHANNEL_SIGNAL_PREFIX = "channel:";
let subscribed = false;

export async function refreshChannels(): Promise<void> {
    const res = await fetch("/api/channels/list");
    if (!res.ok) return;
    const { channels } = await res.json();
    channelsStore.set(
        channels.map((c: { id: string; name: string; unreadCount: number; notificationLevel: "all" | "none" }) => ({
            id: c.id,
            name: c.name,
            unreadCount: c.unreadCount,
            notificationLevel: c.notificationLevel,
        })),
    );
    ensureSocialSignalSubscription();
}

function ensureSocialSignalSubscription(): void {
    if (subscribed) return;
    const connection = gameManager.getCurrentGameScene().connection;
    if (!connection) return;
    subscribed = true;
    connection.socialSignalReceivedStream.subscribe((payload) => {
        if (!payload.kind.startsWith(CHANNEL_SIGNAL_PREFIX)) return;
        const channelId = payload.kind.slice(CHANNEL_SIGNAL_PREFIX.length);
        const channels = get(channelsStore);
        const channel = channels.find((c) => c.id === channelId);
        if (!channel) return; // not a member (shouldn't normally happen; server only signals members)
        if (channel.notificationLevel === "none") return;
        const selected = get(selectedChannelStore);
        if (selected && selected.id === channelId) return; // already viewing it, no badge needed
        channelsStore.set(
            channels.map((c) => (c.id === channelId ? { ...c, unreadCount: c.unreadCount + 1 } : c)),
        );
    });
}

export async function postChannelMessage(channelId: string, message: string): Promise<void> {
    await fetch(`/api/channels/${channelId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
    });

    // Instant badge for other online members: reuses the existing wave/ping socket
    // signal (see RoomConnection.emitSocialSignalRequest) rather than a new protobuf
    // message. Content never rides this signal - only channelId, via the "kind" string.
    try {
        const uuidsRes = await fetch(`/api/channels/${channelId}/online-member-uuids`);
        if (!uuidsRes.ok) return;
        const { uuids } = await uuidsRes.json();
        const connection = gameManager.getCurrentGameScene().connection;
        if (!connection) return;
        for (const uuid of uuids as string[]) {
            connection.emitSocialSignalRequest(uuid, CHANNEL_SIGNAL_PREFIX + channelId);
        }
    } catch (e) {
        console.error("[channels] failed to send real-time notification signal", e);
    }
}

export async function markChannelRead(channelId: string): Promise<void> {
    await fetch(`/api/channels/${channelId}/read`, { method: "POST" });
    channelsStore.set(get(channelsStore).map((c) => (c.id === channelId ? { ...c, unreadCount: 0 } : c)));
}

export async function setChannelNotificationLevel(channelId: string, level: "all" | "none"): Promise<void> {
    await fetch(`/api/channels/${channelId}/notification-level`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level }),
    });
    channelsStore.set(get(channelsStore).map((c) => (c.id === channelId ? { ...c, notificationLevel: level } : c)));
}
```

`GET /api/channels/list` (Task 3, updated below) returns each channel's persisted `notificationLevel`, so this survives page reloads — not reset to a hardcoded default each time.

- [ ] **Step 3: Verify syntax**

```bash
cd play && npx tsc --noEmit src/front/Chat/Stores/ChannelsStore.ts 2>&1 | head -30
```

Expected: no errors referencing `ChannelsStore.ts` itself (unrelated pre-existing project-wide type errors, if any appear from transitively-checked files, are not this task's concern — only errors whose file path is `ChannelsStore.ts` or `RoomConnection.ts` matter here).

- [ ] **Step 4: Commit**

```bash
git add play/src/front/Connection/RoomConnection.ts play/src/front/Chat/Stores/ChannelsStore.ts
git commit -m "Add ChannelsStore with real-time unread badges via reused social-signal socket"
```

---

### Task 5: Channels UI in the chat bubble

**Files:**
- Create: `play/src/front/Chat/Components/ChannelsSection.svelte`
- Create: `play/src/front/Chat/Components/CreateChannelModal.svelte`
- Create: `play/src/front/Chat/Components/ChannelPanel.svelte`
- Modify: `play/src/front/Chat/Components/RoomList.svelte`

**Interfaces:**
- Consumes: `channelsStore`, `selectedChannelStore`, `refreshChannels`, `postChannelMessage`, `markChannelRead`, `setChannelNotificationLevel` (Task 4); `GET /api/admission/known-members` (existing, deployed); `POST /api/channels/create`, `PATCH /api/channels/:id/rename`, `POST /api/channels/:id/members` (Task 3).
- Produces: nothing further (terminal UI layer).

- [ ] **Step 1: Write `play/src/front/Chat/Components/CreateChannelModal.svelte`**

```svelte
<script lang="ts">
    import { refreshChannels } from "../Stores/ChannelsStore";

    interface Props {
        onClose: () => void;
    }

    let { onClose }: Props = $props();

    let name = $state("");
    let members = $state<{ email: string; online: boolean }[]>([]);
    let selectedEmails = $state<Set<string>>(new Set());
    let loading = $state(true);
    let error = $state("");

    async function loadMembers() {
        try {
            const res = await fetch("/api/admission/known-members");
            const { members: fetched } = await res.json();
            members = fetched;
        } catch (e) {
            error = "Failed to load members";
        } finally {
            loading = false;
        }
    }
    loadMembers();

    function toggle(email: string) {
        const next = new Set(selectedEmails);
        if (next.has(email)) next.delete(email);
        else next.add(email);
        selectedEmails = next;
    }

    async function create() {
        if (!name.trim()) {
            error = "Channel name is required";
            return;
        }
        try {
            const res = await fetch("/api/channels/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name.trim(), memberEmails: Array.from(selectedEmails) }),
            });
            if (!res.ok) {
                const data = await res.json();
                error = data.error || "Failed to create channel";
                return;
            }
            await refreshChannels();
            onClose();
        } catch (e) {
            error = "Failed to create channel";
        }
    }
</script>

<div class="fixed inset-0 z-[400] bg-black/50 flex items-center justify-center" onclick={onClose}>
    <div
        class="bg-[#1e293b] rounded-lg p-4 w-full max-w-sm text-white"
        onclick={(e) => e.stopPropagation()}
    >
        <h2 class="text-lg font-bold mb-3">New channel</h2>
        <input
            bind:value={name}
            placeholder="Channel name"
            class="w-full mb-3 px-3 py-2 rounded bg-[#0f172a] border border-[#334155] text-white"
        />
        {#if loading}
            <p class="text-sm text-white/50">Loading members…</p>
        {:else}
            <div class="max-h-48 overflow-y-auto flex flex-col gap-1 mb-3">
                {#each members as member (member.email)}
                    <label class="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/10 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={selectedEmails.has(member.email)}
                            onchange={() => toggle(member.email)}
                        />
                        <span class="text-sm">{member.email}</span>
                    </label>
                {/each}
            </div>
        {/if}
        {#if error}
            <p class="text-sm text-red-400 mb-2">{error}</p>
        {/if}
        <div class="flex gap-2 justify-end">
            <button class="px-3 py-1.5 rounded text-white/70 hover:text-white" onclick={onClose}>Cancel</button>
            <button class="px-3 py-1.5 rounded bg-emerald-500 text-[#0f172a] font-semibold" onclick={create}
                >Create</button
            >
        </div>
    </div>
</div>
```

- [ ] **Step 2: Write `play/src/front/Chat/Components/ChannelPanel.svelte`**

```svelte
<script lang="ts">
    import { onMount } from "svelte";
    import {
        selectedChannelStore,
        markChannelRead,
        postChannelMessage,
        setChannelNotificationLevel,
        type Channel,
    } from "../Stores/ChannelsStore";

    interface Props {
        channel: Channel;
    }

    let { channel }: Props = $props();

    interface ChannelMessage {
        author: string;
        message: string;
        ts: number;
    }

    let messages = $state<ChannelMessage[]>([]);
    let draft = $state("");
    let loading = $state(true);

    const isAdminUser =
        typeof window !== "undefined" && (window as unknown as { __waIsAdmin?: boolean }).__waIsAdmin === true;

    async function loadMessages() {
        loading = true;
        const res = await fetch(`/api/channels/${channel.id}/messages?limit=50`);
        const data = await res.json();
        messages = data.messages;
        loading = false;
    }

    onMount(() => {
        loadMessages();
        markChannelRead(channel.id);
    });

    async function send() {
        if (!draft.trim()) return;
        const text = draft;
        draft = "";
        await postChannelMessage(channel.id, text);
        await loadMessages();
    }

    async function toggleNotifications() {
        const next = channel.notificationLevel === "all" ? "none" : "all";
        await setChannelNotificationLevel(channel.id, next);
    }

    async function rename() {
        const newName = prompt("Rename channel", channel.name);
        if (!newName || !newName.trim()) return;
        await fetch(`/api/channels/${channel.id}/rename`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: newName.trim() }),
        });
    }

    function close() {
        selectedChannelStore.set(undefined);
    }
</script>

<div class="flex flex-col h-full text-white">
    <div class="flex items-center gap-2 px-3 py-2 border-b border-white/10">
        <button class="text-white/60 hover:text-white" onclick={close}>&larr;</button>
        <div class="font-bold flex-1 truncate"># {channel.name}</div>
        {#if isAdminUser}
            <button class="text-xs text-white/50 hover:text-white" onclick={rename}>Rename</button>
        {/if}
        <button class="text-xs text-white/50 hover:text-white" onclick={toggleNotifications}>
            {channel.notificationLevel === "all" ? "All messages" : "Nothing"}
        </button>
    </div>
    <div class="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">
        {#if loading}
            <p class="text-sm text-white/50">Loading…</p>
        {:else}
            {#each messages as msg, i (i)}
                <div class="text-sm">
                    <span class="font-semibold">{msg.author}:</span>
                    <span>{msg.message}</span>
                </div>
            {/each}
        {/if}
    </div>
    <div class="flex gap-2 px-3 py-2 border-t border-white/10">
        <input
            bind:value={draft}
            placeholder="Message #{channel.name}"
            class="flex-1 px-3 py-2 rounded bg-[#0f172a] border border-[#334155] text-white text-sm"
            onkeydown={(e) => {
                if (e.key === "Enter") send();
            }}
        />
        <button class="px-3 py-2 rounded bg-emerald-500 text-[#0f172a] font-semibold text-sm" onclick={send}
            >Send</button
        >
    </div>
</div>
```

- [ ] **Step 3: Write `play/src/front/Chat/Components/ChannelsSection.svelte`**

```svelte
<script lang="ts">
    import { onMount } from "svelte";
    import { channelsStore, selectedChannelStore, refreshChannels } from "../Stores/ChannelsStore";
    import CreateChannelModal from "./CreateChannelModal.svelte";

    let displayChannels = $state(false);
    let showCreateModal = $state(false);

    const isAdminUser =
        typeof window !== "undefined" && (window as unknown as { __waIsAdmin?: boolean }).__waIsAdmin === true;

    onMount(() => {
        refreshChannels();
    });

    function toggleDisplay() {
        displayChannels = !displayChannels;
    }

    function selectChannel(channel: (typeof $channelsStore)[number]) {
        selectedChannelStore.set(channel);
    }
</script>

<div
    class="group relative px-3 m-0 rounded-none text-white/75 hover:text-white h-11 hover:bg-contrast-200/10 w-full flex items-center gap-1 border border-solid border-x-0 border-t border-b-0 border-white/10"
>
    <button
        type="button"
        class="flex items-center min-w-0 flex-1 text-start m-0 p-0 h-full bg-transparent border-0 cursor-pointer text-inherit"
        onclick={toggleDisplay}
    >
        <div class="text-white text-sm font-bold tracking-widest uppercase truncate">Channels</div>
    </button>
</div>

{#if displayChannels}
    <div class="flex flex-col px-2 pb-2">
        {#each $channelsStore as channel (channel.id)}
            <button
                class="flex items-center justify-between px-2 py-2 rounded hover:bg-white/10 text-sm text-white/80 hover:text-white text-left"
                onclick={() => selectChannel(channel)}
            >
                <span class="truncate"># {channel.name}</span>
                {#if channel.unreadCount > 0 && channel.notificationLevel !== "none"}
                    <span class="ml-2 px-1.5 rounded-full bg-emerald-500 text-[#0f172a] text-xs font-bold">
                        {channel.unreadCount}
                    </span>
                {/if}
            </button>
        {/each}
        {#if isAdminUser}
            <button
                class="flex items-center gap-2 px-2 py-2 rounded hover:bg-white/10 text-sm text-white/50 hover:text-white text-left"
                onclick={() => (showCreateModal = true)}
            >
                + Add channel
            </button>
        {/if}
    </div>
{/if}

{#if showCreateModal}
    <CreateChannelModal onClose={() => (showCreateModal = false)} />
{/if}
```

- [ ] **Step 4: Wire into `RoomList.svelte`**

In `play/src/front/Chat/Components/RoomList.svelte`, add the import near the other component imports (alongside `import ProximityRoomRow from "./Room/ProximityRoomRow.svelte";`):

```typescript
    import ChannelsSection from "./ChannelsSection.svelte";
    import ChannelPanel from "./ChannelPanel.svelte";
    import { selectedChannelStore } from "../Stores/ChannelsStore";
```

Insert the `<ChannelsSection />` markup directly after the closing `{/if}` of the "Starred" region and before the `{#if $chatConnectionStatus === "ONLINE"}` block that contains the room invitations/people/rooms sections — i.e., right after the proximity-rooms block:

```svelte
                {#if $proximityRooms.length > 0}
                    <div
                        class="px-2 py-3 border border-solid border-x-0 border-t border-y-0 border-b-0 border-white/10"
                    >
                        <div class="flex flex-col">
                            <ShowMore
                                items={$proximityRooms}
                                maxNumber={8}
                                idKey="id"
                                showNothingToDisplayMessage={false}
                            >
                                {#snippet children({ item: room })}
                                    <ProximityRoomRow {room} />
                                {/snippet}
                            </ShowMore>
                        </div>
                    </div>
                {/if}
                <ChannelsSection />
                {#if $chatConnectionStatus === "ONLINE"}
```

(This adds one line, `<ChannelsSection />`, right before the existing `{#if $chatConnectionStatus === "ONLINE"}` line — do not modify anything inside that `{#if}` block itself.)

Finally, in the region where the room list and timeline split into two panes (the existing `{#if $selectedRoomStore !== undefined}` / `{:else if ...}` block near the bottom of the file), add a channel-panel branch. Change:

```svelte
    {#if $selectedRoomStore !== undefined}
```

to:

```svelte
    {#if $selectedChannelStore !== undefined}
        <div class="overflow-y-auto min-w-0">
            <ChannelPanel channel={$selectedChannelStore} />
        </div>
    {:else if $selectedRoomStore !== undefined}
```

- [ ] **Step 5: Verify syntax**

```bash
cd play && npx svelte-check --output human 2>&1 | grep -A5 "ChannelsSection.svelte\|CreateChannelModal.svelte\|ChannelPanel.svelte\|RoomList.svelte" | head -100
```

Expected: no errors reported for these four files (pre-existing unrelated errors elsewhere in the project, if any, are not this task's concern).

- [ ] **Step 6: Commit**

```bash
git add play/src/front/Chat/Components/ChannelsSection.svelte play/src/front/Chat/Components/CreateChannelModal.svelte play/src/front/Chat/Components/ChannelPanel.svelte play/src/front/Chat/Components/RoomList.svelte
git commit -m "Add Channels section, create-channel modal, and channel panel to the chat bubble"
```

---

### Task 6: Deploy and replicate to vings-workplace

**Files:** none (git/deploy operations only)

- [ ] **Step 1: Push all commits from Tasks 1-5 to `pxlcode-workplace`**

```bash
git push origin pxlcode-workplace
```

- [ ] **Step 2: Confirm the deployed routes respond**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://pxlcode-workplace.vercel.app/api/channels/list
curl -s -o /dev/null -w "%{http_code}\n" https://pxlcode-workplace.vercel.app/api/channels/create -X POST
curl -s -o /dev/null -w "%{http_code}\n" https://pxlcode-workplace.vercel.app/api/channels/nonexistent-route-xyz
```

Expected: `401`, `401`, `404`.

- [ ] **Step 3: Manual browser verification**

As an admin user: confirm the "Channels" section appears in the chat sidebar with "+ Add channel" visible; create a channel with at least one other member; confirm it appears in the list. As a non-admin member of that channel (second browser session): confirm "+ Add channel" is NOT visible, the channel appears in their list, opening it shows the message history, sending a message from one session produces an instant unread badge in the other session's sidebar (without reloading), and setting notification level to "Nothing" suppresses the badge on the next message.

- [ ] **Step 4: Replicate the same commits to `master` (vings-workplace)**

```bash
git fetch origin master
git checkout -b tmp-channels origin/master
git cherry-pick <first-commit-sha-from-task-1>^..<last-commit-sha-from-task-5>
git push origin tmp-channels:master
git checkout pxlcode-workplace
git branch -D tmp-channels
```

(Replace the two SHAs with the actual first/last commit hashes from this plan's Tasks 1-5, once they exist.)

- [ ] **Step 5: Confirm vings-workplace deployed too**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://vings-workplace.vercel.app/api/channels/list
```

Expected: `401`.
