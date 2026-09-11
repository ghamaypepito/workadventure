import { expect, it } from "vitest";
import { videoTimestamp } from "./videoTimestamp";

it("keeps four-hour session timestamps in milliseconds", () => {
    expect(videoTimestamp(14_400_000, 0)).toBe(14_400_000);
});
it("advances at least one millisecond when the clock repeats", () => {
    expect(videoTimestamp(100.1, 100)).toBe(101);
});
