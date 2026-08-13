import { describe, expect, it } from "vitest";
import { selectAV1Preset, selectVideoPreset } from "./VideoPresets";

describe("selectAV1Preset (screen share)", () => {
    it("caps screen-share framerate at 15fps to leave CPU headroom for a simultaneous camera encode", () => {
        expect(selectAV1Preset(1080, 1920, "recommended").fps).toBe(15);
        expect(selectAV1Preset(1080, 1920, "low").fps).toBe(15);
        expect(selectAV1Preset(1080, 1920, "high").fps).toBe(15);
    });
});

describe("selectVideoPreset", () => {
    it("routes screen share through the capped-fps AV1 preset", () => {
        expect(selectVideoPreset(1080, 1920, true, "recommended").fps).toBe(15);
    });
});
