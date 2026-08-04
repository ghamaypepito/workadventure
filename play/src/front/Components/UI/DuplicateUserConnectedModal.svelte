<script lang="ts">
    import {
        duplicateUserConnectedStore,
        SESSION_TAKEOVER_ON_RECONNECT_KEY,
    } from "../../Stores/DuplicateUserConnectedStore";
    import { LL } from "../../../i18n/i18n-svelte";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { IconLoader } from "@wa-icons";

    let errorMessage = $state("");

    async function switchToThisBrowser() {
        errorMessage = "";
        duplicateUserConnectedStore.setSwitching();
        try {
            const connection = gameManager.getCurrentGameScene().connection;
            if (!connection || !(await connection.takeOverSession())) {
                throw new Error("The office session could not be transferred.");
            }
            duplicateUserConnectedStore.setDuplicateConnected(false);
        } catch (error) {
            console.error("Failed to take over office session", error);
            errorMessage = $LL.warning.duplicateUserConnected.switchFailed();
            duplicateUserConnectedStore.setDuplicateConnected(true);
        }
    }

    function keepOtherBrowser() {
        gameManager.getCurrentGameScene().connection?.closeConnection();
        duplicateUserConnectedStore.setKeptOther();
    }

    function reconnectHere() {
        sessionStorage.setItem(SESSION_TAKEOVER_ON_RECONNECT_KEY, "1");
        window.location.reload();
    }
</script>

<div
    class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 p-4 backdrop-blur-lg"
    role="alertdialog"
    aria-labelledby="duplicate-user-title"
    aria-describedby="duplicate-user-message"
>
    <div class="w-full max-w-md rounded-2xl bg-contrast p-6 shadow-2xl" role="document">
        {#if $duplicateUserConnectedStore === "moved"}
            <h2 id="duplicate-user-title" class="text-xl font-bold text-white">
                {$LL.warning.duplicateUserConnected.movedTitle()}
            </h2>
            <p id="duplicate-user-message" class="mt-3 text-sm text-white/90">
                {$LL.warning.duplicateUserConnected.movedMessage()}
            </p>
            <button type="button" class="btn btn-secondary mt-6 w-full" onclick={reconnectHere}>
                {$LL.warning.duplicateUserConnected.switchBack()}
            </button>
        {:else if $duplicateUserConnectedStore === "kept-other"}
            <h2 id="duplicate-user-title" class="text-xl font-bold text-white">
                {$LL.warning.duplicateUserConnected.keptTitle()}
            </h2>
            <p id="duplicate-user-message" class="mt-3 text-sm text-white/90">
                {$LL.warning.duplicateUserConnected.keptMessage()}
            </p>
            <button type="button" class="btn btn-secondary mt-6 w-full" onclick={reconnectHere}>
                {$LL.warning.duplicateUserConnected.tryAgain()}
            </button>
        {:else}
            <h2 id="duplicate-user-title" class="text-xl font-bold text-white">
                {$LL.warning.duplicateUserConnected.title()}
            </h2>
            <p id="duplicate-user-message" class="mt-3 text-sm text-white/90">
                {$LL.warning.duplicateUserConnected.message()}
            </p>
            {#if errorMessage}
                <p class="mt-3 rounded-lg bg-red-500/15 p-3 text-sm text-red-200">{errorMessage}</p>
            {/if}
            <div class="mt-6 flex flex-col gap-3 sm:flex-row">
                <button
                    type="button"
                    class="btn btn-secondary flex-1"
                    onclick={keepOtherBrowser}
                    disabled={$duplicateUserConnectedStore === "switching"}
                    data-testid="duplicate-user-keep-other"
                >
                    {$LL.warning.duplicateUserConnected.keepOther()}
                </button>
                <button
                    type="button"
                    class="btn btn-primary flex flex-1 items-center justify-center gap-2"
                    onclick={switchToThisBrowser}
                    disabled={$duplicateUserConnectedStore === "switching"}
                    data-testid="duplicate-user-switch-here"
                >
                    {#if $duplicateUserConnectedStore === "switching"}
                        <IconLoader class="animate-spin" />
                        {$LL.warning.duplicateUserConnected.switching()}
                    {:else}
                        {$LL.warning.duplicateUserConnected.switchHere()}
                    {/if}
                </button>
            </div>
        {/if}
    </div>
</div>
