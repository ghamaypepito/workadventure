import { createHash } from "crypto";
import { describe, expect, it, vi, afterEach } from "vitest";
import { validateGuestAccess } from "../../src/pusher/services/GuestAccess";
const id = "a".repeat(32),
    token = "b".repeat(64),
    pass = `${id}.${token}`;
const visit = {
    tokenHash: createHash("sha256").update(token).digest("hex"),
    status: "approved",
    expiresAt: Date.now() + 60000,
};
describe("guest access enforcement", () => {
    it("rejects missing and forged passes", async () => {
        expect(await validateGuestAccess(undefined, () => Promise.resolve(JSON.stringify(visit)))).toBe(false);
        expect(await validateGuestAccess(`${id}.${"c".repeat(64)}`, () => Promise.resolve(JSON.stringify(visit)))).toBe(
            false,
        );
    });
    it("admits approved visits only", async () => {
        expect(await validateGuestAccess(pass, () => Promise.resolve(JSON.stringify(visit)))).toBe(true);
    });
    it.each(["pending", "declined", "removed"])("rejects %s visits", async (status) => {
        expect(await validateGuestAccess(pass, () => Promise.resolve(JSON.stringify({ ...visit, status })))).toBe(
            false,
        );
    });
    it("rejects expired or missing visits", async () => {
        expect(await validateGuestAccess(pass, () => Promise.resolve(null))).toBe(false);
        expect(await validateGuestAccess(pass, () => Promise.resolve(JSON.stringify({ ...visit, expiresAt: 0 })))).toBe(
            false,
        );
    });
    it("requires a current signed-in session for member passes", async () => {
        const member = () => Promise.resolve(JSON.stringify({ ...visit, kind: "member", email: "host@example.com", sessionId: "current" }));
        expect(await validateGuestAccess(pass, member, () => Promise.resolve("current"))).toBe(true);
        expect(await validateGuestAccess(pass, member, () => Promise.resolve("old"))).toBe(false);
        expect(await validateGuestAccess(pass, member)).toBe(false);
    });
    it("does not treat unavailable storage as admission", async () => {
        await expect(validateGuestAccess(pass, () => Promise.reject(new Error("offline")))).rejects.toThrow("offline");
    });
});

import { startGuestAccessWatch, isGuestRoom } from "../../src/pusher/services/GuestAccess";
afterEach(() => vi.useRealTimers());
describe("visit removal watcher", () => {
    it("terminates once when admission is revoked", async () => {
        vi.useFakeTimers();
        const terminate = vi.fn();
        const stop = startGuestAccessWatch(() => Promise.resolve(false), terminate);
        await vi.advanceTimersByTimeAsync(15000);
        expect(terminate).toHaveBeenCalledTimes(1);
        stop();
    });
    it("does not terminate after cleanup while validation is in flight", async () => {
        vi.useFakeTimers();
        let finish: (allowed: boolean) => void = () => {};
        const terminate = vi.fn();
        const stop = startGuestAccessWatch(
            () =>
                new Promise<boolean>((resolve) => {
                    finish = resolve;
                }),
            terminate,
        );
        await vi.advanceTimersByTimeAsync(5000);
        stop();
        finish(false);
        await Promise.resolve();
        expect(terminate).not.toHaveBeenCalled();
    });
    it("protects alternate paths and query strings on the office host", () => {
        expect(isGuestRoom("https://office.example/~/old/map.wam?x=1", "https://office.example/~/new/map.wam")).toBe(
            true,
        );
        expect(isGuestRoom("https://another.example/~/new/map.wam", "https://office.example/~/new/map.wam")).toBe(
            false,
        );
    });
});
