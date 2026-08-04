import { describe, expect, it, vi } from "vitest";
import { ActiveSessionCoordinator } from "../src/Services/ActiveSessionCoordinator";

describe("ActiveSessionCoordinator", () => {
    it("marks a second browser as duplicate and disconnects the old browser on takeover", async () => {
        const coordinator = new ActiveSessionCoordinator();
        const disconnectFirst = vi.fn();
        const disconnectSecond = vi.fn();

        expect(
            await coordinator.register({
                sessionId: "first",
                userUuid: "alice",
                tabId: "tab-a",
                disconnect: disconnectFirst,
            }),
        ).toEqual({ duplicate: false });
        expect(
            await coordinator.register({
                sessionId: "second",
                userUuid: "alice",
                tabId: "tab-b",
                disconnect: disconnectSecond,
            }),
        ).toEqual({ duplicate: true });

        await coordinator.takeOver("second");

        expect(disconnectFirst).toHaveBeenCalledWith(true);
        expect(disconnectSecond).not.toHaveBeenCalled();
    });

    it("silently replaces a stale connection from the same browser tab", async () => {
        const coordinator = new ActiveSessionCoordinator();
        const disconnectStale = vi.fn();

        await coordinator.register({
            sessionId: "stale",
            userUuid: "alice",
            tabId: "same-tab",
            disconnect: disconnectStale,
        });
        const registration = await coordinator.register({
            sessionId: "reconnected",
            userUuid: "alice",
            tabId: "same-tab",
            disconnect: vi.fn(),
        });

        expect(registration).toEqual({ duplicate: false });
        expect(disconnectStale).toHaveBeenCalledWith(false);
    });

    it("does not let an old disconnect clear ownership transferred to a new browser", async () => {
        const coordinator = new ActiveSessionCoordinator();
        await coordinator.register({ sessionId: "first", userUuid: "alice", disconnect: vi.fn() });
        await coordinator.register({ sessionId: "second", userUuid: "alice", disconnect: vi.fn() });
        await coordinator.takeOver("second");
        await coordinator.release("first");

        const third = await coordinator.register({ sessionId: "third", userUuid: "alice", disconnect: vi.fn() });
        expect(third).toEqual({ duplicate: true });
    });
});
