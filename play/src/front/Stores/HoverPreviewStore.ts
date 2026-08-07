import { writable } from "svelte/store";
import type { AvailabilityStatus } from "@workadventure/messages";

export interface HoverPreviewData {
    userId: number;
    userUuid: string;
    name: string;
    availabilityStatus: AvailabilityStatus;
    customStatusMessage?: string;
    screenX: number;
    screenY: number;
}

/**
 * Backs the compact hover-preview popup (name + status + Wave/Message), shown ~300ms after the
 * cursor rests on a remote player's character. Deliberately a separate store from
 * wokaMenuStore - clicking always takes precedence and clears this one (see RemotePlayer.ts's
 * toggleActionsMenu), so the two popups never fight over the same state.
 */
function createHoverPreviewStore() {
    const { subscribe, set, update } = writable<HoverPreviewData | undefined>(undefined);

    // The card renders as a `position: fixed` DOM overlay floating above the player's sprite, not
    // over it - so moving the cursor from the sprite to the card is, from Phaser's per-object hit
    // test, a genuine POINTER_OUT for that sprite well before the cursor reaches the card. Clearing
    // immediately on POINTER_OUT means the card unmounts mid-transit, and every click on it (Wave,
    // Message, Locate, Join my desk) lands on nothing. clearTimer holds a grace period instead,
    // giving the cursor time to land on the card (which cancels it via cancelClear()) or on the
    // sprite again (POINTER_OVER also cancels it).
    let clearTimer: ReturnType<typeof setTimeout> | undefined;
    const CLEAR_GRACE_MS = 250;

    return {
        subscribe,
        set: (data: HoverPreviewData | undefined) => {
            if (clearTimer) {
                clearTimeout(clearTimer);
                clearTimer = undefined;
            }
            set(data);
        },
        update,
        scheduleClear: (userId: number) => {
            if (clearTimer) clearTimeout(clearTimer);
            clearTimer = setTimeout(() => {
                clearTimer = undefined;
                update((current) => (current?.userId === userId ? undefined : current));
            }, CLEAR_GRACE_MS);
        },
        cancelClear: () => {
            if (clearTimer) {
                clearTimeout(clearTimer);
                clearTimer = undefined;
            }
        },
    };
}

export const hoverPreviewStore = createHoverPreviewStore();
