import { describe, expect, it, vi } from "vitest";
import { ImageSegmenterResult } from "@mediapipe/tasks-vision";
import type { MPMask } from "@mediapipe/tasks-vision";
import { processSegmentationResult } from "./processSegmentationResult";

describe("segmentation resource cleanup", () => {
    it.each([false, true])("releases every mask when rendering throws: %s", (throws) => {
        const masks = [vi.fn(), vi.fn(), vi.fn()];
        const result = new ImageSegmenterResult(
            masks.slice(0, 2).map((close) => ({ close }) as unknown as MPMask),
            { close: masks[2] } as unknown as MPMask,
        );
        const render = () => {
            if (throws) throw new Error("drawing failed");
        };
        if (throws) {
            expect(() => processSegmentationResult(result, render)).toThrow("drawing failed");
        } else {
            processSegmentationResult(result, render);
        }
        for (const close of masks) expect(close).toHaveBeenCalledOnce();
    });
});
