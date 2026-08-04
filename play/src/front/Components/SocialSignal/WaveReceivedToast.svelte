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

    let quickReplyState: "idle" | "sending" | "sent" | "failed" = $state("idle");
    // Set when "Message" is clicked but no chatID could be resolved - shown inline instead of
    // letting the toast close with nothing visibly having happened (same failure-visibility
    // fix already applied to the quick-reply's "failed" state below).
    let messageUnavailable = $state(false);
    // Set when "Walk to desk" is clicked but the sender's live position couldn't be resolved (e.g.
    // they've since left the room) - same failure-visibility pattern as messageUnavailable.
    let walkUnavailable = $state(false);

    function resolveChatID(): string | undefined {
        return gameManager
            .getCurrentGameScene()
            .getRemotePlayersRepository()
            .getPlayerByUuid(senderUserUuid)?.chatID;
    }

    function walkToDesk() {
        const scene = gameManager.getCurrentGameScene();
        const player = scene.getRemotePlayersRepository().getPlayerByUuid(senderUserUuid);
        if (!player) {
            // Position is only known while the sender is loaded in this room's repository - if
            // they've left since sending the wave, there's nowhere to walk to.
            walkUnavailable = true;
            return;
        }
        scene
            .moveTo({ x: player.position.x, y: player.position.y }, true)
            .catch((error) => console.error("Failed to walk to sender's position:", error));
        toastStore.removeToast(toastUuid);
    }

    function waveBack() {
        const scene = gameManager.getCurrentGameScene();
        // requestSocialSignal already logs this into the real direct-message conversation with
        // this person (see InviteManager.ts) - no need to do it again here.
        scene.inviteManager?.requestSocialSignal("wave", senderUserUuid, actorName, senderUserId);
        toastStore.removeToast(toastUuid);
    }

    function message() {
        const chatID = resolveChatID();
        if (!chatID) {
            // chatID is resolved lazily on click, so it can genuinely be unavailable here. Keep
            // the toast open and show a clear failure state rather than closing silently.
            messageUnavailable = true;
            return;
        }
        openDirectChatRoom(chatID).catch((error) => console.error("Failed to open direct chat room:", error));
        toastStore.removeToast(toastUuid);
    }

    async function sendWillBeThere() {
        const chatID = resolveChatID();
        if (!chatID) {
            // No way to reach the sender's chat yet - surface the same failure state as a send
            // error, rather than silently doing nothing (the button should never look like it
            // did something when it didn't).
            quickReplyState = "failed";
            return;
        }
        quickReplyState = "sending";
        try {
            // NOTE: "sent" here means sendDirectMessage() didn't throw - it does not guarantee the
            // message actually reached the server. See the KNOWN LIMITATION doc comment on
            // sendDirectMessage (Chat/Utils.ts) for why a genuine post-room-creation send failure
            // can't currently surface as "failed" (MatrixChatRoom.sendMessage is fire-and-forget
            // by design, and that's a shared interface out of scope to widen for this batch).
            await sendDirectMessage(chatID, "Will be there in a while");
            quickReplyState = "sent";
        } catch (error) {
            console.error("Failed to send quick reply:", error);
            quickReplyState = "failed";
        }
    }
</script>

<ToastContainer theme="light" extraClasses="" {toastUuid} {receivedAt}>
    👋 {$LL.chat.socialSignal.wavedToYou({ name: actorName })}
    {#snippet buttons()}
        <button type="button" class="btn btn-light btn-ghost text-sm w-full" onclick={waveBack}>
            👋 Wave back
        </button>
        <button type="button" class="btn btn-light btn-ghost text-sm w-full" onclick={message}> Message </button>
        <button type="button" class="btn btn-light btn-ghost text-sm w-full" onclick={walkToDesk}>
            🚶 Walk to desk
        </button>
        {#if quickReplyState === "sent"}
            <span class="text-sm opacity-70 flex items-center justify-center">Sent ✓</span>
        {:else}
            <button
                type="button"
                class="btn btn-light btn-ghost text-sm w-full"
                onclick={sendWillBeThere}
                disabled={quickReplyState === "sending"}
            >
                Be there soon
            </button>
        {/if}
        <button
            type="button"
            class="btn btn-light btn-ghost text-sm w-full col-span-2"
            onclick={() => toastStore.removeToast(toastUuid)}
        >
            {$LL.chat.socialSignal.dismiss()}
        </button>
        {#if messageUnavailable}
            <span class="text-xs opacity-70 col-span-2 text-center">Can't message - unavailable</span>
        {/if}
        {#if walkUnavailable}
            <span class="text-xs opacity-70 col-span-2 text-center">Can't walk there - unavailable</span>
        {/if}
        {#if quickReplyState === "failed"}
            <span class="text-xs opacity-70 col-span-2 text-center">Failed to send</span>
        {/if}
    {/snippet}
</ToastContainer>
