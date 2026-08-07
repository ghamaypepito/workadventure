import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { admissionRequestStore as AdmissionRequestStoreType } from "./AdmissionRequestStore";

const { addToastMock, removeToastMock } = vi.hoisted(() => {
    return {
        addToastMock: vi.fn(),
        removeToastMock: vi.fn(),
    };
});

vi.mock("./ToastStoreSingleton", () => ({
    toastStore: {
        addToast: addToastMock,
        removeToast: removeToastMock,
    },
}));

vi.mock("../Components/Admission/AdmissionRequestToast.svelte", () => ({
    default: "AdmissionRequestToastComponent",
}));

describe("admissionRequestStore", () => {
    let admissionRequestStore: typeof AdmissionRequestStoreType;

    beforeEach(async () => {
        vi.useFakeTimers();
        addToastMock.mockClear();
        removeToastMock.mockClear();
        globalThis.fetch = vi.fn();

        // Each test gets a fresh module instance so the module-level `stoppedPermanently` and
        // `pollTimer` state from one test can never leak into the next - without this, a 401 in
        // one test would permanently silence polling in a later test, since that flag is (by
        // design, see AdmissionRequestStore.ts) never reset by the public API.
        vi.resetModules();
        ({ admissionRequestStore } = await import("./AdmissionRequestStore"));
    });

    afterEach(() => {
        admissionRequestStore.stopPolling();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("adds a toast for each pending request returned by the first poll", async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            status: 200,
            ok: true,
            json: () =>
                Promise.resolve({
                    requests: [{ requestId: "req-1", name: "Guest One", ts: 1000 }],
                }),
        });

        admissionRequestStore.startPolling();
        await vi.waitFor(() => expect(addToastMock).toHaveBeenCalledTimes(1));

        expect(addToastMock).toHaveBeenCalledWith(
            "AdmissionRequestToastComponent",
            { requestId: "req-1", name: "Guest One", receivedAt: 1000, toastUuid: "req-1" },
            "req-1",
        );
    });

    it("stops polling permanently once it receives a 401", async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            status: 401,
            ok: false,
            json: () => Promise.resolve({ error: "Not signed in" }),
        });

        admissionRequestStore.startPolling();
        await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));

        await vi.advanceTimersByTimeAsync(20_000);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);

        // The stop must survive a stopPolling() -> startPolling() cycle (this is exactly what
        // Task 5 wires into scene cleanup / next room-join), not just hold within one session.
        admissionRequestStore.stopPolling();
        admissionRequestStore.startPolling();
        await vi.advanceTimersByTimeAsync(20_000);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("does not add a second toast for the same requestId on a later poll", async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
            status: 200,
            ok: true,
            json: () =>
                Promise.resolve({
                    requests: [{ requestId: "req-1", name: "Guest One", ts: 1000 }],
                }),
        });

        admissionRequestStore.startPolling();
        await vi.waitFor(() => expect(addToastMock).toHaveBeenCalledTimes(1));

        await vi.advanceTimersByTimeAsync(5000);
        await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));

        // Called again (idempotent overwrite, not a duplicate toast) - the store doesn't dedupe
        // itself, it relies on addToast's own keyed-map semantics, so this asserts it was called
        // with the exact same key both times rather than asserting a call count of 1.
        expect(addToastMock).toHaveBeenNthCalledWith(
            2,
            "AdmissionRequestToastComponent",
            { requestId: "req-1", name: "Guest One", receivedAt: 1000, toastUuid: "req-1" },
            "req-1",
        );
    });

    it("does not create a toast or schedule another poll when stopPolling() is called while a poll is in flight", async () => {
        let resolveFetch: (value: unknown) => void = () => {
            throw new Error("resolveFetch was not assigned");
        };
        const pendingFetch = new Promise((resolve) => {
            resolveFetch = resolve;
        });
        globalThis.fetch = vi.fn(() => pendingFetch) as unknown as typeof fetch;

        admissionRequestStore.startPolling();
        await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));

        // Stop while the fetch triggered by startPolling() is still in flight.
        admissionRequestStore.stopPolling();

        resolveFetch({
            status: 200,
            ok: true,
            json: () =>
                Promise.resolve({
                    requests: [{ requestId: "req-1", name: "Guest One", ts: 1000 }],
                }),
        });

        // Let the (stale) in-flight response's promise chain settle.
        await vi.advanceTimersByTimeAsync(0);
        await vi.advanceTimersByTimeAsync(0);

        expect(addToastMock).not.toHaveBeenCalled();

        // No new poll should have been scheduled by the stale continuation either.
        await vi.advanceTimersByTimeAsync(20_000);
        expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("removes the toast for a requestId that was present on the previous poll but is absent from the next", async () => {
        (globalThis.fetch as ReturnType<typeof vi.fn>)
            .mockResolvedValueOnce({
                status: 200,
                ok: true,
                json: () =>
                    Promise.resolve({
                        requests: [{ requestId: "req-1", name: "Guest One", ts: 1000 }],
                    }),
            })
            .mockResolvedValue({
                status: 200,
                ok: true,
                json: () => Promise.resolve({ requests: [] }),
            });

        admissionRequestStore.startPolling();
        await vi.waitFor(() => expect(addToastMock).toHaveBeenCalledTimes(1));

        await vi.advanceTimersByTimeAsync(5000);
        await vi.waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(2));

        expect(removeToastMock).toHaveBeenCalledWith("req-1");
    });
});
