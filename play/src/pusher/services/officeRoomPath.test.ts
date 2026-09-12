import { describe, expect, it } from "vitest";
import { officeMapStoragePath } from "./officeRoomPath";

describe("office map storage alias", () => {
    it("keeps the renamed office on the existing editable map", () => {
        expect(officeMapStoragePath("/~/virtual-workplace/map.wam")).toBe("vings-test/map.wam");
        expect(officeMapStoragePath("/~/vings-test/map.wam")).toBe("vings-test/map.wam");
    });
    it("preserves unrelated maps", () => {
        expect(officeMapStoragePath("/~/pxlcode-workplace/map.wam")).toBe("pxlcode-workplace/map.wam");
    });
});
