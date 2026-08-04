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

    function resolveChatID(): string | undefined {
        return gameManager
            .getCurrentGameScene()
            .getRemotePlayersRepository()
            .getPlayerByUuid(senderUserUuid)?.chatID;
    }

    function pingBack() {
        const scene = gameManager.getCurrentGameScene();
        // requestSocialSignal already logs this into the real direct-message conversation with
        // this person (see InviteManager.ts) - no need to do it again here.
        scene.inviteManager?.requestSocialSignal("ping", senderUserUuid, actorName, senderUserId);
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
    🔔 {$LL.chat.socialSignal.wantsToTalk({ name: actorName })}
    {#snippet buttons()}
        <button type="button" class="btn btn-light btn-ghost text-sm" onclick={pingBack}> 🔔 Ping back </button>
        <button type="button" class="btn btn-light btn-ghost text-sm" onclick={message}> Message </button>
        {#if messageUnavailable}
            <span class="text-sm opacity-70">Can't message - unavailable</span>
        {/if}
        {#if quickReplyState === "sent"}
            <span class="text-sm opacity-70">Sent ✓</span>
        {:else}
            <button
                type="button"
                class="btn btn-light btn-ghost text-sm"
                onclick={sendWillBeThere}
                disabled={quickReplyState === "sending"}
            >
                Will be there in a while
            </button>
            {#if quickReplyState === "failed"}
                <span class="text-sm opacity-70">Failed to send</span>
            {/if}
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
