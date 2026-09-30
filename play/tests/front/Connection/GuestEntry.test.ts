import { afterEach, describe, expect, it, vi } from "vitest";
import {
    ensureGuestEntry,
    guestAdmissionScript,
    loadGuestAdmissionScript,
} from "../../../src/front/Connection/GuestEntry";
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    sessionStorage.clear();
    document.body.replaceChildren();
});
describe("entry before map connection", () => {
    it("loads host presence when scene startup precedes the admission check", async () => {
        let connected!: () => void;
        const ready = new Promise<void>((resolve) => {
            connected = resolve;
        });
        const register = vi.fn().mockResolvedValue(undefined);
        const loaded = loadGuestAdmissionScript(ready, [], register);
        await Promise.resolve();
        expect(register).not.toHaveBeenCalled();
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ enabled: true, member: true, pass: "member-pass" }),
            }),
        );
        await ensureGuestEntry("https://office.example/map", "Member");
        connected();
        await loaded;
        expect(register).toHaveBeenCalledExactlyOnceWith(guestAdmissionScript());
        await loadGuestAdmissionScript(ready, [guestAdmissionScript()!], register);
        expect(register).toHaveBeenCalledTimes(1);
    });
    it("does not prompt signed-in members", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                ok: true,
                json: () => Promise.resolve({ enabled: true, member: true, pass: "member-pass" }),
            }),
        );
        expect(await ensureGuestEntry("https://office.example/map", "Member")).toBe("member-pass");
        expect(document.querySelector("iframe")).toBeNull();
        expect(guestAdmissionScript()).toContain("/scripts/admission-script.html");
    });
    it("waits for approval and removes the entry screen", async () => {
        vi.useFakeTimers();
        let polls = 0;
        vi.stubGlobal(
            "fetch",
            vi.fn((_url, options) => {
                const body = JSON.parse(options.body);
                return Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve(
                            body.action === "access"
                                ? { enabled: true, member: false }
                                : body.action === "begin"
                                  ? { id: "visit", token: "token" }
                                  : { status: ++polls === 1 ? "pending" : "approved" },
                        ),
                });
            }),
        );
        const promise = ensureGuestEntry("https://office.example/map", "Guest");
        await vi.advanceTimersByTimeAsync(0);
        expect(document.querySelector("iframe")).not.toBeNull();
        await vi.advanceTimersByTimeAsync(3000);
        expect(await promise).toBe("visit.token");
        expect(document.querySelector("iframe")).toBeNull();
    });
    it("does not grant entry when the API fails", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
        await expect(ensureGuestEntry("https://office.example/map", "Guest")).rejects.toThrow("unavailable");
    });
});
