<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import * as Sentry from "@sentry/svelte";
    import { AskPositionMessage_AskType } from "@workadventure/messages";
    import { hoverPreviewStore } from "../../Stores/HoverPreviewStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { openDirectChatRoom } from "../../Chat/Utils";
    import { getColorHexOfStatus, getStatusLabel } from "../../Utils/AvailabilityStatus";
    import { windowSize } from "../../Stores/CoWebsiteStore";
    import LL from "../../../i18n/i18n-svelte";

    // Reserved chrome so the popup never renders under the persistent TopBar (h-12 = 48px, see
    // TopBar.svelte - both it and the bottom ActionBar sit at z-[1000]) or the bottom ActionBar
    // (rounded bar + p-1/1.5/2 padding + mb-2 margin, see ActionBar.svelte / ResponsiveActionBar.svelte).
    // A little slack is added on top of each bar's own measured height as a margin of safety.
    const TOP_CHROME_RESERVED_PX = 56;
    const BOTTOM_CHROME_RESERVED_PX = 72;
    const VIEWPORT_MARGIN_PX = 8;
    // Fallback estimates used only for the very first paint, before the card's real size has been
    // measured via bind:offsetWidth/offsetHeight below.
    const CARD_WIDTH_ESTIMATE_PX = 240;
    const CARD_HEIGHT_ESTIMATE_PX = 190;

    let cardWidth = $state(0);
    let cardHeight = $state(0);

    // Set when the "Message" button is clicked but no chatID could be resolved for this player -
    // shown inline instead of letting the button silently no-op (same failure-visibility fix
    // already applied to the wave/ping toasts' quick-reply "failed" state).
    let messageUnavailable = $state(false);
    // Set when requestSocialSignal returns false (antispam limit hit) - same failure-visibility
    // fix as messageUnavailable, so hitting the limit here looks the same as it does anywhere
    // else the limit can block a wave, instead of the button silently doing nothing.
    let waveBlocked = $state(false);
    // Set when requestMeetingInvitation returns false (antispam limit: max 3 invites to the same
    // person per 10 minutes) - previously this closed the popup with zero indication anything went
    // wrong, which is exactly what made "Join my desk" look like it "sometimes just doesn't work"
    // when clicked repeatedly on the same person while testing.
    let joinDeskBlocked = $state(false);

    function wave() {
        const data = $hoverPreviewStore;
        if (!data) return;
        const sent = gameManager
            .getCurrentGameScene()
            .inviteManager?.requestSocialSignal("wave", data.userUuid, data.name, data.userId);
        if (sent === false) {
            waveBlocked = true;
            return;
        }
        // requestSocialSignal already logs this into the real direct-message conversation with
        // this person (see InviteManager.ts) - no need to do it again here.
        hoverPreviewStore.set(undefined);
    }

    function message() {
        const data = $hoverPreviewStore;
        if (!data) return;
        const chatID = gameManager
            .getCurrentGameScene()
            .getRemotePlayersRepository()
            .getPlayerByUuid(data.userUuid)?.chatID;
        if (!chatID) {
            // chatID is resolved lazily on click (not at render time), so it can genuinely be
            // unavailable here. Don't close the popup and don't silently do nothing - keep it
            // visible with a clear indication that nothing happened.
            messageUnavailable = true;
            return;
        }
        openDirectChatRoom(chatID).catch((error) => console.error("Failed to open direct chat room:", error));
        hoverPreviewStore.set(undefined);
    }

    // Same action as the "Follow" entry in the online-user-list dropdown (UserActionButton.svelte's
    // locateUser): asks the server to bring this player's woka into view/focus. Reuses the existing
    // AskPositionMessage/LOCATE mechanism rather than introducing a new one.
    function follow() {
        const data = $hoverPreviewStore;
        if (!data) return;
        const scene = gameManager.getCurrentGameScene();
        scene.connection?.emitAskPosition(data.userUuid, scene.roomUrl, AskPositionMessage_AskType.LOCATE);
        hoverPreviewStore.set(undefined);
    }

    // Reuses the existing meeting-invitation mechanism (same as UserActionButton.svelte's
    // "Invite") - sends this player a request to come join wherever the sender currently is.
    function joinMeAtMyDesk() {
        const data = $hoverPreviewStore;
        if (!data) return;
        const scene = gameManager.getCurrentGameScene();
        const sent = scene.inviteManager?.requestMeetingInvitation(data.userUuid, data.userId);
        if (sent === false) {
            joinDeskBlocked = true;
            return;
        }
        try {
            scene.playMeetingInviteSound();
        } catch (error) {
            console.error("Failed to play sound: ", error);
            Sentry.captureException(error);
        }
        hoverPreviewStore.set(undefined);
    }

    // Fix (cross-task review): Phaser's per-object POINTER_OVER/POINTER_OUT hit-testing only
    // fires while the cursor stays over the canvas. When the cursor leaves the canvas entirely
    // (onto a DOM panel, browser chrome, etc.) Phaser's InputPlugin does not emit POINTER_OUT for
    // whatever object the cursor was last over, so hoverPreviewStore was left populated
    // indefinitely - and since this popup is pointer-events-auto, it kept swallowing clicks in
    // that screen region. This single, global listener (attached once, for the app's lifetime -
    // see MainLayout.svelte, which now mounts this component unconditionally) clears the store
    // whenever the cursor leaves the canvas, regardless of which player (if any) is currently
    // shown.
    //
    // Guard against this card itself: this card is a `fixed`, `pointer-events-auto` overlay that
    // is NOT a descendant of the canvas element (it's rendered by Svelte into the app's own DOM
    // tree, positioned on top via CSS). So moving the cursor from the canvas onto the card (e.g.
    // to click Wave/Message) genuinely fires a canvas `mouseleave` with `relatedTarget` set to
    // (or inside) the card. Without this guard, that would unmount the card out from under the
    // cursor before any click on it could land, making Wave/Message unclickable via hover -
    // exactly the failure mode this fix must not introduce. Only clear the store when the cursor
    // did NOT land inside the card.
    function onCanvasMouseLeave(event: MouseEvent) {
        const related = event.relatedTarget;
        if (related instanceof Node && cardEl?.contains(related)) {
            return;
        }
        hoverPreviewStore.set(undefined);
    }

    let canvasEl: HTMLCanvasElement | undefined;
    // Bound to the card's root <div> below (alongside offsetWidth/offsetHeight) so
    // onCanvasMouseLeave can check whether the cursor landed inside it. May be undefined at the
    // moment mouseleave fires if the store was already cleared some other way (e.g. a click) -
    // the `cardEl?.contains(...)` check above handles that safely.
    let cardEl: HTMLDivElement | undefined;

    onMount(() => {
        canvasEl = gameManager.getCurrentGameScene().game.canvas;
        canvasEl.addEventListener("mouseleave", onCanvasMouseLeave);
    });

    onDestroy(() => {
        canvasEl?.removeEventListener("mouseleave", onCanvasMouseLeave);
    });

    // Reset the inline failure state whenever a new hover preview is shown (e.g. moving from one
    // player to another), so a stale "can't message" message doesn't linger for a different player.
    $effect(() => {
        const data = $hoverPreviewStore;
        if (data) {
            messageUnavailable = false;
            waveBlocked = false;
            joinDeskBlocked = false;
        }
    });

    // Viewport clamping: the card is positioned via translate(-50%, -100%) from a raw
    // (screenX, screenY) anchor point (see RemotePlayer.ts's getScreenPosition()), so with no
    // clamping it could render partly under the TopBar/ActionBar or half off-screen at the
    // left/right edges. Uses the card's own measured size once available (falls back to a fixed
    // estimate before first paint) and re-clamps on window resize via the windowSize store.
    let clampedLeft = $derived.by(() => {
        const data = $hoverPreviewStore;
        const size = $windowSize;
        if (!data) return 0;
        const halfWidth = (cardWidth || CARD_WIDTH_ESTIMATE_PX) / 2;
        const min = halfWidth + VIEWPORT_MARGIN_PX;
        const max = Math.max(min, size.width - halfWidth - VIEWPORT_MARGIN_PX);
        return Math.min(Math.max(data.screenX, min), max);
    });

    let clampedTop = $derived.by(() => {
        const data = $hoverPreviewStore;
        const size = $windowSize;
        if (!data) return 0;
        const height = cardHeight || CARD_HEIGHT_ESTIMATE_PX;
        const rawTop = data.screenY - 16;
        const min = TOP_CHROME_RESERVED_PX + height;
        const max = Math.max(min, size.height - BOTTOM_CHROME_RESERVED_PX);
        return Math.min(Math.max(rawTop, min), max);
    });
</script>

{#if $hoverPreviewStore}
    {@const data = $hoverPreviewStore}
    <div
        bind:this={cardEl}
        bind:offsetWidth={cardWidth}
        bind:offsetHeight={cardHeight}
        class="fixed z-[1050] -translate-x-1/2 -translate-y-full bg-contrast/90 backdrop-blur rounded-xl shadow-2xl p-3 pointer-events-auto flex flex-col gap-1.5 w-60"
        style="left: {clampedLeft}px; top: {clampedTop}px"
        data-testid="person-hover-preview"
    >
        <div class="text-white text-sm font-bold flex items-center gap-2">
            <span
                class="inline-block aspect-square h-2.5 w-2.5 rounded-full shrink-0"
                style="background-color: {getColorHexOfStatus(data.availabilityStatus)}"
            ></span>
            <span class="truncate">{data.name}</span>
        </div>
        <div class="text-xs" style="color: {getColorHexOfStatus(data.availabilityStatus)}">
            {getStatusLabel(data.availabilityStatus)}
        </div>
        {#if data.customStatusMessage}
            <div class="text-xs text-white/80 italic truncate">{data.customStatusMessage}</div>
        {/if}
        <div class="border-t border-white/10 my-1"></div>
        <div class="grid grid-cols-2 gap-2">
            <button type="button" class="btn btn-light btn-ghost justify-center w-full rounded-lg py-2 px-2" onclick={wave}>
                <span class="flex items-center gap-1.5 text-sm">
                    <span>👋</span>
                    <span class="truncate">{$LL.chat.socialSignal.wave()}</span>
                </span>
            </button>
            <button
                type="button"
                class="btn btn-light btn-ghost justify-center w-full rounded-lg py-2 px-2"
                onclick={message}
            >
                <span class="truncate text-sm">{$LL.chat.userList.sendMessage()}</span>
            </button>
            <button
                type="button"
                class="btn btn-light btn-ghost justify-center w-full rounded-lg py-2 px-2"
                onclick={follow}
            >
                <span class="truncate text-sm">{$LL.chat.userList.follow()}</span>
            </button>
            <button
                type="button"
                class="btn btn-light btn-ghost justify-center w-full rounded-lg py-2 px-2"
                onclick={joinMeAtMyDesk}
            >
                <span class="truncate text-sm">Join my desk</span>
            </button>
        </div>
        {#if messageUnavailable}
            <div class="text-xs opacity-70 text-center">Can't message - unavailable</div>
        {/if}
        {#if waveBlocked}
            <div class="text-xs opacity-70 text-center">Too many waves - try again later</div>
        {/if}
        {#if joinDeskBlocked}
            <div class="text-xs opacity-70 text-center">Too many invites to this person - try again later</div>
        {/if}
    </div>
{/if}
