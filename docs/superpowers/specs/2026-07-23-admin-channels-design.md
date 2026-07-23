# Admin-Created Channels — Design

## Purpose

Add Slack-style named channels to the chat bubble: admin-only creation, admin-assigned
membership, persistent history, pull-on-open message loading, and instant per-channel
notification badges. Applies to both `vings-workplace` and `pxlcode-workplace`
deployments (same repo, separate branches).

## Non-goals (v1)

- Channel deletion/archiving (create + rename + manage-members only)
- Message content pushed live over the socket (badges only — content loads on open)
- Threads, reactions, mentions parsing, or any other Slack feature beyond the above

## Data model (Redis)

Alongside the existing `wa:pending`, `wa:approved`, `wa:admins`, `wa:uuid-email:*` keys:

- `wa:channel:<channelId>` (hash) — `{name, createdBy, createdAt}`
- `wa:channel:members:<channelId>` (set) — member emails
- `wa:channels:by-member:<email>` (set) — channel IDs a user belongs to
- `wa:channel-history:<channelId>` (list) — persisted messages, same shape/pagination
  as the existing proximity chat history (full retention, offset/limit)
- `wa:channel-lastread:<email>:<channelId>` (string, timestamp)
- `wa:channel-notif:<email>` (hash) — `{channelId: "all" | "none"}`, default `"all"`

Channel IDs are random slugs (`crypto.randomBytes`), independent of display name, so
renames never break references.

## API (Vercel serverless, `api/channels/[...channelsPath].js` catch-all)

| Route | Auth | Notes |
|---|---|---|
| `POST /api/channels` | `requireAdmin` | `{name, memberEmails[]}`; creator auto-added as member; 400 if resulting member list is empty |
| `PATCH /api/channels/:id` | `requireAdmin` | `{name}` — rename only, history/messages unaffected (keyed by ID) |
| `POST /api/channels/:id/members` | `requireAdmin` | add/remove members; updates both `members:<id>` and `by-member:<email>` sets |
| `GET /api/channels` | `requireUser` | channels caller belongs to, with unread counts |
| `GET /api/channels/:id/messages?offset=&limit=` | member of `:id` (403 otherwise) | same pagination shape as existing chat-history endpoint |
| `POST /api/channels/:id/messages` | member of `:id` | persists message |
| `POST /api/channels/:id/read` | member of `:id` | updates `lastread` timestamp |
| `PUT /api/channels/:id/notification-level` | member of `:id` | body `{level: "all"|"none"}` |

All membership/admin checks are server-side against Redis — a client can never read or
post into a channel by guessing its ID.

Member picker (for the create/manage-members UI) is sourced from the union of
`wa:admins` and `wa:approved` — "everyone who's ever logged in or been approved" — no
new tracking needed.

## Real-time notification signal

Reuses the wave/ping socket pattern already proven in this codebase:

1. New protobuf message pair in `messages.proto`: `ChannelMessageNotification
   {channelId, senderName}`, added to the same three oneofs wave/ping required
   (`ClientToServerMessage`, `PusherToBackMessage`, `ServerToClientMessage`), plus the
   matching case in `IoSocketController.ts`'s per-type whitelist.
2. Flow: poster's client persists the message via the HTTP API above, then emits
   `ChannelMessageNotification` over its already-open game socket → pusher → `back` →
   fanned out to all other currently-connected clients.
3. Each receiving client checks client-side (a) whether it's a member of that channel
   (already has its own channel list cached) and (b) its own notification level for
   that channel (`"all"` vs `"none"`, fetched at login). Only if both pass does the
   in-memory unread badge increment.
4. This carries no message content — keeps the pull-on-open boundary clean. Offline
   members simply get the correct count from Redis (history vs `lastread`) next time
   they open the app; there's no reliance on having received the live signal.
5. `"none"` notification level means the badge never increments for that channel —
   handled entirely client-side, channel remains fully readable.

## UI (chat bubble)

- New "Channels" section in the sidebar (below Starred, above Direct messages),
  same visual treatment as existing sections.
- Each row: channel name + unread badge (rendered only if count > 0 and notification
  level isn't `"none"`).
- "+ Add channel" row, rendered only if `window.__waIsAdmin` is true (same flag used
  today for the map-editor card in `maps/index.html`) — client-side hiding on top of
  the server-side `requireAdmin` gate.
- "+ Add channel" opens a modal: name field + member picker (checkboxes over the
  `wa:admins` ∪ `wa:approved` union).
- Opening a channel reuses the existing `RoomTimeline.svelte` timeline UI (pagination,
  date separators) already built for DM/proximity chat, backed by the new channel
  endpoints instead.
- Per-channel notification level: bell/dropdown in the channel header, "All messages"
  / "Nothing", calling the notification-level endpoint.

## Error handling

- Non-member opening a channel (stale link, since-removed): 403 → client redirects to
  channel list.
- Member removed while viewing: next fetch/post gets 403 → "You've been removed from
  this channel," pane closes.
- Duplicate channel names allowed (identity is by ID, not name).

## Testing plan

- Server-side permission tests: non-admin create → 403; non-member read/post/rename →
  403; member (non-admin) rename → 403.
- Redis integrity: create seeds both member-set and by-member-set for every initial
  member; member removal updates both sides with no orphans.
- Unread counting: N messages after a member's `lastread` yields correct badge count
  on next `GET /api/channels`; marking read resets to 0.
- Real-time signal: two logged-in sessions — posting in one instantly bumps the
  other's badge only when notification level is `"all"`, does nothing when `"none"`.
- Rename: history/messages remain correctly associated after rename (ID-keyed).

## Rollout

Same feature, implemented once, applied via the identical commit sequence to both
`vings-workplace`/`master` and `pxlcode-workplace` branches (mirroring how prior
features in this session — chat history, wave/ping, bottom action bar, Meeting View,
zoom fix — were each built once and replicated across both deployments).
