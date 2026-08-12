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

    describe("surviving a full-page redirect (e.g. SSO)", () => {
        beforeEach(() => localStorage.clear());
        afterEach(() => localStorage.clear());

        it("remembers a vanity slug before navigating away, and restores it afterward", () => {
            setPathname("/john");
            urlManager.rememberVanitySlugBeforeNavigatingAway();

            // Simulate landing back after the SSO round trip, on the real room path.
            setPathname("/~/vings-test/map.wam");
            urlManager.restoreVanitySlugIfRemembered();

            expect(window.location.pathname).toBe("/john");
        });

        it("does nothing when the current path isn't a vanity slug", () => {
            setPathname("/~/vings-test/map.wam");
            urlManager.rememberVanitySlugBeforeNavigatingAway();

            setPathname("/~/vings-test/map.wam");
            urlManager.restoreVanitySlugIfRemembered();

            expect(window.location.pathname).toBe("/~/vings-test/map.wam");
        });

        it("only restores once", () => {
            setPathname("/john");
            urlManager.rememberVanitySlugBeforeNavigatingAway();

            setPathname("/~/vings-test/map.wam");
            urlManager.restoreVanitySlugIfRemembered();
            setPathname("/~/vings-test/map.wam");
            urlManager.restoreVanitySlugIfRemembered();

            expect(window.location.pathname).toBe("/~/vings-test/map.wam");
        });
    });
});
