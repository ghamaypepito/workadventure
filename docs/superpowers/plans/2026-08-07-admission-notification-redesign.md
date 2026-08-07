# Admission Notification Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the host's single-button "someone wants to join" native popup with a floating toast offering three explicit actions — Let them in (Demo Area), Send to Lobby (Receiving), Deny — matching the visual/interaction pattern of the existing Wave/Ping toasts.

**Architecture:** Backend (`api/admission/[...admissionPath].js`) gains a `destination` parameter on `approve` (resolved against the live map via the existing `fetchWam`/`resolveRoomCoordinates` helpers) and a new `deny` endpoint. The pending-admissions poll moves out of the sandboxed `admission-script.html` map script into a new front-end store (`AdmissionRequestStore.ts`) that renders a new toast component (`AdmissionRequestToast.svelte`) through the existing `toastStore`, wired to start/stop alongside the game scene's own lifecycle.

**Tech Stack:** Vercel Node serverless functions (`api/admission/[...admissionPath].js`, CommonJS, no test framework — verified via manual `curl`), Svelte 5 + vitest (`play/`), WorkAdventure scripting API (`admission-script.html`, `guest-picker.html`).

## Global Constraints

- No new Redis keys — destination coordinates are resolved from the live map on demand via `fetchWam()`/`resolveRoomCoordinates()`, per the approved spec (`docs/superpowers/specs/2026-08-07-admission-notification-redesign-design.md`).
- Denial must be silent to the guest — no error message, just a return to the picker screen.
- Every backend change must preserve the existing `approve`/`cancel`/`status`/`pending` behavior exactly for any caller that doesn't pass the new `destination` field (backward compatible with the still-live guest-admission flow from the prior design).
- Verify every `play/` change with `npx vite build` before considering it done, not just `tsc`/`eslint` — this codebase has a documented history of changes that pass typechecking but fail the real bundler.

---

## Task 1: Backend — `destination` on `approve`, new `deny` endpoint

**Files:**
- Modify: `api/admission/[...admissionPath].js`

**Interfaces:**
- Produces: `POST /api/admission/approve` now accepts an optional `destination: "demo-area" | "receiving"` field in its JSON body (in addition to the existing optional `room` field, which still works as before for backward compatibility). Returns `400` for an unrecognized `destination` value, `409` if the resolved area doesn't exist on the current live map, otherwise unchanged (`{success: true}`, `403`, `404` as before).
- Produces: `POST /api/admission/deny` — new route, body `{requestId: string}`, requires a signed-in user who is the request's target (same auth pattern as `approve`). Sets the pending entry's `status` to `"denied"`. Returns `{success: true}` (200), `403` if not the target, `404` if the request doesn't exist/already resolved, `400` if `requestId` missing.

- [ ] **Step 1: Add the destination-to-area-name map and extend `approve`**

Find this exact block in `api/admission/[...admissionPath].js` (currently starts the `approve` function):

```js
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

    let forbidden = false;
    const updated = await withRedis(REDIS_URL, async (client) => {
        const raw = await client.command('HGET', PENDING_KEY, parsed.requestId);
        if (!raw) return false;
        const data = JSON.parse(raw);
        // Only the person the guest actually picked may admit them - otherwise any signed-in
        // user who obtains a requestId could admit a guest into any room.
        if (data.target !== user.email.toLowerCase()) {
            forbidden = true;
            return false;
        }
        data.status = 'approved';
        data.approvedBy = user.email;
        if (parsed.room) data.room = parsed.room;
        await client.command('HSET', PENDING_KEY, parsed.requestId, JSON.stringify(data));
        return true;
    });
```

Replace it with:

```js
// Maps the fixed-destination toast buttons to their literal area names on the live map.
// "room" (a free-form zone name, historically the approver's own live position) is still
// accepted for backward compatibility, but the new toast always sends `destination`.
const DESTINATION_AREAS = {
    'demo-area': 'Demo Area',
    receiving: 'Receiving',
};

// Requires a signed-in (non-guest) user. Accepts either `destination` (one of
// DESTINATION_AREAS' keys - resolved against the live map and validated to exist before
// anything is written) or the older free-form `room` field, so the guest can be spawned
// wherever the approver chose.
async function approve(req, res) {
    const user = await requireUser(req, res);
    if (!user) return;

    const parsed = await readBody(req);
    if (parsed === null || !parsed.requestId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing requestId' }));
        return;
    }

    let roomName = parsed.room || null;
    if (parsed.destination) {
        const areaName = DESTINATION_AREAS[parsed.destination];
        if (!areaName) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Unknown destination' }));
            return;
        }
        // Resolved (and validated) outside the Redis transaction below: fetchWam() is a
        // network call to map-storage, and there's no reason to hold a Redis round-trip
        // open while it runs.
        const wam = await fetchWam();
        if (!resolveRoomCoordinates(wam, areaName)) {
            res.statusCode = 409;
            res.end(JSON.stringify({ error: `${areaName} not found on the current map` }));
            return;
        }
        roomName = areaName;
    }

    let forbidden = false;
    const updated = await withRedis(REDIS_URL, async (client) => {
        const raw = await client.command('HGET', PENDING_KEY, parsed.requestId);
        if (!raw) return false;
        const data = JSON.parse(raw);
        // Only the person the guest actually picked may admit them - otherwise any signed-in
        // user who obtains a requestId could admit a guest into any room.
        if (data.target !== user.email.toLowerCase()) {
            forbidden = true;
            return false;
        }
        data.status = 'approved';
        data.approvedBy = user.email;
        if (roomName) data.room = roomName;
        await client.command('HSET', PENDING_KEY, parsed.requestId, JSON.stringify(data));
        return true;
    });
```

Leave everything after this (the `if (forbidden)` / `if (!updated)` / success-response block) exactly as-is — it's unchanged.

- [ ] **Step 2: Add the `deny` function**

Immediately after the `approve` function's closing brace (right before the `// Requires a signed-in (non-guest) user. Registers this WA player uuid -> SSO email...` comment that starts `identity`), insert:

```js
// Requires a signed-in (non-guest) user. Only the request's target may deny it - marks it
// denied (rather than deleting outright) so the guest's next status() poll observes the
// terminal state once; the entry then reaps naturally via pending()'s existing age-based
// cleanup, same as an unconsumed approved entry already does today.
async function deny(req, res) {
    const user = await requireUser(req, res);
    if (!user) return;

    const parsed = await readBody(req);
    if (parsed === null || !parsed.requestId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Missing requestId' }));
        return;
    }

    let forbidden = false;
    const updated = await withRedis(REDIS_URL, async (client) => {
        const raw = await client.command('HGET', PENDING_KEY, parsed.requestId);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (data.target !== user.email.toLowerCase()) {
            forbidden = true;
            return false;
        }
        data.status = 'denied';
        await client.command('HSET', PENDING_KEY, parsed.requestId, JSON.stringify(data));
        return true;
    });

    if (forbidden) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'You are not the target of this request' }));
        return;
    }

    if (!updated) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Request not found (may have expired or already been handled)' }));
        return;
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ success: true }));
}
```

- [ ] **Step 3: Wire the `deny` route into the router**

Find this exact block near the bottom of the file:

```js
        } else if (segment === 'approve') {
            await approve(req, res);
        } else if (segment === 'chat-history') {
```

Replace it with:

```js
        } else if (segment === 'approve') {
            await approve(req, res);
        } else if (segment === 'deny') {
            await deny(req, res);
        } else if (segment === 'chat-history') {
```

- [ ] **Step 4: Verify with Node's syntax checker**

This directory has no automated test framework wired up for `api/` (confirmed: no `*.test.js` files exist under `api/`, no test script references it). Verify the file is syntactically valid:

Run: `node --check "api/admission/[...admissionPath].js"`
Expected: no output, exit code 0.

- [ ] **Step 5: Manual smoke test against the local file (no server needed for a syntax-level check)**

Run: `node -e "require('./api/admission/[...admissionPath].js'); console.log('loaded OK')"`
Expected: `loaded OK` printed, no thrown errors (confirms all requires resolve and the module loads without a runtime error).

- [ ] **Step 6: Commit**

```bash
git add "api/admission/[...admissionPath].js"
git commit -m "Add destination-based approve + deny endpoint to admission API

approve now accepts destination: 'demo-area' | 'receiving', resolved and
validated against the live map via the existing fetchWam/resolveRoomCoordinates
helpers before anything is written (409 if the area doesn't exist), instead
of only ever using the approver's own live-tracked room name. New deny
endpoint mirrors approve's auth/target-check pattern but marks the entry
denied rather than admitting it, for the new notification toast's Deny
button."
```

---

## Task 2: Guest-side — handle `denied` status silently

**Files:**
- Modify: `play/public/scripts/guest-picker.html`

**Interfaces:**
- Consumes: `GET /api/admission/status?requestId=...` now can return `{status: "denied"}` (from Task 1's `deny` endpoint) in addition to the existing `pending` / `approved` / `not_found` values `status()` already returns unchanged.

- [ ] **Step 1: Add the `denied` branch to `poll()`**

Find this exact block in `play/public/scripts/guest-picker.html`:

```js
            if (data.status === 'not_found') {
                currentRequestId = null;
                showError('That request is no longer active — pick someone else.');
                setTimeout(() => {
                    if (myGeneration !== generation) return;
                    showPicker();
                }, 1500);
                return;
            }
```

Replace it with:

```js
            if (data.status === 'denied') {
                // Silent by design (per product decision) - no error shown, just straight back
                // to the picker, unlike not_found below which does explain itself.
                currentRequestId = null;
                showPicker();
                return;
            }

            if (data.status === 'not_found') {
                currentRequestId = null;
                showError('That request is no longer active — pick someone else.');
                setTimeout(() => {
                    if (myGeneration !== generation) return;
                    showPicker();
                }, 1500);
                return;
            }
```

- [ ] **Step 2: Verify with Node's syntax checker on the extracted script**

`guest-picker.html` embeds its script inline, so there's no standalone `.js` file to run `node --check` against directly. Instead, verify the HTML is well-formed and the script block has no obvious syntax break by extracting and checking it:

Run: `sed -n '/<script>/,/<\/script>/p' play/public/scripts/guest-picker.html | sed '1d;$d' | node --check /dev/stdin`
Expected: no output, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add play/public/scripts/guest-picker.html
git commit -m "Handle denied admission requests silently in the guest picker

Per product decision: denial shows no error to the guest, unlike the
existing not_found path (used when a request expires/is otherwise gone),
which does explain itself. Returns straight to the picker screen."
```

---

## Task 3: Frontend — `AdmissionRequestStore.ts`

**Files:**
- Create: `play/src/front/Stores/AdmissionRequestStore.ts`
- Test: `play/src/front/Stores/AdmissionRequestStore.test.ts`

**Interfaces:**
- Consumes: `GET /api/admission/pending` → `{requests: {requestId: string, name: string, ts: number}[]}` (existing endpoint, unchanged shape).
- Consumes: `toastStore.addToast(component, props, uuid?)` from `play/src/front/Stores/ToastStoreSingleton.ts` (existing).
- Produces: `admissionRequestStore.startPolling(): void` and `admissionRequestStore.stopPolling(): void`, exported as the default export's shape from this new file. Polls every 5000ms while started; on an HTTP 401 response, stops polling permanently for this session (the caller is a guest or otherwise not signed in, and never will be able to receive admission requests). Renders `AdmissionRequestToast` (from Task 4) via `toastStore.addToast`, keyed by `requestId` — since `toastStore`'s underlying map is keyed by uuid, calling `addToast` again with the same `requestId` for a still-pending request on the next poll tick is a harmless no-op overwrite, not a duplicate.

- [ ] **Step 1: Write the failing test**

Create `play/src/front/Stores/AdmissionRequestStore.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const addToastMock = vi.fn();
const removeToastMock = vi.fn();

vi.mock("./ToastStoreSingleton", () => ({
    toastStore: {
        addToast: addToastMock,
        removeToast: removeToastMock,
    },
}));

vi.mock("../Components/Admission/AdmissionRequestToast.svelte", () => ({
    default: "AdmissionRequestToastComponent",
}));

import { admissionRequestStore } from "./AdmissionRequestStore";

describe("admissionRequestStore", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        addToastMock.mockClear();
        removeToastMock.mockClear();
        globalThis.fetch = vi.fn();
    });

    afterEach(() => {
        admissionRequestStore.stopPolling();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("adds a toast for each pending request returned by the first poll", async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            status: 200,
            ok: true,
            json: () =>
                Promise.resolve({
                    requests: [{ requestId: "req-1", name: "Guest One", ts: 1000 }],
                }),
        });

        admissionRequestStore.startPolling();
        await vi.waitFor(() => expect(addToastMock).toHaveBeenCalledTimes(1));

        expect(addToastMock).toHaveBeenCalledWith(
            "AdmissionRequestToastComponent",
            { requestId: "req-1", name: "Guest One", receivedAt: 1000, toastUuid: "req-1" },
            "req-1",
        );
    });

    it("stops polling permanently once it receives a 401", async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            status: 401,
            ok: false,
            json: () => Promise.resolve({ error: "Not signed in" }),
        });

        admissionRequestStore.startPolling();
        await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));

        await vi.advanceTimersByTimeAsync(20_000);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("does not add a second toast for the same requestId on a later poll", async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            status: 200,
            ok: true,
            json: () =>
                Promise.resolve({
                    requests: [{ requestId: "req-1", name: "Guest One", ts: 1000 }],
                }),
        });

        admissionRequestStore.startPolling();
        await vi.waitFor(() => expect(addToastMock).toHaveBeenCalledTimes(1));

        await vi.advanceTimersByTimeAsync(5000);
        await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));

        // Called again (idempotent overwrite, not a duplicate toast) - the store doesn't dedupe
        // itself, it relies on addToast's own keyed-map semantics, so this asserts it was called
        // with the exact same key both times rather than asserting a call count of 1.
        expect(addToastMock).toHaveBeenNthCalledWith(
            2,
            "AdmissionRequestToastComponent",
            { requestId: "req-1", name: "Guest One", receivedAt: 1000, toastUuid: "req-1" },
            "req-1",
        );
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd play && PLAY_URL=http://play.workadventure.localhost ADMIN_URL= npx vitest run src/front/Stores/AdmissionRequestStore.test.ts`
Expected: FAIL — `Cannot find module './AdmissionRequestStore'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `play/src/front/Stores/AdmissionRequestStore.ts`:

```ts
import { toastStore } from "./ToastStoreSingleton";
import AdmissionRequestToast from "../Components/Admission/AdmissionRequestToast.svelte";

const POLL_INTERVAL_MS = 5000;

interface PendingAdmissionRequest {
    requestId: string;
    name: string;
    ts: number;
}

let pollTimer: ReturnType<typeof setTimeout> | undefined;
// Set true on a 401 (guest / not signed in) so polling stops for good instead of retrying
// forever against a route that can never succeed for this session.
let stopped = false;

async function pollOnce(): Promise<void> {
    const response = await fetch("/api/admission/pending");
    if (response.status === 401) {
        stopped = true;
        return;
    }
    if (!response.ok) {
        // Transient error - keep polling, same "don't destroy state on a network blip" pattern
        // already used by guest-picker.html's own poll loop.
        return;
    }
    const data: { requests: PendingAdmissionRequest[] } = await response.json();
    for (const request of data.requests) {
        // toastStore.addToast is keyed by uuid - calling it again for a still-pending request
        // on the next tick harmlessly overwrites the same entry rather than adding a duplicate.
        toastStore.addToast(
            AdmissionRequestToast,
            { requestId: request.requestId, name: request.name, receivedAt: request.ts, toastUuid: request.requestId },
            request.requestId,
        );
    }
}

function scheduleNext(): void {
    if (stopped) return;
    pollTimer = setTimeout(() => {
        pollOnce()
            .catch((error) => console.error("[admission] pending poll failed", error))
            .finally(scheduleNext);
    }, POLL_INTERVAL_MS);
}

export const admissionRequestStore = {
    startPolling(): void {
        if (pollTimer !== undefined || stopped) return;
        pollOnce()
            .catch((error) => console.error("[admission] pending poll failed", error))
            .finally(scheduleNext);
    },
    stopPolling(): void {
        stopped = true;
        if (pollTimer !== undefined) {
            clearTimeout(pollTimer);
            pollTimer = undefined;
        }
    },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd play && PLAY_URL=http://play.workadventure.localhost ADMIN_URL= npx vitest run src/front/Stores/AdmissionRequestStore.test.ts`
Expected: PASS, 3 tests passed.

- [ ] **Step 5: Commit**

```bash
git add play/src/front/Stores/AdmissionRequestStore.ts play/src/front/Stores/AdmissionRequestStore.test.ts
git commit -m "Add AdmissionRequestStore: polls pending admission requests into toasts

Moves the pending-admissions poll that currently lives inside the
sandboxed admission-script.html map script into the main app, so the new
AdmissionRequestToast can render as a real floating card instead of a
plain native popup. Stops polling permanently on a 401 (guest session)
rather than retrying a route that can never succeed."
```

---

## Task 4: Frontend — `AdmissionRequestToast.svelte`

**Files:**
- Create: `play/src/front/Components/Admission/AdmissionRequestToast.svelte`

**Interfaces:**
- Consumes: `ToastContainer` (`play/src/front/Components/Toasts/ToastContainer.svelte`) — existing, unmodified. Props used: `theme`, `extraClasses`, `toastUuid`, `receivedAt`, `children` (default slot), `buttons` (snippet).
- Consumes: `toastStore.removeToast(toastUuid: string): void` (existing).
- Consumes props: `{requestId: string; name: string; receivedAt: number; toastUuid: string}` (matches exactly what `AdmissionRequestStore.ts` from Task 3 passes via `addToast`).
- Calls: `POST /api/admission/approve` with `{requestId, destination}`, `POST /api/admission/deny` with `{requestId}` (both from Task 1).

- [ ] **Step 1: Write the component**

Create `play/src/front/Components/Admission/AdmissionRequestToast.svelte`:

```svelte
<script lang="ts">
    import ToastContainer from "../Toasts/ToastContainer.svelte";
    import { toastStore } from "../../Stores/ToastStoreSingleton";

    interface Props {
        requestId: string;
        name: string;
        receivedAt: number;
        toastUuid: string;
    }

    let { requestId, name, receivedAt, toastUuid }: Props = $props();

    let actionState: "idle" | "sending" = $state("idle");
    // Set on a 409 from approve (the destination area doesn't exist on the current live map) -
    // shown inline rather than letting the toast close with nothing visibly having happened,
    // same failure-visibility pattern used by the Wave/Ping toasts' own inline error states.
    let destinationUnavailable = $state(false);

    async function respond(body: Record<string, unknown>, endpoint: "approve" | "deny"): Promise<void> {
        if (actionState === "sending") return;
        actionState = "sending";
        destinationUnavailable = false;
        try {
            const response = await fetch(`/api/admission/${endpoint}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (response.status === 409) {
                destinationUnavailable = true;
                actionState = "idle";
                return;
            }
            if (!response.ok) {
                throw new Error(`Request failed: ${response.status}`);
            }
            toastStore.removeToast(toastUuid);
        } catch (error) {
            console.error(`[admission] ${endpoint} failed:`, error);
            actionState = "idle";
        }
    }

    function letThemIn() {
        respond({ requestId, destination: "demo-area" }, "approve").catch((error) =>
            console.error("[admission] approve (demo-area) failed:", error),
        );
    }

    function sendToLobby() {
        respond({ requestId, destination: "receiving" }, "approve").catch((error) =>
            console.error("[admission] approve (receiving) failed:", error),
        );
    }

    function deny() {
        respond({ requestId }, "deny").catch((error) => console.error("[admission] deny failed:", error));
    }
</script>

<ToastContainer theme="light" extraClasses="" {toastUuid} {receivedAt}>
    {name} is here to visit
    {#snippet buttons()}
        <button
            type="button"
            class="btn btn-light btn-ghost text-sm w-full"
            onclick={letThemIn}
            disabled={actionState === "sending"}
        >
            Let them in
        </button>
        <button
            type="button"
            class="btn btn-light btn-ghost text-sm w-full"
            onclick={sendToLobby}
            disabled={actionState === "sending"}
        >
            Send to Lobby
        </button>
        <button
            type="button"
            class="btn btn-light btn-ghost text-sm w-full col-span-2"
            onclick={deny}
            disabled={actionState === "sending"}
        >
            Deny
        </button>
        {#if destinationUnavailable}
            <span class="text-xs opacity-70 col-span-2 text-center">That location isn't available right now</span>
        {/if}
    {/snippet}
</ToastContainer>
```

- [ ] **Step 2: Verify with tsc**

Run: `cd play && npx tsc --noEmit -p tsconfig.json`
Expected: no new errors referencing `AdmissionRequestToast.svelte` (pre-existing, unrelated Tiled `.tsx` map-asset errors are expected and not caused by this change).

- [ ] **Step 3: Verify with eslint**

Run: `cd play && npx eslint src/front/Components/Admission/AdmissionRequestToast.svelte`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add play/src/front/Components/Admission/AdmissionRequestToast.svelte
git commit -m "Add AdmissionRequestToast: floating card for incoming visit requests

Same visual/interaction pattern as the existing Wave/Ping toasts (light
theme, relative timestamp, 2-column button grid). Three actions: Let them
in (Demo Area), Send to Lobby (Receiving), Deny - replacing the old
single-button native popup rendered from admission-script.html."
```

---

## Task 5: Wire polling into the game scene; remove the old native popup

**Files:**
- Modify: `play/src/front/Phaser/Game/GameScene.ts:1055-1065` (the `customStatusMessage` broadcast block's surrounding area) and `play/src/front/Phaser/Game/GameScene.ts:1201` (`cleanupClosingScene`)
- Modify: `play/public/scripts/admission-script.html`

**Interfaces:**
- Consumes: `admissionRequestStore.startPolling()` / `admissionRequestStore.stopPolling()` from Task 3.

- [ ] **Step 1: Start polling after the room is joined**

In `play/src/front/Phaser/Game/GameScene.ts`, find this exact block (currently around line 1055-1071):

```js
        // customStatusMessageStore (see CustomStatusMessageStore.ts, which emits live updates).
        this.roomJoinedPromiseDeferred.promise
            .then(() => {
                const customStatusMessage = localUserStore.getCustomStatusMessage();
                if (customStatusMessage) {
                    this.connection?.emitPlayerCustomStatusMessage(customStatusMessage);
                }
            })
            .catch((e) => {
                console.error(e);
                Sentry.captureException(e);
            });

        if (this.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
            this._focusFx = new DarkenOutsideAreaEffect(this, this.cameras.main, {
                feather: 10,
                darkness: 0.65,
                tweenDurationMs: 250,
            });
        }
    }
```

Replace it with (only the new block is inserted, between the existing `.catch()`'s closing `});` and the `if (this.game.renderer ...)` line — everything else here is unchanged):

```js
        // customStatusMessageStore (see CustomStatusMessageStore.ts, which emits live updates).
        this.roomJoinedPromiseDeferred.promise
            .then(() => {
                const customStatusMessage = localUserStore.getCustomStatusMessage();
                if (customStatusMessage) {
                    this.connection?.emitPlayerCustomStatusMessage(customStatusMessage);
                }
            })
            .catch((e) => {
                console.error(e);
                Sentry.captureException(e);
            });

        // Start polling for incoming admission requests once the room is actually joined - a
        // guest (no signed-in session) will just get a 401 on the first poll and
        // AdmissionRequestStore stops permanently on its own; no need to gate this on being a
        // recognized user beforehand.
        this.roomJoinedPromiseDeferred.promise
            .then(() => {
                admissionRequestStore.startPolling();
            })
            .catch((e) => {
                console.error(e);
                Sentry.captureException(e);
            });

        if (this.game.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer) {
            this._focusFx = new DarkenOutsideAreaEffect(this, this.cameras.main, {
                feather: 10,
                darkness: 0.65,
                tweenDurationMs: 250,
            });
        }
    }
```

Also add the import. Find this line near the top of the file:

```ts
import { localUserStore } from "../../Connection/LocalUserStore";
```

Replace it with:

```ts
import { localUserStore } from "../../Connection/LocalUserStore";
import { admissionRequestStore } from "../../Stores/AdmissionRequestStore";
```

- [ ] **Step 2: Stop polling on scene cleanup**

Find this exact line in `cleanupClosingScene()`:

```js
    public cleanupClosingScene(): void {
        this.abortController?.abort();
```

Replace it with:

```js
    public cleanupClosingScene(): void {
        this.abortController?.abort();
        admissionRequestStore.stopPolling();
```

- [ ] **Step 3: Remove the old native-popup polling from `admission-script.html`**

In `play/public/scripts/admission-script.html`, delete the entire `pollPendingAdmissions` function (currently lines 31-72, from `async function pollPendingAdmissions() {` through its closing `}`) and its call site (the line `pollPendingAdmissions();` near the end of the `WA.onInit().then(async () => { ... })` block, currently preceded by the comment `// Recognized users also watch for guests waiting to be let in (...)`.

The comment right before the call site (`// Recognized users also watch for guests waiting to be let in (only requests targeted at them, per the pending() filter in api/admission/[...admissionPath].js). Run this unconditionally regardless of which branch above ran or whether it errored.`) should be deleted along with it — that responsibility now lives entirely in the main app via `AdmissionRequestStore`, not in this map script.

Two other comments elsewhere in the file mention `pollPendingAdmissions` in passing and would otherwise become stale references to a deleted function. Find this exact text (around line 86):

```
            // and pollPendingAdmissions doesn't apply to guests. Final positional arg is the
            // closability flag; keep every other argument as-is.
```

Replace it with:

```
            // and this picker doesn't apply to guests. Final positional arg is the closability
            // flag; keep every other argument as-is.
```

And find this exact text (around line 169):

```
        // code below (menu command registration, pollPendingAdmissions) from running.
```

Replace it with:

```
        // code below (menu command registration) from running.
```

Everything else in the file (identity registration, `KNOWN_ZONES` tracking, seat-picker offering, the guest-vs-recognized-user branch) stays exactly as-is.

- [ ] **Step 4: Verify with a real build**

Run: `cd play && npx vite build`
Expected: build succeeds with no errors (warnings about chunk size are pre-existing and expected).

- [ ] **Step 5: Verify `admission-script.html` is still well-formed**

Run: `sed -n '/<script>/,/<\/script>/p' play/public/scripts/admission-script.html | sed '1d;$d' | node --check /dev/stdin`
Expected: no output, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add play/src/front/Phaser/Game/GameScene.ts play/public/scripts/admission-script.html
git commit -m "Wire AdmissionRequestStore into the game scene; remove old popup polling

Starts polling once the room is joined (guests get a harmless 401 and the
store stops itself), stops on scene cleanup. Removes the now-redundant
pollPendingAdmissions()/native openPopup call from admission-script.html -
that responsibility lives entirely in the main app now via
AdmissionRequestToast.

Verified with npx vite build (pre-existing Tiled .tsx tsc errors in map
assets are unrelated and predate this change)."
```

---

## Task 6: End-to-end manual verification and deploy

**Files:** none (verification only)

- [ ] **Step 1: Run the full `play` test suite**

Run: `cd play && PLAY_URL=http://play.workadventure.localhost ADMIN_URL= npx vitest run`
Expected: all tests pass, including the 3 new `AdmissionRequestStore.test.ts` tests. No new failures relative to the pre-existing baseline.

- [ ] **Step 2: Run the full `play` build one more time from a clean state**

Run: `cd play && npx vite build`
Expected: success.

- [ ] **Step 3: Manual smoke test against production (after deploy)**

This requires two real accounts: one recognized/approved user (the "host") and one guest browser session (incognito or a second browser).

1. As the guest: open the site, don't sign in, pick the host from the "Who are you here to see?" list, click Notify member. Confirm the "Waiting for [host]..." screen appears.
2. As the host: confirm a new floating toast appears (not the old native popup) reading "[guest name] is here to visit" with three buttons: Let them in, Send to Lobby, Deny.
3. Click **Let them in**. Confirm: the toast disappears; the guest's browser is admitted and spawns in the "Demo Area" zone.
4. Repeat from step 1, this time click **Send to Lobby**. Confirm the guest spawns in the "Receiving" zone instead.
5. Repeat from step 1, this time click **Deny**. Confirm: the toast disappears on the host's side; the guest's screen silently returns to the "Who are you here to see?" picker with no error message shown.

- [ ] **Step 4: Deploy**

Push to `origin/master` and redeploy the Vercel project (env vars unchanged, no Railway service touched by this plan — everything here is Vercel-side: `api/` serverless functions and the `play/` static bundle).

```bash
git push origin master
```

Confirm the deploy went live by checking the new commit SHA appears as the latest `READY` production deployment (via the Vercel MCP `list_deployments` tool, or the Vercel dashboard) before running the manual smoke test in Step 3.
