/**
 * Formats the gap between two timestamps (ms since epoch) as a short relative
 * label, matching the "X waved to you - 2m ago" style used on the wave/ping
 * toasts. `nowMs` is a parameter (not Date.now()) so this stays a pure,
 * unit-testable function - callers pass the current time in.
 */
export function formatRelativeTime(fromMs: number, nowMs: number): string {
    const diffMs = Math.max(0, nowMs - fromMs);
    const diffMinutes = Math.floor(diffMs / 60_000);

    if (diffMinutes < 1) {
        return "Just now";
    }
    if (diffMinutes < 60) {
        return `${diffMinutes}m ago`;
    }
    const diffHours = Math.floor(diffMinutes / 60);
    return `${diffHours}h ago`;
}
