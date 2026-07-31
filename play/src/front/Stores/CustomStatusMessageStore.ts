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
            const trimmed = message.trim();
            localUserStore.setCustomStatusMessage(trimmed);
            set(trimmed);
        },
    };
}

export const customStatusMessageStore = createCustomStatusMessageStore();
