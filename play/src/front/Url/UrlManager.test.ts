import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { GameConnexionTypes, urlManager } from "./UrlManager";

function setPathname(pathname: string): void {
    window.history.pushState({}, "", pathname);
}

describe("UrlManager vanity invitation slugs", () => {
    const originalPathname = window.location.pathname;

    afterEach(() => {
        setPathname(originalPathname);
    });

    it("resolves a bare single-segment path to the vings-test room", () => {
        expect(urlManager.resolveRoomPath("/john")).toBe("/~/vings-test/map.wam");
        expect(urlManager.resolveRoomPath("/maria-sales")).toBe("/~/vings-test/map.wam");
    });

    it("leaves real room paths untouched", () => {
        expect(urlManager.resolveRoomPath("/~/vings-test/map.wam")).toBe("/~/vings-test/map.wam");
        expect(urlManager.resolveRoomPath("/_/global/some-room")).toBe("/_/global/some-room");
    });

    it("leaves reserved routes untouched", () => {
        expect(urlManager.resolveRoomPath("/login")).toBe("/login");
        expect(urlManager.resolveRoomPath("/jwt")).toBe("/jwt");
        expect(urlManager.resolveRoomPath("/api")).toBe("/api");
    });

    it("leaves multi-segment unknown paths untouched", () => {
        expect(urlManager.resolveRoomPath("/john/extra")).toBe("/john/extra");
    });

    it("classifies a vanity slug as a room connexion type", () => {
        setPathname("/john");
        expect(urlManager.getGameConnexionType()).toBe(GameConnexionTypes.room);
    });

    it("still classifies reserved routes correctly", () => {
        setPathname("/login");
        expect(urlManager.getGameConnexionType()).toBe(GameConnexionTypes.login);
    });
});
