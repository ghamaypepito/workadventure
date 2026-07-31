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
        <button type="button" class="btn btn-light btn-ghost text-sm" onclick={waveBack}> 👋 Wave back </button>
        <button type="button" class="btn btn-light btn-ghost text-sm" onclick={message}> Message </button>
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
