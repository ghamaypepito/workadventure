import { writable } from "svelte/store";

/**
 * Toggles between the normal map view and a full-screen "Meeting view" showing only the
 * video/audio streams of whoever is currently in proximity with you, in a grid layout (reusing
 * CamerasContainer, the same grid the floating call strip already uses). The map/game canvas is
 * covered (not destroyed) while this is active - see MainLayout.svelte.
 */
export const meetingViewStore = writable(false);
