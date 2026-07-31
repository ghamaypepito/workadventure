# Office UX Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the 8-item office UX batch from `docs/superpowers/specs/2026-07-31-office-ux-fixes-design.md`: a self-only custom status message, a tooltip positioning fix, a wave/ping toast overhaul (reply actions, sound-on-send, white styling, elapsed time), a new hover-preview popup, and two fixes to the existing click-popup (click-outside-to-close, top-bar overlap).

**Architecture:** All changes live in `play/src/front` (the Vercel-deployed static SPA). No backend/Railway changes. Each of the 6 feature areas is an independently testable task; a final task deploys to both `pxlcode-workplace` and `master` and verifies both live URLs, matching this project's established workflow.

**Tech Stack:** Svelte 5 (runes), TypeScript, Phaser 3, Tailwind, `svelte-outside` (already a dependency, provides the `clickOutside` action), Vitest (test runner exists in `play/package.json` but this session's established practice — used for every prior change — is manual verification against the deployed preview URL, not running the suite locally; `node_modules` is not installed in the working clone. Task 3's relative-time formatter is a pure function and gets a real Vitest unit test since it needs no DOM/browser; everything else is verified by deploying and checking the live site).

## Global Constraints

- No new i18n keys — this codebase uses `$LL...` for nearly all UI strings, but adding entries across every locale JSON file is out of proportion to this batch. New strings introduced by this plan (e.g. "Custom status", "Wave back", "Will be there in a while") are hardcoded English literals directly in the `.svelte` files touched.
- Every task ends with a commit on the current branch (`pxlcode-workplace`), following this session's git workflow: implement → commit → (final task) push + cherry-pick to `master` + push → verify both deployed bundle hashes change.
- No backend/protocol changes. Nothing in this plan touches `back/`, `pusher/`, or `messages/protos/messages.proto`.
- Follow existing patterns exactly where one already exists for the thing being built (e.g. reuse `svelte-outside`'s `clickOutside` action rather than writing a new one; reuse `LocalUserStore`'s `setX`/`getX` localStorage pattern).

---

## Task 1: Relative-time formatter (foundation for Task 3)

**Files:**
- Create: `play/src/front/Utils/RelativeTime.ts`
- Test: `play/src/front/Utils/RelativeTime.test.ts`

**Interfaces:**
- Produces: `formatRelativeTime(fromMs: number, nowMs: number): string` — used by Task 3's toast components.

- [ ] **Step 1: Write the failing test**

```typescript
// play/src/front/Utils/RelativeTime.test.ts
import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./RelativeTime";

describe("formatRelativeTime", () => {
    it("returns 'Just now' for under 60 seconds", () => {
        expect(formatRelativeTime(1000, 1000)).toBe("Just now");
        expect(formatRelativeTime(1000, 1000 + 59_000)).toBe("Just now");
    });

    it("returns minutes for 1 to 59 minutes", () => {
        expect(formatRelativeTime(0, 60_000)).toBe("1m ago");
        expect(formatRelativeTime(0, 59 * 60_000)).toBe("59m ago");
    });

    it("returns hours for 1 hour or more", () => {
        expect(formatRelativeTime(0, 60 * 60_000)).toBe("1h ago");
        expect(formatRelativeTime(0, 3 * 60 * 60_000 + 10_000)).toBe("3h ago");
    });

    it("never returns a negative duration (clock skew safety)", () => {
        expect(formatRelativeTime(1000, 900)).toBe("Just now");
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd play && npx vitest run src/front/Utils/RelativeTime.test.ts`
Expected: FAIL with "Cannot find module './RelativeTime'" (file doesn't exist yet)

- [ ] **Step 3: Write minimal implementation**

```typescript
// play/src/front/Utils/RelativeTime.ts
/**
 * Formats the gap between two timestamps (ms since epoch) as a short relative
 * label, matching the "X waved to you - 2m ago" style used on the wave/ping
 * toasts. `nowMs` is a parameter (not Date.now()) so this stays a pure,
 * unit-testable function - callers pass the current time in.
 */
export function formatRelativeTime(fromMs: number, nowMs: number): string {
    const diffMs = Math.max(0, nowMs - fromMs);
    const diffMinutes = Math.floor(diffMs / 60_000);

    if (diffMinutes < 1) {
        return "Just now";
    }
    if (diffMinutes < 60) {
        return `${diffMinutes}m ago`;
    }
    const diffHours = Math.floor(diffMinutes / 60);
    return `${diffHours}h ago`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd play && npx vitest run src/front/Utils/RelativeTime.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add play/src/front/Utils/RelativeTime.ts play/src/front/Utils/RelativeTime.test.ts
git commit -m "Add formatRelativeTime utility for wave/ping toast timestamps"
```

---

## Task 2: Toast infrastructure — light theme + timestamp + always-on-top z-index

**Files:**
- Modify: `play/src/front/Components/Toasts/ToastContainer.svelte`
- Modify: `play/src/front/Components/MainLayout.svelte:496` (toast wrapper z-index)

**Interfaces:**
- Consumes: `formatRelativeTime` from Task 1.
- Produces: `ToastContainer` gains `theme: "success" | "error" | "secondary" | "light"` (widened union) and an optional `receivedAt?: number` prop that renders a live-updating relative-time label under the message. Task 3 (`WaveReceivedToast`/`PingReceivedToast`) consumes both.

- [ ] **Step 1: Widen the theme union and add the `receivedAt` prop**

Edit `play/src/front/Components/Toasts/ToastContainer.svelte`. Current props interface (lines 7-14):

```svelte
    interface Props {
        extraClasses: string;
        duration?: number;
        toastUuid?: string;
        theme: "success" | "error" | "secondary";
        children?: Snippet;
        buttons?: Snippet;
    }

    let {
        extraClasses = "",
        duration = undefined,
        toastUuid = undefined,
        theme = "success",
        children,
        buttons,
    }: Props = $props();
```

Replace with:

```svelte
    interface Props {
        extraClasses: string;
        duration?: number;
        toastUuid?: string;
        theme: "success" | "error" | "secondary" | "light";
        receivedAt?: number;
        children?: Snippet;
        buttons?: Snippet;
    }

    let {
        extraClasses = "",
        duration = undefined,
        toastUuid = undefined,
        theme = "success",
        receivedAt = undefined,
        children,
        buttons,
    }: Props = $props();

    // Live-updating "Just now" / "2m ago" label. Only runs while receivedAt is set, so toasts
    // that don't pass it (every existing toast) pay no cost.
    let relativeTimeLabel: string | undefined = $state(undefined);
    let relativeTimeTimer: ReturnType<typeof setInterval> | undefined;

    if (receivedAt !== undefined) {
        relativeTimeLabel = formatRelativeTime(receivedAt, Date.now());
        relativeTimeTimer = setInterval(() => {
            relativeTimeLabel = formatRelativeTime(receivedAt, Date.now());
        }, 15_000);
    }
```

Add the import at the top of the `<script>` block (after the existing imports):

```typescript
    import { formatRelativeTime } from "../../Utils/RelativeTime";
```

Add cleanup in the existing `onDestroy` (currently only clears `timeout`):

```svelte
    onDestroy(() => {
        clearTimeout(timeout);
        if (relativeTimeTimer) {
            clearInterval(relativeTimeTimer);
        }
    });
```

- [ ] **Step 2: Add the `light` theme color bar and background, and render the timestamp**

The colored left bar (lines 46-51) switches on `theme`:

```svelte
    <div
        class="w-2 rounded-lg my-3"
        class:bg-danger={theme === "error"}
        class:bg-success={theme === "success"}
        class:bg-secondary={theme === "secondary"}
        class:bg-slate-300={theme === "light"}
    ></div>
```

The card background (line 53) currently hardcodes `bg-contrast/50 ... text-white`. Make it theme-aware:

```svelte
    <div
        class="flex flex-col backdrop-blur-md min-w-60 min-h-12 rounded-lg overflow-hidden transition-all responsive z-20 {extraClasses}"
        class:bg-contrast/50={theme !== "light"}
        class:text-white={theme !== "light"}
        class:bg-white/95={theme === "light"}
        class:text-slate-900={theme === "light"}
        transition:fly={{ x: 900, duration: 500 }}
    >
```

Render the timestamp below the message (inside the existing message wrapper div, lines 69-73):

```svelte
        <div class="flex items-center p-4 pointer-events-auto justify-center grow">
            <div class="text-center leading-6 responsive-message">
                {@render children?.()}
                {#if relativeTimeLabel}
                    <div class="text-xs opacity-60 mt-1">{relativeTimeLabel}</div>
                {/if}
            </div>
        </div>
```

- [ ] **Step 3: Bump the toast wrapper's z-index above every popup**

In `play/src/front/Components/MainLayout.svelte`, line 496 currently reads:

```svelte
                <div class="absolute top-12 right-2 z-[999] flex flex-col gap-2 items-end">
```

Change `z-[999]` to `z-[1100]` — above `TopBar`/`ResponsiveActionBar` (z-1000, set earlier this session) and above `WokaMenu`'s new top offset from Task 6, guaranteeing toasts are never covered by any popup panel:

```svelte
                <div class="absolute top-12 right-2 z-[1100] flex flex-col gap-2 items-end">
```

- [ ] **Step 4: Manual verification**

This step has no unit test (it's Svelte markup + Tailwind classes). Verification happens in Task 3's manual check, since no toast currently passes `theme="light"` or `receivedAt` yet — this task alone only needs to not break existing toasts. Confirm by reading the diff that every other `theme` value (`success`/`error`/`secondary`) is untouched in behavior.

- [ ] **Step 5: Commit**

```bash
git add play/src/front/Components/Toasts/ToastContainer.svelte play/src/front/Components/MainLayout.svelte
git commit -m "Add light toast theme, relative-time label, and bump toast z-index above all popups"
```

---

## Task 3: Wave/Ping toast reply actions + sound-on-send

**Files:**
- Modify: `play/src/front/Phaser/Game/InviteManager.ts:104-133` (received handler — pass `receivedAt`, add reply callbacks) and `:214-215` (`requestSocialSignal` — add sound-on-send)
- Modify: `play/src/front/Components/SocialSignal/WaveReceivedToast.svelte`
- Modify: `play/src/front/Components/SocialSignal/PingReceivedToast.svelte`
- Modify: `play/src/front/Chat/Utils.ts` (new `sendDirectMessage` helper)

**Interfaces:**
- Consumes: `ToastContainer`'s `theme="light"` and `receivedAt` from Task 2. `RemotePlayersRepository.getPlayerByUuid(uuid): RemotePlayerData | undefined` (already exists, returns object with public `.chatID` field). `openDirectChatRoom(chatID: string): Promise<void>` (already exists in `Chat/Utils.ts`). `inviteManager.requestSocialSignal(kind, receiverUserUuid, receiverUserName, receiverUserId?): boolean` (already exists).
- Produces: `sendDirectMessage(chatID: string, message: string): Promise<void>` in `Chat/Utils.ts`, for the "Will be there in a while" quick-reply.

- [ ] **Step 1: Add `sendDirectMessage` to `Chat/Utils.ts`**

Add after the existing `openDirectChatRoom` function (after line 100 in the current file):

```typescript
/**
 * Sends a direct message to chatID without opening the chat panel - used for the wave/ping
 * toast's canned quick-reply, where popping the whole chat UI open would be more disruptive
 * than the one-line reply itself.
 */
export const sendDirectMessage = async (chatID: string, message: string): Promise<void> => {
    if (!get(userIsConnected)) {
        return;
    }
    const chatConnection = await gameManager.getChatConnection();
    let room = chatConnection.getDirectRoomFor(chatID);
    if (!room) room = await chatConnection.createDirectRoom(chatID);
    if (!room) throw new Error("Failed to create room");
    if (get(room.myMembership) === "invite") {
        room.joinRoom().catch((error: unknown) => console.error(error));
    }
    room.sendMessage(message);
};
```

- [ ] **Step 2: Play a sound when sending a wave/ping (sender side)**

In `play/src/front/Phaser/Game/InviteManager.ts`, `requestSocialSignal` currently ends with (lines 214-233):

```typescript
        this.connection.emitSocialSignalRequest(receiverUserUuid, kind, receiverUserId);

        // Log the send side too (item 3: sender sees "You waved at X" / "You pinged X").
        const scene = gameManager.getCurrentGameScene();
        if (scene) {
```

Change to also play the sound (same keys/volume already used on the receiving end):

```typescript
        this.connection.emitSocialSignalRequest(receiverUserUuid, kind, receiverUserId);

        // Log the send side too (item 3: sender sees "You waved at X" / "You pinged X"), and play
        // the same sound the receiver hears so the sender gets audible confirmation their
        // wave/ping actually went out.
        const scene = gameManager.getCurrentGameScene();
        if (scene) {
            scene.playSound(kind === "wave" ? "wave" : "ping-bell", 2.0);
```

(the rest of the `if (scene)` block — the `logDirectMessage` try/catch — stays unchanged, just now has the `playSound` call as its first line).

- [ ] **Step 3: Pass `receivedAt` and reply callbacks to the received toast**

In `InviteManager.ts`, the `socialSignalReceivedStream` subscribe block (lines 104-133) currently builds:

```typescript
                toastStore.addToast(
                    kind === "wave" ? WaveReceivedToast : PingReceivedToast,
                    { actorName: payload.senderName, toastUuid: toastId },
                    toastId,
                );
```

Change the props passed to include everything the toast needs to build its own reply actions (the toast component resolves `chatID` itself via `getPlayerByUuid`, so we only need to pass identifiers here):

```typescript
                toastStore.addToast(
                    kind === "wave" ? WaveReceivedToast : PingReceivedToast,
                    {
                        actorName: payload.senderName,
                        senderUserUuid: payload.senderUserUuid,
                        senderUserId: payload.senderUserId,
                        receivedAt: Date.now(),
                        toastUuid: toastId,
                    },
                    toastId,
                );
```

- [ ] **Step 4: Rewrite `WaveReceivedToast.svelte` with reply actions**

Replace the full file:

```svelte
<script lang="ts">
    import { LL } from "../../../i18n/i18n-svelte";
    import ToastContainer from "../Toasts/ToastContainer.svelte";
    import { toastStore } from "../../Stores/ToastStoreSingleton";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { openDirectChatRoom, sendDirectMessage } from "../../Chat/Utils";

    interface Props {
        actorName: string;
        senderUserUuid: string;
        senderUserId?: number;
        receivedAt: number;
        toastUuid: string;
    }

    let { actorName, senderUserUuid, senderUserId, receivedAt, toastUuid = "" }: Props = $props();

    let quickReplySent = $state(false);

    function resolveChatID(): string | undefined {
        return gameManager
            .getCurrentGameScene()
            .getRemotePlayersRepository()
            .getPlayerByUuid(senderUserUuid)?.chatID;
    }

    function waveBack() {
        const scene = gameManager.getCurrentGameScene();
        scene.inviteManager?.requestSocialSignal("wave", senderUserUuid, actorName, senderUserId);
        toastStore.removeToast(toastUuid);
    }

    function message() {
        const chatID = resolveChatID();
        if (chatID) {
            openDirectChatRoom(chatID).catch((error) => console.error("Failed to open direct chat room:", error));
        }
        toastStore.removeToast(toastUuid);
    }

    function sendWillBeThere() {
        const chatID = resolveChatID();
        if (!chatID) {
            return;
        }
        sendDirectMessage(chatID, "Will be there in a while").catch((error) =>
            console.error("Failed to send quick reply:", error),
        );
        quickReplySent = true;
    }
</script>

<ToastContainer theme="light" extraClasses="" {toastUuid} {receivedAt}>
    👋 {$LL.chat.socialSignal.wavedToYou({ name: actorName })}
    {#snippet buttons()}
        <button type="button" class="btn btn-light btn-ghost text-sm" onclick={waveBack}> 👋 Wave back </button>
        <button type="button" class="btn btn-light btn-ghost text-sm" onclick={message}> Message </button>
        {#if quickReplySent}
            <span class="text-sm opacity-70">Sent ✓</span>
        {:else}
            <button type="button" class="btn btn-light btn-ghost text-sm" onclick={sendWillBeThere}>
                Will be there in a while
            </button>
        {/if}
        <button
            type="button"
            class="btn btn-light btn-ghost text-sm"
            onclick={() => toastStore.removeToast(toastUuid)}
        >
            {$LL.chat.socialSignal.dismiss()}
        </button>
    {/snippet}
</ToastContainer>
```

- [ ] **Step 5: Apply the same change to `PingReceivedToast.svelte`**

Same structure, swap `theme="secondary"` → `theme="light"`, the emoji/message line, and use `$LL.chat.socialSignal.wantsToTalk` and `"ping"` as the social-signal kind:

```svelte
<script lang="ts">
    import { LL } from "../../../i18n/i18n-svelte";
    import ToastContainer from "../Toasts/ToastContainer.svelte";
    import { toastStore } from "../../Stores/ToastStoreSingleton";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { openDirectChatRoom, sendDirectMessage } from "../../Chat/Utils";

    interface Props {
        actorName: string;
        senderUserUuid: string;
        senderUserId?: number;
        receivedAt: number;
        toastUuid: string;
    }

    let { actorName, senderUserUuid, senderUserId, receivedAt, toastUuid = "" }: Props = $props();

    let quickReplySent = $state(false);

    function resolveChatID(): string | undefined {
        return gameManager
            .getCurrentGameScene()
            .getRemotePlayersRepository()
            .getPlayerByUuid(senderUserUuid)?.chatID;
    }

    function pingBack() {
        const scene = gameManager.getCurrentGameScene();
        scene.inviteManager?.requestSocialSignal("ping", senderUserUuid, actorName, senderUserId);
        toastStore.removeToast(toastUuid);
    }

    function message() {
        const chatID = resolveChatID();
        if (chatID) {
            openDirectChatRoom(chatID).catch((error) => console.error("Failed to open direct chat room:", error));
        }
        toastStore.removeToast(toastUuid);
    }

    function sendWillBeThere() {
        const chatID = resolveChatID();
        if (!chatID) {
            return;
        }
        sendDirectMessage(chatID, "Will be there in a while").catch((error) =>
            console.error("Failed to send quick reply:", error),
        );
        quickReplySent = true;
    }
</script>

<ToastContainer theme="light" extraClasses="" {toastUuid} {receivedAt}>
    🔔 {$LL.chat.socialSignal.wantsToTalk({ name: actorName })}
    {#snippet buttons()}
        <button type="button" class="btn btn-light btn-ghost text-sm" onclick={pingBack}> 🔔 Ping back </button>
        <button type="button" class="btn btn-light btn-ghost text-sm" onclick={message}> Message </button>
        {#if quickReplySent}
            <span class="text-sm opacity-70">Sent ✓</span>
        {:else}
            <button type="button" class="btn btn-light btn-ghost text-sm" onclick={sendWillBeThere}>
                Will be there in a while
            </button>
        {/if}
        <button
            type="button"
            class="btn btn-light btn-ghost text-sm"
            onclick={() => toastStore.removeToast(toastUuid)}
        >
            {$LL.chat.socialSignal.dismiss()}
        </button>
    {/snippet}
</ToastContainer>
```

- [ ] **Step 6: Manual verification (two browser tabs/sessions)**

1. `preview_start` the dev server, open two tabs logged in as two different users in the same room.
2. From tab A, wave at the user in tab B (via their in-game menu). Confirm tab A hears a sound immediately (sender-side, new behavior) and tab B hears a sound **and** sees a white toast card with "Wave back", "Message", "Will be there in a while", and "Dismiss", plus a "Just now" label that updates to "1m ago" after a minute (check via `read_page` / a screenshot after waiting, or shorten the interval temporarily while testing).
3. Click "Wave back" in tab B — confirm tab A receives a new wave toast.
4. Click "Will be there in a while" on a fresh wave toast in tab B — confirm the button row swaps to "Sent ✓" and tab A's chat (open the chat panel) shows the message arrived.
5. Repeat steps 2-4 for Ping (trigger via one user being Busy/DND, per the existing ping-eligibility rule in `RemotePlayer.ts`).

- [ ] **Step 7: Commit**

```bash
git add play/src/front/Phaser/Game/InviteManager.ts play/src/front/Components/SocialSignal/WaveReceivedToast.svelte play/src/front/Components/SocialSignal/PingReceivedToast.svelte play/src/front/Chat/Utils.ts
git commit -m "Add wave/ping toast reply actions, sender-side sound, and white styling"
```

---

## Task 4: Custom status text (local-only)

**Files:**
- Modify: `play/src/front/Connection/LocalUserStore.ts` (add key + getter/setter)
- Create: `play/src/front/Stores/CustomStatusMessageStore.ts`
- Modify: `play/src/front/Components/ActionBar/MenuIcons/ProfileMenuContent.svelte:166` (add input UI)
- Modify: `play/src/front/Components/ActionBar/MenuIcons/ProfileMenu.svelte:110-116` (display it)

**Interfaces:**
- Produces: `customStatusMessageStore: Writable<string>` — reactive, backed by `localStorage`.

- [ ] **Step 1: Add the localStorage key and get/set methods to `LocalUserStore.ts`**

Add a new key near the other key declarations (after line 60, `export const languageKey = "language";`):

```typescript
const customStatusMessageKey = "customStatusMessage";
```

Add the get/set methods near `setName`/`getName` (after line 161), following the exact same pattern:

```typescript
    setCustomStatusMessage(message: string): void {
        localStorage.setItem(customStatusMessageKey, message);
    }

    getCustomStatusMessage(): string {
        return localStorage.getItem(customStatusMessageKey) || "";
    }
```

- [ ] **Step 2: Create the reactive store**

```typescript
// play/src/front/Stores/CustomStatusMessageStore.ts
import { writable } from "svelte/store";
import { localUserStore } from "../Connection/LocalUserStore";

/**
 * Self-only custom status text (e.g. "In a client call"), shown next to the user's own name in
 * the profile menu button. Not broadcast to other users - the built-in Online/Busy/Back in a
 * moment/DND statuses are a fixed enum synced through the game server, and extending that to a
 * free-text field other users can see requires a backend protocol change (out of scope here -
 * see the "Out of scope" section of the design spec).
 */
function createCustomStatusMessageStore() {
    const { subscribe, set } = writable<string>(localUserStore.getCustomStatusMessage());

    return {
        subscribe,
        set: (message: string) => {
            localUserStore.setCustomStatusMessage(message);
            set(message);
        },
    };
}

export const customStatusMessageStore = createCustomStatusMessageStore();
```

- [ ] **Step 3: Verify `localUserStore` is the exported singleton name**

Run: `grep -n "^export const localUserStore" play/src/front/Connection/LocalUserStore.ts`
Expected: one match confirming the singleton export name. If the actual export is named differently, use that name instead in Step 2's import.

- [ ] **Step 4: Add the input UI to `ProfileMenuContent.svelte`**

Add the import at the top of the `<script>` block:

```typescript
    import { customStatusMessageStore } from "../../../Stores/CustomStatusMessageStore";
```

Insert directly after line 166 (`<AvailabilityStatusList statusInformation={getStatusInformation(statusToShow)} />`) and before `<HeaderMenuItem label={$LL.menu.sub.profile()} />`:

```svelte
        <div class="px-3 py-2">
            <label for="custom-status-input" class="text-xxs uppercase opacity-60 block mb-1">
                Custom status
            </label>
            <input
                id="custom-status-input"
                type="text"
                maxlength="40"
                placeholder="e.g. In a client call"
                class="w-full bg-white/10 rounded px-2 py-1 text-sm text-white placeholder:text-white/40 outline-none focus:bg-white/20"
                value={$customStatusMessageStore}
                oninput={(e) => customStatusMessageStore.set((e.target as HTMLInputElement).value)}
            />
        </div>
```

- [ ] **Step 5: Display it next to the status label in `ProfileMenu.svelte`**

Add the same import, and change lines 110-116 from:

```svelte
                    <div
                        class="hidden @xl/actions:block"
                        style="color: {getColorHexOfStatus($availabilityStatusStore)};filter: brightness(200%);"
                    >
                        {getStatusLabel($availabilityStatusStore)}
                    </div>
```

to:

```svelte
                    <div
                        class="hidden @xl/actions:block"
                        style="color: {getColorHexOfStatus($availabilityStatusStore)};filter: brightness(200%);"
                    >
                        {getStatusLabel($availabilityStatusStore)}{$customStatusMessageStore
                            ? ` · ${$customStatusMessageStore}`
                            : ""}
                    </div>
```

- [ ] **Step 6: Manual verification**

1. `preview_start` the dev server, open the profile menu, type "In a client call" into the new Custom status field.
2. Confirm the bottom-bar profile button now shows "Online · In a client call".
3. Reload the page. Confirm the text is still there (persisted via localStorage) and still shown.
4. Clear the field. Confirm the " · ..." suffix disappears entirely (not just an empty string after the dot).
5. Open a second browser profile/incognito tab as a different user in the same room — confirm that user does **not** see the first user's custom status anywhere (self-only, as designed).

- [ ] **Step 7: Commit**

```bash
git add play/src/front/Connection/LocalUserStore.ts play/src/front/Stores/CustomStatusMessageStore.ts play/src/front/Components/ActionBar/MenuIcons/ProfileMenuContent.svelte play/src/front/Components/ActionBar/MenuIcons/ProfileMenu.svelte
git commit -m "Add self-only custom status message"
```

---

## Task 5: Tooltip anchor fix

**Files:**
- Modify: `play/src/front/Components/Tooltip/HelpTooltip.svelte:32-44`

**Interfaces:**
- No new props. Pure positioning fix — every existing caller (`ActionBarButton.svelte`) is unaffected.

- [ ] **Step 1: Confirm every current usage is bottom-action-bar context**

Run: `grep -rn "HelpTooltip" play/src/front/Components/ActionBar/ActionBarButton.svelte`
Expected: the `<HelpTooltip>` usage appears only inside the `{#if !isInMenu}` branch (the bottom-action-bar rendering path) — confirming there is no existing top-anchored usage whose current downward-opening behavior needs preserving. This means the fix can unconditionally anchor above the trigger.

- [ ] **Step 2: Flip the positioning from below to above**

`HelpTooltip.svelte` lines 32-44 currently:

```svelte
<div
    class="sm:block absolute p-1.5 {hasImage && hasDesc
        ? 'w-64'
        : 'min-w-[128px] text-center'} z-[500] text-white rounded-lg top-[70px] -start-2 transform before:content-[''] before:absolute before:w-full before:h-full before:z-1 before:start-0 before:top-0 before:rounded-lg before:bg-contrast/80 before:backdrop-blur after:content-[''] after:absolute after:z-0 after:w-full after:bg-transparent after:h-full after:-top-4 after:-start-0"
    in:fly={{ delay: delayBeforeAppear, y: 40, duration: 150 }}
>
    <img
        alt="Sub menu arrow"
        loading="eager"
        src={tooltipArrow}
        class="content-[''] absolute -top-1 start-9 m-auto w-2 h-1"
        draggable="false"
    />
```

The bug: `top-[70px]` is a hardcoded pixel offset from the top of the trigger's small wrapper div (a ~48-64px-tall button near the bottom of the viewport), which pushes the tooltip further *down* — off toward (or past) the bottom edge of the screen — instead of appearing above the icon. Replace with `bottom-full mb-2` (always positions the tooltip's bottom edge flush with the top of the trigger, regardless of the trigger's exact height — no more magic number), and flip the arrow to point downward at the trigger below it:

```svelte
<div
    class="sm:block absolute p-1.5 {hasImage && hasDesc
        ? 'w-64'
        : 'min-w-[128px] text-center'} z-[500] text-white rounded-lg bottom-full mb-2 -start-2 transform before:content-[''] before:absolute before:w-full before:h-full before:z-1 before:start-0 before:top-0 before:rounded-lg before:bg-contrast/80 before:backdrop-blur after:content-[''] after:absolute after:z-0 after:w-full after:bg-transparent after:h-full after:-top-4 after:-start-0"
    in:fly={{ delay: delayBeforeAppear, y: -40, duration: 150 }}
>
    <img
        alt="Sub menu arrow"
        loading="eager"
        src={tooltipArrow}
        class="content-[''] absolute -bottom-1 start-9 m-auto w-2 h-1 rotate-180"
        draggable="false"
    />
```

(Two changes beyond the position class: `y: 40` → `y: -40` in the `fly` transition, so the slide-in direction still matches the new upward position; and the arrow gets `-bottom-1` instead of `-top-1` plus a `rotate-180` so its point faces down toward the button.)

- [ ] **Step 2: Manual verification**

1. `preview_start` the dev server.
2. Hover the camera icon, mic icon, and at least 2 other bottom-action-bar icons.
3. Confirm the tooltip appears fully above each icon, never clipped by the bottom of the viewport, for every icon tested (this was the "inconsistent, goes to the bottom" complaint).
4. Zoom/resize the browser window narrower (mobile-ish width) and repeat — confirm it's still positioned correctly relative to its trigger.

- [ ] **Step 3: Commit**

```bash
git add play/src/front/Components/Tooltip/HelpTooltip.svelte
git commit -m "Fix action-bar icon tooltips to anchor above the trigger instead of a hardcoded offset"
```

---

## Task 6: Click-popup fixes — click-outside-to-close + top-bar overlap

**Files:**
- Modify: `play/src/front/Components/ActionsMenu/WokaMenu.svelte`
- Modify: `play/src/front/Components/MainLayout.svelte:544-547` (WokaMenu's wrapper positioning)

**Interfaces:**
- Consumes: `clickOutside` action from the existing `svelte-outside` dependency (already used in `EmoteMenu.svelte`).

- [ ] **Step 1: Confirm the dependency is available**

Run: `grep -n "svelte-outside" play/package.json`
Expected: one match under `dependencies`, confirming it's already installed (no `npm install` needed).

- [ ] **Step 2: Add click-outside-to-close to `WokaMenu.svelte`**

Add the import at the top of the `<script>` block:

```typescript
    import { clickOutside } from "svelte-outside";
```

The root popup div (line 86-89) currently:

```svelte
    <div
        class="m-auto my-0 h-fit min-h-fit max-w-lg min-w-48 max-sm:max-w-[89%] z-50 bg-contrast/80 transition-all backdrop-blur rounded-lg pointer-events-auto overflow-hidden md:mr-0"
        data-testid="actions-menu"
    >
```

Add the action:

```svelte
    <div
        class="m-auto my-0 h-fit min-h-fit max-w-lg min-w-48 max-sm:max-w-[89%] z-50 bg-contrast/80 transition-all backdrop-blur rounded-lg pointer-events-auto overflow-hidden md:mr-0"
        data-testid="actions-menu"
        use:clickOutside={closeActionsMenu}
    >
```

`closeActionsMenu` already exists in this file (lines 28-34) and is exactly the function we want called — it clears the store and emits the ask-position message, same as the existing Escape-key path.

- [ ] **Step 3: Fix the wrapper's top-bar overlap**

In `MainLayout.svelte`, the shared wrapper for `VisitCard`/`WokaMenu`/`ActionsMenu`/`MeetingInvitationPopup` (lines 544-547) currently:

```svelte
                <div
                    transition:fly={{ x: 210, duration: 500 }}
                    class="absolute bottom-0 w-full h-fit max-h-[calc(100dvh-100px)] md:top-0 md:right-0 md:w-fit flex flex-col gap-2 items-end justify-start p-0 m-0 mr-3 overflow-y-auto no-scroll-bar"
                >
```

On desktop (`md:`) this pins flush to `top-0`, the same band `TopBar` (z-1000) occupies, which is why `WokaMenu`'s own `ButtonClose` (top-right of its card) can end up tucked underneath the top bar. Add a top offset matching the toast wrapper's `top-12` so it starts below the top bar instead of behind it:

```svelte
                <div
                    transition:fly={{ x: 210, duration: 500 }}
                    class="absolute bottom-0 w-full h-fit max-h-[calc(100dvh-100px)] md:top-12 md:right-0 md:w-fit flex flex-col gap-2 items-end justify-start p-0 m-0 mr-3 overflow-y-auto no-scroll-bar"
                >
```

(Only `md:top-0` → `md:top-12` changes; the mobile `bottom-0` anchoring is untouched.)

- [ ] **Step 4: Manual verification**

1. `preview_start` the dev server, click on a remote player's woka to open `WokaMenu`.
2. Confirm the popup now starts below the top bar (not overlapping it), and its `ButtonClose` (X) is fully visible and clickable.
3. Click on a blank area of the map (not the popup, not another player). Confirm the popup closes.
4. Reopen the popup, press Escape. Confirm it still closes (regression check on the pre-existing behavior).
5. With the popup open, trigger a wave/ping toast (from Task 3) at the same time. Confirm the toast renders fully visible, never covered by the popup (Task 2's z-1100 bump plus this task's top-12 offset together should make this impossible; visually confirm anyway).

- [ ] **Step 5: Commit**

```bash
git add play/src/front/Components/ActionsMenu/WokaMenu.svelte play/src/front/Components/MainLayout.svelte
git commit -m "Add click-outside-to-close to WokaMenu and fix its close button being covered by the top bar"
```

---

## Task 7: New hover-preview popup

**Files:**
- Create: `play/src/front/Stores/HoverPreviewStore.ts`
- Create: `play/src/front/Components/ActionsMenu/PersonHoverPreview.svelte`
- Modify: `play/src/front/Phaser/Entity/RemotePlayer.ts`
- Modify: `play/src/front/Components/MainLayout.svelte` (mount the new component)

**Interfaces:**
- Consumes: `RemotePlayersRepository.getPlayers().get(userId)` (existing, returns `RemotePlayerData` with public `.availabilityStatus`/`.chatID`/`.name` fields). `inviteManager.requestSocialSignal` and `Chat/Utils.openDirectChatRoom` (both already used in Task 3).
- Produces: `hoverPreviewStore: Writable<HoverPreviewData | undefined>`, consumed only by the new `PersonHoverPreview.svelte`.

- [ ] **Step 1: Create the hover-preview store**

```typescript
// play/src/front/Stores/HoverPreviewStore.ts
import { writable } from "svelte/store";
import type { AvailabilityStatus } from "@workadventure/messages";

export interface HoverPreviewData {
    userId: number;
    userUuid: string;
    name: string;
    availabilityStatus: AvailabilityStatus;
    screenX: number;
    screenY: number;
}

/**
 * Backs the compact hover-preview popup (name + status + Wave/Message), shown ~300ms after the
 * cursor rests on a remote player's character. Deliberately a separate store from
 * wokaMenuStore - clicking always takes precedence and clears this one (see RemotePlayer.ts's
 * toggleActionsMenu), so the two popups never fight over the same state.
 */
export const hoverPreviewStore = writable<HoverPreviewData | undefined>(undefined);
```

- [ ] **Step 2: Add POINTER_OVER/POINTER_OUT handling to `RemotePlayer.ts`**

Add the import at the top of the file:

```typescript
    import { hoverPreviewStore } from "../../Stores/HoverPreviewStore";
```

Add a private field alongside the other private fields (near line 43, `private pathFollowingUpdateCallback`):

```typescript
    private hoverTimer: ReturnType<typeof setTimeout> | undefined;
```

In `bindEventHandlers()` (currently lines 336-342), add the two new listeners after the existing `POINTER_DOWN` one:

```typescript
    private bindEventHandlers(): void {
        this.on(Phaser.Input.Events.POINTER_DOWN, (event: Phaser.Input.Pointer) => {
            if (event.downElement.nodeName === "CANVAS" && event.leftButtonDown()) {
                this.emit(RemotePlayerEvent.Clicked);
            }
        });

        // Hover-preview: a compact Wave/Message popup shown after a short dwell, so a cursor
        // just passing over someone on the way elsewhere doesn't pop something up (the same
        // fly-by-click lesson from the fullscreen-exit dwell guard elsewhere in this app).
        this.on(Phaser.Input.Events.POINTER_OVER, () => {
            this.hoverTimer = setTimeout(() => {
                this.hoverTimer = undefined;
                const cam = this.scene.cameras.main;
                const player = this.scene.getRemotePlayersRepository().getPlayers().get(this.userId);
                hoverPreviewStore.set({
                    userId: this.userId,
                    userUuid: this.userUuid,
                    name: this.playerName,
                    availabilityStatus: player?.availabilityStatus ?? 0,
                    screenX: (this.x - cam.scrollX) * cam.zoom,
                    screenY: (this.y - cam.scrollY) * cam.zoom,
                });
            }, 300);
        });

        this.on(Phaser.Input.Events.POINTER_OUT, () => {
            if (this.hoverTimer) {
                clearTimeout(this.hoverTimer);
                this.hoverTimer = undefined;
            }
            hoverPreviewStore.update((current) => (current?.userId === this.userId ? undefined : current));
        });
    }
```

In `toggleActionsMenu()` (currently starting at line 175), add a clear of the hover preview at the very start, so clicking always hands off from hover to the full click-popup:

```typescript
    private toggleActionsMenu(): void {
        hoverPreviewStore.set(undefined);
        // Track the open woka menu action
        analyticsClient.openWokaMenu();
```

In `destroy()` (lines 165-169), clear any pending hover timer so it can't fire after the sprite is gone:

```typescript
    public destroy(): void {
        if (this.hoverTimer) {
            clearTimeout(this.hoverTimer);
        }
        this.stopMoveTo();
        wokaMenuStore.removeRemotePlayer(this.userUuid);
        super.destroy();
    }
```

- [ ] **Step 3: Create `PersonHoverPreview.svelte`**

```svelte
<script lang="ts">
    import { hoverPreviewStore } from "../../Stores/HoverPreviewStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { openDirectChatRoom } from "../../Chat/Utils";
    import { getColorHexOfStatus, getStatusLabel } from "../../Utils/AvailabilityStatus";

    function wave() {
        const data = $hoverPreviewStore;
        if (!data) return;
        gameManager.getCurrentGameScene().inviteManager?.requestSocialSignal("wave", data.userUuid, data.name, data.userId);
        hoverPreviewStore.set(undefined);
    }

    function message() {
        const data = $hoverPreviewStore;
        if (!data) return;
        const chatID = gameManager
            .getCurrentGameScene()
            .getRemotePlayersRepository()
            .getPlayerByUuid(data.userUuid)?.chatID;
        if (chatID) {
            openDirectChatRoom(chatID).catch((error) => console.error("Failed to open direct chat room:", error));
        }
        hoverPreviewStore.set(undefined);
    }
</script>

{#if $hoverPreviewStore}
    {@const data = $hoverPreviewStore}
    <div
        class="fixed z-[400] -translate-x-1/2 -translate-y-full bg-contrast/90 backdrop-blur rounded-lg p-2 pointer-events-auto flex flex-col gap-1 min-w-40"
        style="left: {data.screenX}px; top: {data.screenY - 16}px"
        data-testid="person-hover-preview"
    >
        <div class="text-white text-sm font-bold flex items-center gap-1.5">
            <span
                class="inline-block aspect-square h-2 w-2 rounded-full"
                style="background-color: {getColorHexOfStatus(data.availabilityStatus)}"
            ></span>
            {data.name}
        </div>
        <div class="text-xxs opacity-70" style="color: {getColorHexOfStatus(data.availabilityStatus)}">
            {getStatusLabel(data.availabilityStatus)}
        </div>
        <div class="flex gap-1 mt-1">
            <button type="button" class="btn btn-light btn-ghost text-xs flex-1" onclick={wave}>👋 Wave</button>
            <button type="button" class="btn btn-light btn-ghost text-xs flex-1" onclick={message}>Message</button>
        </div>
    </div>
{/if}
```

- [ ] **Step 4: Mount it in `MainLayout.svelte`**

Add the import:

```typescript
    import PersonHoverPreview from "./ActionsMenu/PersonHoverPreview.svelte";
    import { hoverPreviewStore } from "../Stores/HoverPreviewStore";
```

Add the render, right after the `{#if $toastStore.size > 0}` block (after line 503, before `{#if $showRecordingList}`):

```svelte
            {#if $hoverPreviewStore}
                <PersonHoverPreview />
            {/if}
```

- [ ] **Step 5: Manual verification (two browser tabs/sessions)**

1. `preview_start` the dev server, open two tabs as two different users in the same room, standing near each other.
2. In tab A, hover the mouse over tab B's character (no click) and hold still. Confirm nothing appears for the first ~300ms, then the compact popup (name, status dot+label, Wave, Message) appears above their head.
3. Move the mouse away without clicking. Confirm the popup disappears immediately.
4. Hover again, then click the character before the 300ms dwell completes. Confirm the hover popup never appears and the full click-popup (`WokaMenu`) opens instead (click always wins).
5. Hover, wait for the popup, then click "Wave" in it. Confirm tab B receives the wave toast from Task 3, and tab A's hover popup closes.
6. Repeat for "Message" — confirm it opens the direct chat room with that person.
7. Move tab B's character around (walk) while tab A is hovering over them. Confirm the popup either tracks the new position or disappears cleanly (no stale/detached popup left behind at the old position) — since the hover data isn't re-computed on movement, verify at minimum that walking away triggers `POINTER_OUT` and clears it; if it doesn't clear reliably during continuous movement, that's an acceptable known limitation for this pass (players are usually stationary when hovered), not a blocking bug.

- [ ] **Step 6: Commit**

```bash
git add play/src/front/Stores/HoverPreviewStore.ts play/src/front/Components/ActionsMenu/PersonHoverPreview.svelte play/src/front/Phaser/Entity/RemotePlayer.ts play/src/front/Components/MainLayout.svelte
git commit -m "Add hover-preview popup with Wave/Message actions on remote players"
```

---

## Task 8: Deploy to both branches and verify

**Files:** none (git/deploy operations only)

- [ ] **Step 1: Push to `pxlcode-workplace`**

```bash
git push origin pxlcode-workplace
```

- [ ] **Step 2: Capture the current bundle hash and poll for the new one**

```bash
curl -s https://pxlcode-workplace.vercel.app/ | grep -o 'main-[A-Za-z0-9_-]*\.js'
```

Poll (e.g. via the `Monitor` tool, matching this session's established pattern) until the hash changes from the captured baseline.

- [ ] **Step 3: Cherry-pick the same commits onto `master`**

```bash
git fetch origin pxlcode-workplace
git checkout master
git pull origin master
git cherry-pick <first-new-commit-sha>^..<last-new-commit-sha>
git push origin master
```

- [ ] **Step 4: Capture and poll `vings-workplace`'s bundle hash the same way**

```bash
curl -s https://vings-workplace.vercel.app/ | grep -o 'main-[A-Za-z0-9_-]*\.js'
```

Poll until it changes from its baseline, confirming both `pxlcode-workplace.vercel.app` and `office.connectiumai.com` are serving the new build.

- [ ] **Step 5: Re-run the manual verification checklists from Tasks 3, 4, 5, 6, and 7 against the live URLs** (not just the local dev server), since this is the actual deployed behavior the user will see.

---

## Self-Review Notes

- **Spec coverage:** Item 1 → Task 4. Item 2 → Task 5. Item 3 → Task 3 (reply actions + sound). Item 4 → Task 7. Item 5 → Task 6 (repositioning). Item 6 → Task 6 (click-outside + close button covered). Item 7 → Task 2 (z-index bump). Item 8 → Tasks 2+3 (white theme + timestamp). All 8 items are covered.
- **Placeholder scan:** no TBD/TODO; every step has complete code. Task 7 Step 5's note about movement-tracking is an explicit, justified scope boundary (not a placeholder) — flagged as a known limitation, not left vague.
- **Type consistency:** `HoverPreviewData` (Task 7) fields (`userId`, `userUuid`, `name`, `availabilityStatus`, `screenX`, `screenY`) are used identically in `RemotePlayer.ts` and `PersonHoverPreview.svelte`. `sendDirectMessage(chatID: string, message: string)` (Task 3) signature matches its one call site. `formatRelativeTime(fromMs, nowMs)` (Task 1) matches its one call site in `ToastContainer.svelte` (Task 2).
