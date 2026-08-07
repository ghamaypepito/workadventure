# Admission Notification Redesign — Design

## Purpose

Replace the host-side "someone wants to join" notification (currently a plain
native `WA.ui.openPopup` with a single "Let them in" button) with a proper
floating toast — matching the visual/interaction pattern already established
for the Wave/Ping toasts — that gives the host three explicit actions instead
of one: let the guest in at a fixed "Demo Area" spot, send them to a
"Receiving" holding area instead, or deny the request outright.

This extends the existing targeted guest-admission flow specced in
`2026-07-23-targeted-guest-admission-design.md` (guest picker, per-target
pending requests, presence/last-room persistence) — that flow is already
built and live. Only the **admit-side notification** changes here.

## Non-goals

- Any change to the guest-side picker/waiting screens (`guest-picker.html`) —
  those already work and aren't touched.
- A second admission gate for guests sent to "Receiving" (per user decision:
  they're admitted immediately, not held again).
- Restoring the old "meet at my location" (teleport to host's live position)
  behavior — replaced entirely by the two fixed destinations below, per user
  decision.

## Current behavior (for contrast)

`play/public/scripts/admission-script.html`'s `pollPendingAdmissions()` polls
`GET /api/admission/pending` from inside the sandboxed map-script iframe and
renders a single-button native popup via `WA.ui.openPopup(id, message,
[{label: 'Let them in', callback: ...}])`. Approving always teleports the
guest to `currentZone` — wherever the approving host currently happens to be
standing, tracked via `WA.room.onEnterZone`/`onLeaveZone` on a hardcoded
`KNOWN_ZONES` list.

`WA.ui.openPopup` only supports a plain-text message + an array of buttons —
no images, no custom layout, no timestamp. It's a real API constraint, not an
oversight: this is why the redesign moves the UI into the main app instead of
extending the existing map-script popup.

## Two fixed destinations, no live "meet me" option

Both destinations are named areas — "Demo Area" and "Receiving" — that
already exist on the live map. Neither is present in the map JSON tracked in
this git repo (the live map has since been edited through WorkAdventure's own
in-browser map editor and is no longer in sync with the repo's copy), but
this turns out not to matter: `api/_lib/mapStorage.js` already fetches the
live `.wam` file straight from the `map-storage` service at request time
(`fetchWam()`) and resolves a named area to center coordinates
(`resolveRoomCoordinates(wam, roomName)`), which is exactly how the existing
`roomGet` handler already resolves a user's persisted last-room name to
teleport coordinates. No new Redis key, no runtime coordinate-capture via
`onEnterZone`, no cold-start case — `resolveRoomCoordinates(wam, "Demo
Area")` and `resolveRoomCoordinates(wam, "Receiving")` are called directly,
same as any other named-area lookup this codebase already does. If either
area is ever renamed or removed on the live map, the very next `approve`
call simply sees `resolveRoomCoordinates` return `null` for it (same
already-handled case `roomGet` has for a stale last-room name).

## Data model (Redis)

No new Redis keys. `approve` gains a `destination` parameter but resolves
the actual coordinates from the live map on each call rather than storing
anything new.

## API changes (`api/admission/[...admissionPath].js`)

| Route | Change |
|---|---|
| `POST /api/admission/approve` | Body gains `destination: "demo-area" \| "receiving"` (was implicitly always "wherever the approver is"). Maps that to the literal area name (`"Demo Area"` / `"Receiving"`), calls `fetchWam()` + `resolveRoomCoordinates(wam, areaName)`, and returns those coordinates in the approval payload the guest's poll picks up, instead of the approver's live position. Returns a 409 with a clear error if `resolveRoomCoordinates` returns `null` (area doesn't exist on the current live map). |
| `POST /api/admission/deny` | **New.** Mirrors `cancel`'s shape (`{requestId}`) but marks the pending entry's status `"denied"` rather than deleting it outright, so the guest's in-flight poll can observe the terminal state once (see Guest-side handling below), then the entry is removed. |

## Guest-side handling of denial

`guest-picker.html`'s `poll()` currently treats `not_found` as "request no
longer active" and shows a brief error before returning to the picker. Per
user decision, denial must be **silent** — no error message. Add a `denied`
branch in `poll()`, checked before `not_found`, that calls `showPicker()`
directly (same as the "Choose someone else" path), skipping `showError`
entirely.

## Host-side: new floating toast

**New file:** `play/src/front/Components/Admission/AdmissionRequestToast.svelte`

Structural clone of `WaveReceivedToast.svelte`/`PingReceivedToast.svelte`
(same card chrome, same `ToastContainer` 2-column button grid convention):

- Header: guest name + `formatRelativeTime(request.receivedAtMs, Date.now())`
  (reusing the existing `RelativeTime` utility as-is).
- Body: `"is here to visit"`.
- Buttons (2-column grid, third spanning full width per the existing
  Dismiss-spans-both-columns pattern in the Wave/Ping toasts):
  - **Let them in** → `POST /api/admission/approve` with
    `destination: "demo-area"`.
  - **Send to Lobby** → same endpoint, `destination: "receiving"`.
  - **Deny** (spans full width) → `POST /api/admission/deny`.
- On any of the three actions resolving, remove the toast via
  `toastStore.removeToast(toastUuid)` (existing mechanism, same as every
  other toast's own dismiss).
- If `approve` returns 409 (destination coordinates not yet captured), show
  an inline failure message on the toast itself — same inline-error pattern
  already used elsewhere this session (`PersonHoverPreview.svelte`'s
  `waveBlocked`/`messageUnavailable` states) — rather than silently no-oping
  or throwing.

## Moving the poll into the main app

`admission-script.html` currently owns `pollPendingAdmissions()`. That poll
loop moves into a new store, `play/src/front/Stores/AdmissionRequestStore.ts`,
following the same shape as the existing wave/ping toast-triggering
mechanism in `InviteManager.ts` (a stream of incoming events → toast
creation), except sourced from HTTP polling (`GET /api/admission/pending`
every 5s, matching the current interval) rather than a socket message, since
admission requests don't currently flow through the room connection's
message protocol and adding a new protobuf message type for this is out of
scope here.

Dedup: track already-toasted `requestId`s in a `Set` for the lifetime of the
poll loop (mirroring `guest-picker.html`'s existing dedup-by-generation
pattern, simplified since this direction only ever adds toasts, never
cancels one from outside), so the same pending request doesn't spawn a
second toast on the next 5s tick.

`admission-script.html` keeps everything else it currently does (identity
registration, zone/last-room tracking, seat-picker offering) — only
`pollPendingAdmissions()` and its native-popup rendering are removed from it,
since that responsibility now lives in the main app.

## Edge cases

- **Area renamed/removed from the live map:** `resolveRoomCoordinates`
  returns `null`, `approve` returns 409, and the toast shows an inline
  message ("Demo Area not found on the current map") rather than failing
  silently or teleporting somewhere wrong.
- **Two hosts both get the same pending request notified** (shouldn't happen
  — requests are targeted to one `targetEmail` per the existing design — but
  if it somehow did, e.g. via a stale toast after the request was already
  resolved): the second action attempt hits `approve`/`deny` for an
  already-resolved `requestId`; both endpoints already no-op safely on an
  unknown/already-terminal `requestId` per the existing `cancel` handler's
  pattern, reused here.
- **Guest already denied, `deny` called again** (double-click race): same
  no-op-safely handling.

## Testing plan

- `POST /api/admission/approve` with `destination: "demo-area"`, mocking
  `fetchWam` to return a WAM with a `"Demo Area"` area → returns that area's
  center coordinates.
- `POST /api/admission/approve` with `destination: "receiving"`, mocking
  `fetchWam` to return a WAM *without* a `"Receiving"` area → 409.
- `POST /api/admission/deny` → subsequent `GET /api/admission/status` for
  that `requestId` returns `status: "denied"` once, then the entry is gone
  (`not_found` on a later check).
- Guest-side: `poll()` on seeing `status: "denied"` calls `showPicker()`
  directly, never `showError`.
- `AdmissionRequestStore`: two poll ticks returning the same `requestId`
  produce exactly one toast, not two.
- `AdmissionRequestToast`: each of the three buttons calls the right
  endpoint with the right body and removes the toast on success; a 409 from
  approve shows the inline message and does not remove the toast.

## Rollout

Same as the prior admission design: implemented once, applied to both
`vings-workplace`/`master` and `pxlcode-workplace` branches. The area names
"Demo Area" and "Receiving" are specific to the `vings-workplace` map
confirmed in this session; `pxlcode-workplace`'s map has not been checked for
matching areas. If it lacks them, `approve` returns 409 for that deployment
until equivalent areas are added to its map — not a blocker for this design,
but flagged so it isn't mistaken for a bug later. Note also that
`api/_lib/mapStorage.js` currently hardcodes the `vings-test` WAM path for
`fetchWam()`/`patchWam()` — if `pxlcode-workplace` uses a different map path,
that hardcoded path needs updating too, same pre-existing constraint the
already-shipped `roomGet` handler has today, not something newly introduced
by this change.
