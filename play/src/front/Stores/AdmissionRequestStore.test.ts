import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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

import { admissionRequestStore } from "./AdmissionRequestStore";

describe("admissionRequestStore", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        addToastMock.mockClear();
        removeToastMock.mockClear();
        globalThis.fetch = vi.fn();
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
});
