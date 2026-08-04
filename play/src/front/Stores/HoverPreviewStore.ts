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
export const hoverPreviewStore = writable<HoverPreviewData | undefined>(undefined);
