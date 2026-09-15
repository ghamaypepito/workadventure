import { randomUUID } from "crypto";
import { describe, expect, it, vi } from "vitest";
import { SpaceUser } from "@workadventure/messages";
import type { ICommunicationSpace } from "../src/Model/Interfaces/ICommunicationSpace";
import { LivekitCommunicationStrategy } from "../src/Model/Strategies/LivekitCommunicationStrategy";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

function setup() {
    const name = randomUUID();
    const users = new Map<string, SpaceUser>();
    const space: ICommunicationSpace = {
        getAllUsers: () => [...users.values()],
        getUsersInFilter: () => [...users.values()],
        getUsersToNotify: () => [],
        getRecordingState: () => ({ isRecording: false, recorder: null, status: "idle" }),
        dispatchPrivateEvent: vi.fn(),
        dispatchPublicEvent: vi.fn(),
        getSpaceName: () => name,
        getPropertiesToSync: () => [],
        publishMetadata: vi.fn(),
        stopRecordingByServer: vi.fn().mockResolvedValue(undefined),
        getUser: (id) => users.get(id),
    };
    let roomExists = false;
    const service = {
        createRoom: vi.fn(() => {
            roomExists = true;
            return Promise.resolve();
        }),
        deleteRoom: vi.fn(() => {
            roomExists = false;
            return Promise.resolve();
        }),
        generateToken: vi.fn(() => Promise.resolve("test-token")),
        getLivekitFrontendUrl: () => "wss://test.invalid",
    };
    const strategy = new LivekitCommunicationStrategy(space, service as never);
    const user = (id: string) => {
        const value = SpaceUser.fromPartial({ spaceUserId: id });
        users.set(id, value);
        return value;
    };
    return { strategy, space, service, user, users, roomExists: () => roomExists };
}

describe("LiveKit room lifetime regressions", () => {
    it("does not delete a room when another publisher joins during recording cleanup", async () => {
        const f = setup();
        const stop = deferred();
        vi.mocked(f.space.stopRecordingByServer).mockReturnValue(stop.promise);
        const a = f.user("a");
        await f.strategy.addUser(a);
        f.strategy.deleteUser(a);
        await vi.waitFor(() => expect(f.space.stopRecordingByServer).toHaveBeenCalled());
        await f.strategy.addUser(f.user("b"));
        stop.resolve();
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
        expect(f.roomExists()).toBe(true);
        expect(f.service.deleteRoom).not.toHaveBeenCalled();
        f.strategy.cleanup();
    });
    it("does not allow delayed retired cleanup to delete a replacement strategy's room", async () => {
        const f = setup();
        const stop = deferred();
        vi.mocked(f.space.stopRecordingByServer).mockReturnValue(stop.promise);
        const a = f.user("a");
        await f.strategy.addUser(a);
        f.strategy.deleteUser(a);
        await vi.waitFor(() => expect(f.space.stopRecordingByServer).toHaveBeenCalled());
        f.strategy.cleanup();
        const replacement = new LivekitCommunicationStrategy(f.space, f.service as never);
        await replacement.addUser(f.user("b"));
        stop.resolve();
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
        expect(f.roomExists()).toBe(true);
        replacement.cleanup();
    });
    it("waits for an in-flight deletion before inviting a new publisher", async () => {
        const f = setup();
        const deletion = deferred();
        f.service.deleteRoom.mockImplementationOnce(async () => {
            await deletion.promise;
        });
        const a = f.user("a");
        await f.strategy.addUser(a);
        f.strategy.deleteUser(a);
        await vi.waitFor(() => expect(f.service.deleteRoom).toHaveBeenCalled());
        vi.mocked(f.space.dispatchPrivateEvent).mockClear();
        const joining = f.strategy.addUser(f.user("b"));
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
        expect(f.space.dispatchPrivateEvent).not.toHaveBeenCalled();
        deletion.resolve();
        await joining;
        expect(f.service.createRoom).toHaveBeenCalledTimes(2);
        expect(f.space.dispatchPrivateEvent).toHaveBeenCalled();
        f.strategy.cleanup();
    });
    it("does not invite a departed user after token generation completes", async () => {
        const f = setup();
        const token = deferred();
        f.service.generateToken.mockImplementationOnce(async () => {
            await token.promise;
            return "test-token";
        });
        const a = f.user("a");
        const joining = f.strategy.addUser(a);
        await vi.waitFor(() => expect(f.service.generateToken).toHaveBeenCalled());
        f.users.delete("a");
        f.strategy.deleteUser(a);
        token.resolve();
        await joining;
        const invitations = vi
            .mocked(f.space.dispatchPrivateEvent)
            .mock.calls.filter(([e]) => e.spaceEvent?.event?.$case === "livekitInvitationMessage");
        expect(invitations).toHaveLength(0);
        f.strategy.cleanup();
    });
    it("does not send a token generated by a retired strategy", async () => {
        const f = setup();
        const token = deferred();
        f.service.generateToken.mockImplementationOnce(async () => {
            await token.promise;
            return "old-token";
        });
        const joining = f.strategy.addUser(f.user("a"));
        await vi.waitFor(() => expect(f.service.generateToken).toHaveBeenCalled());
        f.strategy.cleanup();
        const replacement = new LivekitCommunicationStrategy(f.space, f.service as never);
        await replacement.addUser(f.user("a"));
        token.resolve();
        await joining;
        const tokens = vi
            .mocked(f.space.dispatchPrivateEvent)
            .mock.calls.flatMap(([e]) =>
                e.spaceEvent?.event?.$case === "livekitInvitationMessage"
                    ? [e.spaceEvent.event.livekitInvitationMessage.token]
                    : [],
            );
        expect(tokens).toEqual(["test-token"]);
        replacement.cleanup();
    });

    it("refreshes the invitation when a reconnecting user is both publisher and receiver", async () => {
        const f = setup();
        const a = f.user("a");
        await f.strategy.addUser(a);
        await f.strategy.addUserToNotify(a);
        vi.mocked(f.space.dispatchPrivateEvent).mockClear();
        await f.strategy.addUser(a);
        const invitations = vi
            .mocked(f.space.dispatchPrivateEvent)
            .mock.calls.filter(
                ([event]) =>
                    event.receiverUserId === "a" && event.spaceEvent?.event?.$case === "livekitInvitationMessage",
            );
        expect(invitations).toHaveLength(1);
        f.strategy.cleanup();
    });
    it("rejects a recovery request from a user without current call membership", async () => {
        const f = setup();
        f.user("a");
        f.strategy.handleMeetingConnectionRestartMessage({}, "a");
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
        expect(f.service.generateToken).not.toHaveBeenCalled();
        f.strategy.cleanup();
    });

    it("cleans up only once even when finalize is repeated", async () => {
        const f = setup();
        await f.strategy.addUser(f.user("a"));
        f.strategy.cleanup();
        f.strategy.cleanup();
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
        expect(f.service.deleteRoom).toHaveBeenCalledTimes(1);
        expect(f.roomExists()).toBe(false);
    });
});
