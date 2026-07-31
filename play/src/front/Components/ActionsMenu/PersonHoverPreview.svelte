<script lang="ts">
    import { hoverPreviewStore } from "../../Stores/HoverPreviewStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { openDirectChatRoom } from "../../Chat/Utils";
    import { getColorHexOfStatus, getStatusLabel } from "../../Utils/AvailabilityStatus";
    import LL from "../../../i18n/i18n-svelte";

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
            <button type="button" class="btn btn-light btn-ghost text-xs flex-1" onclick={wave}
                >👋 {$LL.chat.socialSignal.wave()}</button
            >
            <button type="button" class="btn btn-light btn-ghost text-xs flex-1" onclick={message}
                >{$LL.chat.userList.sendMessage()}</button
            >
        </div>
    </div>
{/if}
