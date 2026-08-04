import { writable } from "svelte/store";

export type DuplicateSessionState = "none" | "duplicate" | "switching" | "moved" | "kept-other";
export const SESSION_TAKEOVER_ON_RECONNECT_KEY = "workadventure_session_takeover_on_reconnect";

/**
 * Set to true when the back sends duplicateUserConnectedMessage (same user already connected elsewhere).
 * The UI should show a popup. Not shown if user previously chose "don't remind again" (localStorage).
 */
function createDuplicateUserConnectedStore() {
    const { subscribe, set } = writable<DuplicateSessionState>("none");

    return {
        subscribe,
        setDuplicateConnected: (value: boolean): void => {
            set(value ? "duplicate" : "none");
        },
        setSwitching: (): void => set("switching"),
        setSessionMoved: (): void => set("moved"),
        setKeptOther: (): void => set("kept-other"),
    };
}

export const duplicateUserConnectedStore = createDuplicateUserConnectedStore();
