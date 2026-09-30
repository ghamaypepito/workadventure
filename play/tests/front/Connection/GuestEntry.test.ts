import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureGuestEntry, guestAdmissionScript } from "../../../src/front/Connection/GuestEntry";
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    sessionStorage.clear();
    document.body.replaceChildren();
});
describe("entry before map connection", () => {
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
