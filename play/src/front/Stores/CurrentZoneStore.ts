import { writable } from "svelte/store";

/**
 * Tracks the name of the Tiled "zone" the local player is currently in (per the
 * GameMapProperties.ZONE map property), for display in the persistent top bar. Updated
 * alongside the existing iframeListener enter/leave event dispatch in
 * GameMapPropertiesListener.ts, which is the one place in the main game frame that already
 * knows this value - not derived independently, to avoid a second source of truth.
 */
export const currentZoneNameStore = writable<string | undefined>(undefined);
