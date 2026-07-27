# Targeted Guest Admission + Last-Room Persistence — Design

## Purpose

Replace the current broadcast-to-everyone guest admission flow with a Gather-style
"who are you here to see?" picker: guest selects one online member, only that member
is notified, and admission spawns the guest into the inviter's current room/area.
Registered users returning to the map skip the seat-picker and spawn back in their
last room/area instead. Applies to both `vings-workplace` and `pxlcode-workplace`.

## Non-goals (v1)

- Exact x/y position persistence (room/area granularity only)
- Multi-select / broadcast-to-several-people ping
- Any change to the existing seat-picker UI itself (only when it's shown changes)

## Current behavior (for contrast)

- Guest: blank "someone will let you in" popup; `POST /api/admission/request` creates
  one pending entry visible to *every* logged-in user via `GET /api/admission/pending`;
  first person to click "Let them in" approves, no destination logic.
- Registered user: always shown the seat-picker on every login; no position
  persistence exists anywhere in the codebase today.

## Data model (Redis)

Extends the existing `wa:pending`/`wa:approved`/`wa:admins` admission keys:

- `wa:pending-admission` entries gain a `targetEmail` field (previously requests had
  no target — visible to all).
- `wa:presence:<email>` (string, ~30s TTL, refreshed by a heartbeat from the existing
  identity-registration call in `admission-script.html`) — drives online/offline
  styling in the picker.
- `wa:last-room:<email>` (string, room/area name) — written on disconnect
  (`beforeunload` / socket disconnect), read on next login.

## API (extends `api/admission/[...admissionPath].js`)

| Route | Change |
|---|---|
| `GET /api/admission/known-members` | **New.** Returns `wa:admins` ∪ `wa:approved`, each flagged `online` from `wa:presence:*` |
| `POST /api/admission/request` | Now requires `{name, targetEmail}` (was `{name}`) |
| `GET /api/admission/pending` | Now filters to `targetEmail === caller's email` (was: all requests) |
| `POST /api/admission/room` | **New.** Fired on disconnect/beforeunload; persists caller's current room/area to `wa:last-room:<email>` |

## Guest flow

1. On join with no `wa_user` cookie, instead of the current blank waiting popup, show
   a picker: search box + list of known members (online ones selectable, offline ones
   grayed out/unselectable, per user decision).
2. Select one online member → "Notify member" → `POST /api/admission/request` with
   that `targetEmail` → same poll-for-approval loop as today.
3. Guest can cancel and pick a **different** member at any time before approval —
   this cancels the old pending entry and creates a new targeted one (does not wait
   for the first target to respond).

## Admit flow

- Only the targeted member's client sees the "X wants to join" popup, since
  `GET /api/admission/pending` now filters by `targetEmail`.
- Approving spawns the guest into the approving member's **current live room/area**
  (read from their active session — not from `wa:last-room`, which is for persisting
  across logout, not for locating someone who's currently online).
- The popup auto-dismisses when the request's status flips to approved/entered, or on
  manual dismiss.

## Returning registered user flow

- On login, check `wa:last-room:<email>`.
- If present: spawn directly into that room/area, skip the seat-picker entirely.
- If absent (first-ever login): fall back to today's seat-picker behavior.

## Edge cases

- Target logs out mid-wait: guest's poll simply continues against a now-stale
  pending entry; guest can cancel and pick someone else (per user decision) rather
  than waiting indefinitely.
- Two guests target the same member: both appear in that member's filtered pending
  list (the existing array-based response already supports multiple entries) — just
  now correctly invisible to everyone else.
- Presence heartbeat lapses (member's tab closed ungracefully): `wa:presence` TTL
  expires naturally within ~30s, member drops out of "Active now" without needing an
  explicit disconnect signal.

## Testing plan

- `POST /api/admission/request` without `targetEmail` → 400.
- `GET /api/admission/pending` for member A never includes a request targeted at
  member B.
- Cancel-and-repick: canceling one request and creating a new one leaves exactly one
  live pending entry for that guest, not two.
- Returning user with a `wa:last-room` entry never receives the seat-picker.
- First-ever login (no `wa:last-room` entry) still receives the seat-picker.
- Presence TTL: a member who stops heartbeating drops out of `online` in
  `known-members` within the TTL window.

## Rollout

Implemented once, applied to both `vings-workplace`/`master` and `pxlcode-workplace`
branches, same as prior features this session.
