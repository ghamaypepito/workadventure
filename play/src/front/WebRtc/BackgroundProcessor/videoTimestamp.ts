/** Monotonic timestamp in milliseconds for the MediaPipe JavaScript API. */
export function videoTimestamp(now: number, previous: number): number {
    return Math.max(Math.floor(now), previous + 1);
}
