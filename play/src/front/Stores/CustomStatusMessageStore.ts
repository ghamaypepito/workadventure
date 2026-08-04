import { writable } from "svelte/store";
import { localUserStore } from "../Connection/LocalUserStore";
import { gameManager } from "../Phaser/Game/GameManager";

/**
 * Custom status text (e.g. "In a client call"), shown next to the user's own name in the profile
 * menu button, and broadcast to other players so it also shows in their hover preview of this
 * user (see SetPlayerDetailsMessage.customStatusMessage / PersonHoverPreview.svelte). Distinct
 * from the built-in Online/Busy/Back in a moment/DND enum status, which is unaffected by this.
 */
function createCustomStatusMessageStore() {
    const { subscribe, set } = writable<string>(localUserStore.getCustomStatusMessage());

    return {
        subscribe,
        set: (message: string) => {
            const trimmed = message.trim();
            localUserStore.setCustomStatusMessage(trimmed);
            set(trimmed);
            try {
                gameManager.getCurrentGameScene().connection?.emitPlayerCustomStatusMessage(trimmed);
            } catch (error) {
                // Game scene not ready yet (e.g. set before the game loaded) - the value is still
                // persisted above and will go out via the initial-join broadcast in GameScene.ts.
                console.warn("Could not broadcast custom status message yet:", error);
            }
        },
    };
}

export const customStatusMessageStore = createCustomStatusMessageStore();
