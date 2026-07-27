# Targeted Guest Admission + Last-Room Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broadcast-to-everyone guest admission popup with a targeted "who are you here to see?" picker, and give returning registered users a persisted last-room spawn instead of always seeing the seat-picker.

**Architecture:** Extends the existing `api/admission/[...admissionPath].js` Vercel serverless catch-all and its Redis-backed `wa:pending-admission` hash with new keys for presence and last-room, plus two new sub-routes on the same catch-all. Frontend changes are confined to `play/public/scripts/admission-script.html`, reusing the `WA.room.onEnterZone`/`onLeaveZone` scripting API (already used elsewhere in WorkAdventure) to track the local player's current named zone, and `WA.player.teleport(x, y)` (the same mechanism `seat-picker.html` already uses) to move players on admission/return.

**Tech Stack:** Node.js Vercel serverless functions, hand-rolled Redis client (`api/_lib/redis.js`, RESP2 over raw TCP — no external Redis package), WorkAdventure scripting API (`WA.*` global, injected via `iframe_api.js`).

## Global Constraints

- Room identity is by **name only** (e.g. `"Conference 01"`), not x/y coordinates — matches the spec's "same room/area" decision, not exact-position tracking.
- All new Redis keys are prefixed `wa:` to match existing convention (`wa:admins`, `wa:approved`, `wa:pending-admission`, `wa:uuid-email:*`).
- No unit test framework exists for `api/*` serverless handlers in this repo (confirmed: no `package.json`/test runner under `api/`) — verification steps in this plan use direct `curl` against the deployed Vercel preview, matching how every other feature in this session (chat history, wave/ping, seats) was verified. Do not introduce a new test framework as part of this plan.
- This plan targets the `pxlcode-workplace` branch first (per user instruction to build there); Task 8 covers replicating the same commits to `master` for `vings-workplace`, matching the pattern used for every prior feature this session.
- Known zone names for this deployment's map (used for zone tracking, hardcoded — this is inherent to the map, not a general abstraction): `"Special rooom 01"`, `"Conference 01"`, `"Conference 02"`, `"Demo rooom 1"`, `"Demo Room 2"`, `"Demo Room 3"` (exact spelling/capitalization as they appear in `map.wam`, including the existing typo in "rooom").

---

### Task 1: Presence and last-room Redis helpers

**Files:**
- Create: `api/_lib/presence.js`
- Test: manual (`node -e` scratch script against a real Redis instance, see Step 2)

**Interfaces:**
- Consumes: `withRedis(url, fn)` and `REDIS_URL` from `api/_lib/redis.js` and `api/_lib/admin.js` (existing).
- Produces: `heartbeat(email)`, `listKnownMembers()` → `Promise<{email: string, online: boolean}[]>`, `setLastRoom(email, room)`, `getLastRoom(email)` → `Promise<string|null>` — all consumed by Task 3 and Task 4.

- [ ] **Step 1: Write `api/_lib/presence.js`**

```javascript
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
```

- [ ] **Step 2: Manually verify against real Redis**

Run from the repo root, with `ADMIN_REDIS_URL` set to the deployment's actual Redis URL (same one already used by `api/_lib/admin.js` in production — check Vercel project env vars for the exact value, do not hardcode it in the script):

```bash
ADMIN_REDIS_URL="<the deployment's real redis:// URL>" node -e "
const { heartbeat, listKnownMembers, setLastRoom, getLastRoom } = require('./api/_lib/presence');
(async () => {
    await heartbeat('test@example.com');
    await setLastRoom('test@example.com', 'Conference 01');
    console.log('getLastRoom:', await getLastRoom('test@example.com'));
    console.log('listKnownMembers sample:', await listKnownMembers());
})();
"
```

Expected output: `getLastRoom: Conference 01`, and a `listKnownMembers` array that includes `{email: 'test@example.com', online: true}` (confirming the heartbeat took effect), plus this deployment's real admin/approved entries.

- [ ] **Step 3: Commit**

```bash
git add api/_lib/presence.js
git commit -m "Add presence and last-room Redis helpers for guest admission redesign"
```

---

### Task 2: Room-coordinate resolution helper

**Files:**
- Modify: `api/_lib/mapStorage.js` (add one exported function, do not change existing `fetchWam`/`patchWam`)
- Test: manual (`curl` against the deployed `/api/admission/room` route added in Task 4, since this helper has no route of its own — verified indirectly there)

**Interfaces:**
- Consumes: `fetchWam()` (existing, returns the parsed `map.wam` JSON with a top-level `areas` array, each `{id, name, x, y, width, height, properties}}` — confirmed shape from `api/seats/[...seatsPath].js`).
- Produces: `resolveRoomCoordinates(wam, roomName)` → `{x: number, y: number} | null`, consumed by Task 4.

- [ ] **Step 1: Read the current file to confirm exact export style**

Run: `cat api/_lib/mapStorage.js` — confirm it currently exports `{ fetchWam, patchWam }` via `module.exports` at the bottom (per the existing `api/seats/[...seatsPath].js` import `require('../_lib/mapStorage')`), so the new export can be added to the same object without touching existing exports.

- [ ] **Step 2: Add `resolveRoomCoordinates` to `api/_lib/mapStorage.js`**

Add this function above the `module.exports` line, and add `resolveRoomCoordinates` to the exported object (alongside the existing `fetchWam, patchWam`):

```javascript
// Resolves a named area (e.g. "Conference 01") from a fetched .wam's areas array into
// its center coordinates, for teleporting a player there. Returns null if no area with
// that exact name exists (e.g. the map was edited and the room was renamed/removed).
function resolveRoomCoordinates(wam, roomName) {
    const area = wam.areas.find((a) => a.name === roomName);
    if (!area) return null;
    return { x: area.x + area.width / 2, y: area.y + area.height / 2 };
}
```

- [ ] **Step 3: Commit**

```bash
git add api/_lib/mapStorage.js
git commit -m "Add resolveRoomCoordinates helper for room-name-to-teleport-target lookup"
```

---

### Task 3: Add known-members and heartbeat routes

**Files:**
- Modify: `api/admission/[...admissionPath].js`

**Interfaces:**
- Consumes: `listKnownMembers()`, `heartbeat(email)` from `api/_lib/presence.js` (Task 1); `requireUser` (existing, from `../_lib/requireUser`).
- Produces: `GET /api/admission/known-members` (no auth — guests need this for the picker) → `{members: [{email, online}]}`; `POST /api/admission/heartbeat` (requireUser) → `{success: true}`. Consumed by Task 6 (guest picker) and Task 7 (registered-user heartbeat loop).

- [ ] **Step 1: Add the import and two new handler functions**

Add to the top of `api/admission/[...admissionPath].js`, alongside the existing imports:

```javascript
const { listKnownMembers, heartbeat } = require('../_lib/presence');
```

Add these two functions after `identity` (before `resolveConversationKey`):

```javascript
// No auth required: guests need this to populate the "who are you here to see?" picker
// before they have any session at all.
async function knownMembers(req, res) {
    const members = await listKnownMembers();
    res.statusCode = 200;
    res.end(JSON.stringify({ members }));
}

// Requires a signed-in (non-guest) user. Called periodically by their client to stay
// "Active now" in the known-members list (see PRESENCE_TTL_SECONDS in presence.js).
async function heartbeatRoute(req, res) {
    const user = await requireUser(req, res);
    if (!user) return;
    await heartbeat(user.email);
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
}
```

- [ ] **Step 2: Wire both into the router**

In the `module.exports` router function, add two branches alongside the existing `if (segment === 'identity')` block:

```javascript
        } else if (segment === 'known-members') {
            await knownMembers(req, res);
        } else if (segment === 'heartbeat') {
            await heartbeatRoute(req, res);
```

(Insert directly after the `identity` branch, before the final `else` 404 fallback.)

- [ ] **Step 3: Commit**

```bash
git add api/admission/\[...admissionPath\].js
git commit -m "Add known-members and heartbeat routes for guest admission picker"
```

- [ ] **Step 4: Deploy and verify with curl**

Push this branch (see Task 8 for the full push/deploy sequence — for now, verify against whatever Vercel preview URL the push produces, or the production domain if already merged):

```bash
curl -s https://pxlcode-workplace.vercel.app/api/admission/known-members
```

Expected: `{"members":[...]}` (200, valid JSON, no auth required — this call should succeed with zero cookies set).

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://pxlcode-workplace.vercel.app/api/admission/heartbeat -X POST
```

Expected: `401` (no `wa_session` cookie sent — confirms `requireUser` is gating this route correctly).

---

### Task 4: Add room persistence route with coordinate resolution

**Files:**
- Modify: `api/admission/[...admissionPath].js`

**Interfaces:**
- Consumes: `setLastRoom(email, room)`, `getLastRoom(email)` from `api/_lib/presence.js` (Task 1); `resolveRoomCoordinates(wam, roomName)`, `fetchWam()` from `api/_lib/mapStorage.js` (Task 2).
- Produces: `POST /api/admission/room` `{room: string}` (requireUser) → `{success: true}`; `GET /api/admission/room` (requireUser) → `{room: string|null, x: number|null, y: number|null}`. Consumed by Task 7 (registered-user last-room read/write).

- [ ] **Step 1: Add the imports**

Add to the top of `api/admission/[...admissionPath].js`:

```javascript
const { setLastRoom, getLastRoom } = require('../_lib/presence');
const { fetchWam, resolveRoomCoordinates } = require('../_lib/mapStorage');
```

- [ ] **Step 2: Add the two handler functions**

Add after `heartbeatRoute` (from Task 3):

```javascript
// Requires a signed-in (non-guest) user. Persists their current named zone so it can be
// restored as their spawn point next login, instead of always showing the seat-picker.
async function roomPost(req, res) {
    const user = await requireUser(req, res);
    if (!user) return;

    const parsed = await readBody(req);
    if (parsed === null || !parsed.room) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing room' }));
        return;
    }

    await setLastRoom(user.email, parsed.room);
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
}

// Requires a signed-in (non-guest) user. Returns their persisted last room, resolved to
// teleport-target coordinates via the current map (so a rename/move of the room since
// they last logged out doesn't silently teleport them to a stale position).
async function roomGet(req, res) {
    const user = await requireUser(req, res);
    if (!user) return;

    const room = await getLastRoom(user.email);
    if (!room) {
        res.statusCode = 200;
        res.end(JSON.stringify({ room: null, x: null, y: null }));
        return;
    }

    const wam = await fetchWam();
    const coords = resolveRoomCoordinates(wam, room);
    if (!coords) {
        // The room was renamed or removed since this user last logged out.
        res.statusCode = 200;
        res.end(JSON.stringify({ room: null, x: null, y: null }));
        return;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ room, x: coords.x, y: coords.y }));
}
```

- [ ] **Step 3: Wire into the router**

Add alongside the existing `chat-history` GET/POST branching pattern (method-based dispatch on the same segment):

```javascript
        } else if (segment === 'room') {
            if (req.method === 'POST') await roomPost(req, res);
            else await roomGet(req, res);
```

- [ ] **Step 4: Commit**

```bash
git add api/admission/\[...admissionPath\].js
git commit -m "Add room persistence routes (GET/POST /api/admission/room)"
```

- [ ] **Step 5: Verify with curl (after deploy)**

Without a valid `wa_session` cookie, both should 401:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://pxlcode-workplace.vercel.app/api/admission/room
curl -s -o /dev/null -w "%{http_code}\n" https://pxlcode-workplace.vercel.app/api/admission/room -X POST -d '{"room":"Conference 01"}'
```

Expected: `401` for both. Full read/write round-trip verification (with a real session cookie) happens as part of Task 7's manual browser test, since that's where a real signed-in session is easiest to obtain.

---

### Task 5: Target admission requests to a specific member

**Files:**
- Modify: `api/admission/[...admissionPath].js`

**Interfaces:**
- Consumes: nothing new — modifies existing `request` and `pending` functions in place.
- Produces: `POST /api/admission/request` now requires `{name, targetEmail}` (was `{name}`) and stores `target` on the pending entry; `GET /api/admission/pending` now returns only entries where `target === caller's email` (was: all pending entries). Consumed by Task 6 (guest picker) and Task 7 (recognized-user "X wants to join" popup already exists, just now correctly filtered).

- [ ] **Step 1: Modify `request()` to require and store `targetEmail`**

Replace the existing `request` function body:

```javascript
// No auth required: called by a guest who has no session at all.
async function request(req, res) {
    const parsed = await readBody(req);
    if (parsed === null || !parsed.targetEmail) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing name or targetEmail' }));
        return;
    }
    const requestId = crypto.randomBytes(12).toString('hex');

    await withRedis(REDIS_URL, async (client) => {
        await client.command(
            'HSET',
            PENDING_KEY,
            requestId,
            JSON.stringify({
                name: parsed.name || 'Guest',
                target: parsed.targetEmail.toLowerCase(),
                ts: Date.now(),
                status: 'pending',
            }),
        );
    });

    res.statusCode = 200;
    res.end(JSON.stringify({ requestId }));
}
```

- [ ] **Step 2: Modify `pending()` to filter by the caller's email**

Replace the existing `pending` function body:

```javascript
// Requires a signed-in (non-guest) user. Only returns requests targeted at this caller
// (previously returned every pending request to every recognized user).
async function pending(req, res) {
    const user = await requireUser(req, res);
    if (!user) return;

    const raw = await withRedis(REDIS_URL, async (client) => {
        return client.command('HGETALL', PENDING_KEY);
    });

    const requests = [];
    for (let i = 0; i < raw.length; i += 2) {
        const requestId = raw[i];
        try {
            const data = JSON.parse(raw[i + 1]);
            if (
                data.status === 'pending' &&
                Date.now() - data.ts < MAX_AGE_MS &&
                data.target === user.email.toLowerCase()
            ) {
                requests.push({ requestId, name: data.name, ts: data.ts });
            }
        } catch {
            // skip malformed entry
        }
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ requests }));
}
```

- [ ] **Step 3: Commit**

```bash
git add api/admission/\[...admissionPath\].js
git commit -m "Target admission requests at a specific member instead of broadcasting to everyone"
```

- [ ] **Step 4: Verify with curl (after deploy)**

```bash
curl -s https://pxlcode-workplace.vercel.app/api/admission/request -X POST -H "Content-Type: application/json" -d '{"name":"Test Guest"}'
```

Expected: `400 {"error":"Missing name or targetEmail"}` — confirms `targetEmail` is now required.

```bash
curl -s https://pxlcode-workplace.vercel.app/api/admission/request -X POST -H "Content-Type: application/json" -d '{"name":"Test Guest","targetEmail":"someone@example.com"}'
```

Expected: `200 {"requestId":"<hex string>"}`.

---

### Task 6: Add approve-time room capture and status-time coordinate return

**Files:**
- Modify: `api/admission/[...admissionPath].js`

**Interfaces:**
- Consumes: `resolveRoomCoordinates(wam, roomName)`, `fetchWam()` (Task 2).
- Produces: `POST /api/admission/approve` now accepts an optional `{requestId, room}` (was `{requestId}`) and stores the approver's room on the entry; `GET /api/admission/status` now returns `{status, x, y}` when approved with a resolvable room (was just `{status}`). Consumed by Task 6 (guest teleport-on-admit) and Task 7 (recognized-user "Let them in" now sends their current room).

- [ ] **Step 1: Modify `approve()` to capture the approver's current room**

Replace the existing `approve` function body:

```javascript
// Requires a signed-in (non-guest) user. Optionally records the approver's current room
// (their client passes its locally-tracked zone, see admission-script.html) so the guest
// can be spawned into the same room/area as whoever let them in.
async function approve(req, res) {
    const user = await requireUser(req, res);
    if (!user) return;

    const parsed = await readBody(req);
    if (parsed === null || !parsed.requestId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing requestId' }));
        return;
    }

    const updated = await withRedis(REDIS_URL, async (client) => {
        const raw = await client.command('HGET', PENDING_KEY, parsed.requestId);
        if (!raw) return false;
        const data = JSON.parse(raw);
        data.status = 'approved';
        data.approvedBy = user.email;
        if (parsed.room) data.room = parsed.room;
        await client.command('HSET', PENDING_KEY, parsed.requestId, JSON.stringify(data));
        return true;
    });

    if (!updated) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Request not found (may have expired or already been handled)' }));
        return;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
}
```

- [ ] **Step 2: Modify `status()` to resolve and return coordinates on approval**

Replace the existing `status` function body:

```javascript
// No auth required: the waiting guest polls this.
async function status(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const requestId = url.searchParams.get('requestId');
    if (!requestId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing requestId' }));
        return;
    }

    const raw = await withRedis(REDIS_URL, async (client) => {
        return client.command('HGET', PENDING_KEY, requestId);
    });

    if (!raw) {
        res.statusCode = 200;
        res.end(JSON.stringify({ status: 'not_found' }));
        return;
    }

    const data = JSON.parse(raw);

    if (data.status !== 'approved') {
        res.statusCode = 200;
        res.end(JSON.stringify({ status: data.status }));
        return;
    }

    // Once the waiting client has seen "approved", consume the entry so it can't be reused.
    await withRedis(REDIS_URL, async (client) => {
        await client.command('HDEL', PENDING_KEY, requestId);
    });

    let coords = null;
    if (data.room) {
        const wam = await fetchWam();
        coords = resolveRoomCoordinates(wam, data.room);
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'approved', x: coords ? coords.x : null, y: coords ? coords.y : null }));
}
```

- [ ] **Step 3: Commit**

```bash
git add api/admission/\[...admissionPath\].js
git commit -m "Capture approver's room on approval and return teleport coordinates on status"
```

- [ ] **Step 4: Verify with curl (after deploy) — full round trip without a browser**

```bash
REQ=$(curl -s https://pxlcode-workplace.vercel.app/api/admission/request -X POST -H "Content-Type: application/json" -d '{"name":"Curl Test","targetEmail":"nobody@example.com"}' | node -e "process.stdin.once('data', d => console.log(JSON.parse(d).requestId))")
curl -s "https://pxlcode-workplace.vercel.app/api/admission/status?requestId=$REQ"
```

Expected: `{"status":"pending"}` (no one has approved it — this just confirms the request/status pairing still works with the new fields present).

---

### Task 7: Guest picker UI

**Files:**
- Modify: `play/public/scripts/admission-script.html`

**Interfaces:**
- Consumes: `GET /api/admission/known-members`, `POST /api/admission/request`, `GET /api/admission/status` (all from Tasks 3, 5, 6).
- Produces: replaces the guest branch's blank waiting popup with a searchable picker; no new interfaces for other tasks to consume (this is the guest-facing terminal UI).

- [ ] **Step 1: Replace `waitForApproval` with a picker-driven flow**

In `play/public/scripts/admission-script.html`, replace the entire `waitForApproval` function with:

```javascript
    async function fetchKnownMembers() {
        const res = await fetch('/api/admission/known-members');
        const { members } = await res.json();
        return members;
    }

    function renderPicker(members, onSelect) {
        const overlay = document.createElement('div');
        overlay.id = 'guest-picker-overlay';
        overlay.style.cssText =
            'position:fixed;inset:0;z-index:99999;background:#0f172a;color:#e2e8f0;display:flex;' +
            'flex-direction:column;align-items:center;justify-content:center;font-family:system-ui,sans-serif;padding:2rem;';
        overlay.innerHTML =
            '<h1 style="font-size:1.5rem;margin-bottom:0.25rem;">Who are you here to see?</h1>' +
            '<p style="color:#94a3b8;margin-bottom:1.5rem;">Selected member will let you in</p>' +
            '<input id="guest-picker-search" placeholder="Search members" style="width:100%;max-width:340px;' +
            'padding:0.6rem 0.9rem;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#e2e8f0;margin-bottom:1rem;">' +
            '<div id="guest-picker-list" style="width:100%;max-width:340px;max-height:280px;overflow-y:auto;display:flex;flex-direction:column;gap:0.4rem;"></div>' +
            '<button id="guest-picker-notify" disabled style="margin-top:1.25rem;width:100%;max-width:340px;' +
            'padding:0.75rem;border-radius:8px;border:none;background:#334155;color:#64748b;font-weight:600;cursor:not-allowed;">Notify member</button>';
        document.body.appendChild(overlay);

        const listEl = overlay.querySelector('#guest-picker-list');
        const searchEl = overlay.querySelector('#guest-picker-search');
        const notifyBtn = overlay.querySelector('#guest-picker-notify');
        let selected = null;

        function renderList(filter) {
            listEl.innerHTML = '';
            members
                .filter((m) => m.email.toLowerCase().includes(filter.toLowerCase()))
                .sort((a, b) => Number(b.online) - Number(a.online))
                .forEach((m) => {
                    const row = document.createElement('div');
                    row.textContent = m.email + (m.online ? ' — Active now' : ' — Offline');
                    row.style.cssText =
                        'padding:0.6rem 0.9rem;border-radius:8px;border:1px solid #334155;' +
                        (m.online ? 'cursor:pointer;' : 'opacity:0.4;cursor:not-allowed;') +
                        (selected === m.email ? 'background:#334155;' : 'background:#1e293b;');
                    if (m.online) {
                        row.addEventListener('click', () => {
                            selected = m.email;
                            notifyBtn.disabled = false;
                            notifyBtn.style.background = '#10b981';
                            notifyBtn.style.color = '#0f172a';
                            notifyBtn.style.cursor = 'pointer';
                            renderList(searchEl.value);
                        });
                    }
                    listEl.appendChild(row);
                });
        }
        renderList('');
        searchEl.addEventListener('input', () => renderList(searchEl.value));
        notifyBtn.addEventListener('click', () => {
            if (selected) onSelect(selected, overlay);
        });

        return overlay;
    }

    async function waitForApproval(name) {
        WA.controls.disablePlayerControls();

        let currentRequestId = null;
        let pollTimer = null;

        function stopPolling() {
            if (pollTimer) clearTimeout(pollTimer);
        }

        async function sendRequestTo(targetEmail) {
            stopPolling();
            const reqRes = await fetch('/api/admission/request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, targetEmail }),
            });
            const { requestId } = await reqRes.json();
            currentRequestId = requestId;
            poll();
        }

        function poll() {
            pollTimer = setTimeout(async () => {
                try {
                    const statusRes = await fetch('/api/admission/status?requestId=' + encodeURIComponent(currentRequestId));
                    const data = await statusRes.json();
                    if (data.status === 'approved') {
                        stopPolling();
                        pickerOverlay.remove();
                        if (data.x !== null && data.y !== null) {
                            await WA.player.teleport(data.x, data.y);
                        }
                        WA.controls.restorePlayerControls();
                        return;
                    }
                } catch (e) {
                    console.error('[admission] poll error', e);
                }
                poll();
            }, 3000);
        }

        const members = await fetchKnownMembers();
        const pickerOverlay = renderPicker(members, (targetEmail, overlay) => {
            sendRequestTo(targetEmail);
            // Allow picking someone else without waiting for the first target to respond:
            // re-render with a "choose someone else" affordance is just re-showing the same
            // picker's search+list, which stays interactive underneath the notify action.
        });
    }
```

- [ ] **Step 2: Manual verification (no browser test harness exists for this repo's scripting-API pages — verify by hand)**

After deploying (Task 8), open `https://pxlcode-workplace.vercel.app/` in an incognito window (no `wa_user` cookie) and confirm:
1. The "Who are you here to see?" picker appears instead of the old blank waiting popup.
2. Typing in the search box filters the member list.
3. Offline members render grayed out and are not clickable.
4. Clicking an online member highlights it and enables "Notify member".
5. Clicking "Notify member" — in a second, separately signed-in browser session as that target member — triggers their "X wants to join" popup (verifying Task 5's targeting also works end-to-end).
6. Clicking a *different* online member after already notifying one does not error and creates a fresh request (verifying the cancel-and-repick behavior).

- [ ] **Step 3: Commit**

```bash
git add play/public/scripts/admission-script.html
git commit -m "Replace broadcast guest admission popup with targeted member picker"
```

---

### Task 8: Registered-user last-room persistence, heartbeat, and zone tracking

**Files:**
- Modify: `play/public/scripts/admission-script.html`

**Interfaces:**
- Consumes: `GET /api/admission/room`, `POST /api/admission/room`, `POST /api/admission/heartbeat` (Tasks 3, 4); `WA.room.onEnterZone`/`onLeaveZone`, `WA.player.teleport` (existing WorkAdventure scripting API, confirmed present in `play/src/iframe_api.ts`).
- Produces: none — this is the terminal consumer of the recognized-user flow.

- [ ] **Step 1: Add zone tracking and heartbeat, wire into the recognized-user branch**

In the `WA.onInit().then(...)` recognized-user branch (the `else` path after the guest check), replace the block from `// Recognized (non-guest) user: enters immediately...` through the `pollPendingAdmissions();` call with:

```javascript
        // Recognized (non-guest) user: enters immediately, no wait.

        const KNOWN_ZONES = [
            'Special rooom 01',
            'Conference 01',
            'Conference 02',
            'Demo rooom 1',
            'Demo Room 2',
            'Demo Room 3',
        ];
        let currentZone = null;
        KNOWN_ZONES.forEach((zoneName) => {
            WA.room.onEnterZone(zoneName, () => {
                currentZone = zoneName;
            });
            WA.room.onLeaveZone(zoneName, () => {
                if (currentZone === zoneName) currentZone = null;
            });
        });

        // Keep this user's presence fresh in the known-members list (see PRESENCE_TTL_SECONDS
        // in api/_lib/presence.js — must heartbeat more often than that TTL).
        setInterval(() => {
            fetch('/api/admission/heartbeat', { method: 'POST' }).catch((e) =>
                console.error('[admission] heartbeat failed', e),
            );
        }, 20000);
        fetch('/api/admission/heartbeat', { method: 'POST' }).catch((e) =>
            console.error('[admission] initial heartbeat failed', e),
        );

        // Persist the current zone on the way out, so it can be restored next login.
        window.addEventListener('beforeunload', () => {
            if (currentZone) {
                navigator.sendBeacon(
                    '/api/admission/room',
                    new Blob([JSON.stringify({ room: currentZone })], { type: 'application/json' }),
                );
            }
        });

        // If we have a persisted last room, spawn there and skip the seat-picker entirely.
        // Otherwise (first-ever login), fall back to today's seat-picker behavior.
        const lastRoomRes = await fetch('/api/admission/room');
        const lastRoom = await lastRoomRes.json();
        if (lastRoom.room && lastRoom.x !== null && lastRoom.y !== null) {
            await WA.player.teleport(lastRoom.x, lastRoom.y);
        } else {
            await offerSeatPicker();
        }

        // Let them reopen the seat picker anytime from the menu, not just once at join
        // (e.g. if they skipped it, or want to switch desks later).
        WA.ui.registerMenuCommand('Choose my seat', () => {
            offerSeatPicker().catch((e) => console.error('[admission] seat picker error', e));
        });

        // Recognized users also watch for guests waiting to be let in (only requests
        // targeted at them, per the pending() filter in api/admission/[...admissionPath].js).
        pollPendingAdmissions();
```

- [ ] **Step 2: Pass the approver's current room when approving**

In `pollPendingAdmissions`, the `callback` for the "Let them in" button currently POSTs `{requestId: first.requestId}`. Update it to also send the room, by moving the `currentZone` variable (declared in Step 1, same enclosing `WA.onInit().then(...)` scope) into the request body:

```javascript
                                    callback: async () => {
                                        await fetch('/api/admission/approve', {
                                            method: 'POST',
                                            headers: { 'Content-Type': 'application/json' },
                                            body: JSON.stringify({ requestId: first.requestId, room: currentZone }),
                                        });
                                        if (currentBanner) {
                                            currentBanner.close();
                                            currentBanner = null;
                                        }
                                    },
```

(This requires `pollPendingAdmissions` to close over the same `currentZone` variable — confirm it is declared in the same `WA.onInit().then(async () => { ... })` function body, above where `pollPendingAdmissions()` is called, which Step 1 already ensures.)

- [ ] **Step 3: Manual verification**

After deploying (see below), with two separate signed-in browser sessions (A and B):
1. **A** walks into "Conference 01", waits 25+ seconds (past one heartbeat cycle), then closes the tab (triggering `beforeunload`).
2. Re-open as **A** — confirm they spawn directly in "Conference 01" and the seat-picker does **not** appear.
3. As a fresh guest (incognito), pick **B** from the picker, notify, then have **B** click "Let them in" while **B** is standing in "Demo Room 2" — confirm the guest spawns in "Demo Room 2", not at a default entry point.
4. Confirm a genuinely first-ever login (a brand-new approved account that has never set a `wa:last-room`) still sees the seat-picker as before.

- [ ] **Step 4: Commit**

```bash
git add play/public/scripts/admission-script.html
git commit -m "Persist and restore last room for returning users, pass approver's room on admit"
```

---

### Task 9: Deploy and replicate to vings-workplace

**Files:** none (git/deploy operations only)

- [ ] **Step 1: Push all commits from Tasks 1-8 to `pxlcode-workplace`**

```bash
git push origin pxlcode-workplace
```

- [ ] **Step 2: Confirm Vercel auto-deploys and the new routes respond**

```bash
curl -s https://pxlcode-workplace.vercel.app/api/admission/known-members
```

Expected: `200 {"members":[...]}` — repeat the Task 3/4/5 curl checks against the live production URL now that they're deployed for real (they were run earlier against commits not yet pushed).

- [ ] **Step 3: Replicate the same commits to `master` (vings-workplace)**

Since this feature has no `pxlcode-workplace`-specific hardcoded values (unlike the earlier domain-fix work), the same commits apply verbatim to `master`. From a fresh checkout:

```bash
git fetch origin master
git checkout -b tmp-guest-admission origin/master
git cherry-pick <first-commit-sha-from-task-1>^..<last-commit-sha-from-task-8>
git push origin tmp-guest-admission:master
git checkout pxlcode-workplace
git branch -D tmp-guest-admission
```

(Replace the two SHAs with the actual first/last commit hashes from this plan's Tasks 1-8, once they exist.)

- [ ] **Step 4: Confirm vings-workplace deployed too**

```bash
curl -s https://vings-workplace.vercel.app/api/admission/known-members
```

Expected: `200 {"members":[...]}`.
