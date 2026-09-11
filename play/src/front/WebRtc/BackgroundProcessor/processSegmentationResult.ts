import type { ImageSegmenterResult, MPMask } from "@mediapipe/tasks-vision";

/** The result owns every mask, including masks not used by the renderer. */
export function processSegmentationResult(result: ImageSegmenterResult, render: (mask: MPMask) => void): void {
    try {
        const mask = result.confidenceMasks?.[0];
        if (mask) render(mask);
    } finally {
        result.close();
    }
}
