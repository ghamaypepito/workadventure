# Office UX fixes and additions — design

Date: 2026-07-31
Branches: `pxlcode-workplace` and `master` (both deployments, per usual workflow)

## Background

A batch of 8 requested items, split into two groups after clarification with the user:

- Items 1–2 were reported from screenshots of the actual deployed app (real bugs).
- Items 3–8 were illustrated with screenshots from Gather (a different product), used purely
  as reference for desired look/behavior — none of that UI exists in our app today.

This spec covers all 8 items. They touch several independent parts of the front-end
(`play/src/front`), but are small enough individually to ship as one batch, consistent with
every other change this session (single Vercel deploy per branch, no backend/Railway changes).

## A. Custom status text (item 1)

**Scope decision:** local-only for this pass. The built-in statuses (`AvailabilityStatus.ONLINE
/ BUSY / BACK_IN_A_MOMENT / DO_NOT_DISTURB`) are a fixed enum defined in the shared
`@workadventure/messages` package and broadcast to other users through the game server /
pusher. Extending that to a free-text field visible to *other* users would require a protocol
change spanning the `back` and `pusher` services — a materially bigger, riskier change than
anything else done this session (those are separate Railway deployments, not a Vercel push).
Given that, this pass ships a **self-only** custom status message: visible only to the user who
set it, persisted locally, no backend/protocol changes.

- New `localStorage`-backed store, `customStatusMessageStore`, following the existing pattern
  used by `LocalUserStore.ts` (e.g. `requestedCameraStateKey`).
- New text input in the profile menu (`ProfileMenuContent.svelte`, near the existing
  `AvailabilityStatusList`) to set/clear the message.
- Displayed next to the user's own name in the profile button (e.g. bottom-bar "Ghamay Pepito /
  Online" becomes "Ghamay Pepito / Online · In a client call").
- Not sent over `RoomConnection` / not part of `emitPlayerStatusChange`. Other users never see it.

Follow-up (not in this pass, flagged for later if wanted): broadcasting this to other users
requires adding a field to the shared status message type and updating `back`/`pusher` to
relay it — a separate spec/deploy.

## B. Tooltip positioning fix (item 2)

**Root cause:** `HelpTooltip.svelte` positions itself with a hardcoded `top-[70px]` relative to
its own trigger's positioning container. For triggers living in the bottom action bar (a small
element near the bottom of the viewport), this pushes the tooltip further down rather than
above the icon, causing it to render inconsistently — sometimes clipped or overlapping other
bottom-bar chrome.

**Fix:** `ActionBarButton` already threads a `context` prop (`"actionBar" | "menu"`) distinguishing
bottom-action-bar buttons from top/side menu items. Pass this through to `HelpTooltip` (a new
`anchor: "above" | "below"` prop, derived from `context`):
- `context="actionBar"` → tooltip opens **above** the trigger (`bottom-full mb-2` positioning).
- `context="menu"` → keeps today's downward-opening behavior (already correct for top-anchored
  menus).

No visual redesign of the tooltip card itself — just the anchor direction/offset calculation.

## C. Wave/Ping toast overhaul (items 3 & 8)

Current state (`WaveReceivedToast.svelte` / `PingReceivedToast.svelte`): a plain toast reading
"👋 X waved at you" with a single Dismiss button. No reply actions, no sender-side sound, no
elapsed-time display, default (tinted) toast theme.

**Sound on send:** `InviteManager.requestSocialSignal()` currently only logs the outgoing wave
to chat history — no sound plays for the sender. Add a `scene.playSound(...)` call there
(reusing the existing `"wave"` / `"ping-bell"` audio keys, at the existing volume) so the sender
gets audible confirmation their wave/ping went out, symmetric with what the receiver already
hears.

**Reply actions**, added to both `WaveReceivedToast` and `PingReceivedToast`:
- **Wave back** — calls `inviteManager.requestSocialSignal(kind, senderUuid, senderName,
  senderUserId)` targeting the original sender.
- **Message** — opens a direct chat room with the sender (reuses the `openDirectChatRoom`
  pattern already used in `RemotePlayer.ts`'s "Send message" action).
- **"Will be there in a while"** — a canned quick-reply button that sends that literal string
  as a real direct message to the sender (same send path as the Message button, pre-filled and
  auto-sent, not just opening the compose box).

**Styling & timestamp:**
- New `theme="light"` variant on `ToastContainer.svelte` (white/light background, dark text),
  used only by the wave/ping toasts — other toasts (error/success/secondary) unchanged.
- Toast props gain a `receivedAt: number` (epoch ms, set when the toast is created). A small
  reactive relative-time label ("Just now", "2m ago") ticks via a `setInterval`-driven
  `$state`, cleaned up `onDestroy` — same lifecycle pattern already used elsewhere in the toast
  components (e.g. the existing `duration`/timeout handling in `ToastContainer`).

## D. New hover-preview popup (item 4)

Does not exist today — `RemotePlayer.ts` only binds a `POINTER_DOWN` handler (the existing
click-to-open `WokaMenu`). This is new functionality, not a bug fix.

- Add `POINTER_OVER` / `POINTER_OUT` handlers in `RemotePlayer.ts` (alongside the existing
  `POINTER_DOWN` in `bindEventHandlers()`), with a ~300ms dwell timer before showing (so a
  cursor passing over someone on the way elsewhere doesn't pop something up — the same
  fly-by-click lesson from the fullscreen-exit fix earlier this session).
- New store `hoverPreviewStore` (separate from `wokaMenuStore`, so hover-preview and the
  click-popup don't fight over the same state — clicking always takes precedence and closes
  the hover preview).
- New component `PersonHoverPreview.svelte`: compact card anchored near the character's
  screen position (world → screen coordinate conversion, same approach `WokaMenu` already
  needs for placement), showing name, status dot + label, and Wave / Message buttons only
  (not the full action set from the click popup).
- Dismissed on `POINTER_OUT`, on click (yields to the click popup), or if the player moves.

## E. Click-popup fixes (items 5 & 6)

`WokaMenu.svelte` today: closes on Escape key or after running an action; **no
click-outside-to-close**. Its wrapper is pinned `top-0 right-0` on desktop, flush with the very
top of the viewport — the same vertical band `TopBar` (z-1000) occupies — which can leave the
popup's own `ButtonClose` (top-right of the card) tucked underneath the top bar.

- Add a standard click-outside handler (document-level click listener while `wokaMenuData` is
  set; ignores clicks inside the popup's own root element) that calls the same
  `closeActionsMenu()` already used for Escape.
- Add a top offset to the wrapper (e.g. matching the toast's `top-12`) so the popup starts
  below `TopBar` instead of overlapping it — fixes the covered close button and, combined with
  section F below, stops it visually colliding with notifications in the same corner.

## F. Toast always-on-top (item 7)

Rather than chase the exact current reproduction (the toast wrapper is already `z-[999]`,
which by CSS stacking rules should already sit above `WokaMenu`'s effective z-index — the
report may describe a physical-position collision rather than a z-index one), make it
structurally impossible: bump the toast wrapper to a z-index explicitly above both `TopBar`
(1000) and any popup — e.g. `z-[1100]` — so wave/ping/other toasts can never be visually
covered by any popup panel, regardless of layout position.

## Testing

- Manual verification per section in the browser preview (custom status persists across
  reload; tooltip opens upward on bottom-bar icons; wave toast shows reply actions + sound
  both ways + white card + ticking timestamp; hovering a remote player after ~300ms shows the
  new compact popup and clicking elsewhere/them cleanly hands off to the click popup; clicking
  blank space closes `WokaMenu`; toast never visually covered by a popup).
- No automated test suite is run as part of this session's workflow (consistent with prior
  changes) — verification is via the deployed preview URLs on both branches.

## Out of scope

- Broadcasting the custom status text to other users (needs a `back`/`pusher` protocol change,
  flagged as a follow-up above).
- Any visual redesign to match Gather's exact avatar/card styling — only the interaction
  patterns (reply actions, hover preview, white toast card) are adopted, not Gather's broader
  visual language.
