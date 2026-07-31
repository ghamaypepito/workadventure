import { describe, expect, it } from "vitest";
import { formatRelativeTime } from "./RelativeTime";

describe("formatRelativeTime", () => {
    it("returns 'Just now' for under 60 seconds", () => {
        expect(formatRelativeTime(1000, 1000)).toBe("Just now");
        expect(formatRelativeTime(1000, 1000 + 59_000)).toBe("Just now");
    });

    it("returns minutes for 1 to 59 minutes", () => {
        expect(formatRelativeTime(0, 60_000)).toBe("1m ago");
        expect(formatRelativeTime(0, 59 * 60_000)).toBe("59m ago");
    });

    it("returns hours for 1 hour or more", () => {
        expect(formatRelativeTime(0, 60 * 60_000)).toBe("1h ago");
        expect(formatRelativeTime(0, 3 * 60 * 60_000 + 10_000)).toBe("3h ago");
    });

    it("never returns a negative duration (clock skew safety)", () => {
        expect(formatRelativeTime(1000, 900)).toBe("Just now");
    });
});
