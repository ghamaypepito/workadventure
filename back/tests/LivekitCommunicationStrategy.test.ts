import { describe, expect, it, vi } from "vitest";
import { SpaceUser } from "@workadventure/messages";
import { LivekitCommunicationStrategy } from "../src/Model/Strategies/LivekitCommunicationStrategy";
import type { ICommunicationSpace } from "../src/Model/Interfaces/ICommunicationSpace";

function createUser(spaceUserId: string): SpaceUser {
    return SpaceUser.fromPartial({
        spaceUserId,
        uuid: `uuid-${spaceUserId}`,
        name: spaceUserId,
    });
}

describe("LivekitCommunicationStrategy", () => {
    it("stops recording through the server path when the last streaming user leaves",async () => {
        const dispatchPrivateEvent = vi.fn();
        const stopRecordingByServer = vi.fn().mockResolvedValue(undefined);

        const space: ICommunicationSpace = {
            getAllUsers: () => [],
            getUsersInFilter: () => [],
            getUsersToNotify: () => [],
            getRecordingState: () => ({ isRecording: true, recorder: "recorder-1", status: "recording" }),
            dispatchPrivateEvent,
            dispatchPublicEvent: vi.fn(),
            getSpaceName: () => "test-space",
            getPropertiesToSync: () => [],
            publishMetadata: vi.fn(),
            stopRecordingByServer,
            getUser: vi.fn(),
        };

        const livekitService = {
            deleteRoom: vi.fn().mockResolvedValue(undefined),
        };

        const strategy = new LivekitCommunicationStrategy(space, livekitService as never);
        const streamer = createUser("streamer-1");
        const receiver = createUser("listener-1");

        (
            strategy as unknown as {
                streamingUsers: Map<string, SpaceUser>;
                receivingUsers: Map<string, SpaceUser>;
            }
        ).streamingUsers.set(streamer.spaceUserId, streamer);
        (
            strategy as unknown as {
                streamingUsers: Map<string, SpaceUser>;
                receivingUsers: Map<string, SpaceUser>;
            }
        ).receivingUsers.set(receiver.spaceUserId, receiver);

        strategy.deleteUser(streamer);

        await vi.waitFor(() => {
            expect(stopRecordingByServer).toHaveBeenCalled();
            expect(livekitService.deleteRoom).toHaveBeenCalledWith("test-space");
        });
    });

    it("keeps recording running while another streaming user remains", async () => {
        const space: ICommunicationSpace = {
            getAllUsers: () => [],
            getUsersInFilter: () => [],
            getUsersToNotify: () => [],
            getRecordingState: () => ({ isRecording: true, recorder: "recorder-1", status: "recording" }),
            dispatchPrivateEvent: vi.fn(),
            dispatchPublicEvent: vi.fn(),
            getSpaceName: () => "test-space",
            getPropertiesToSync: () => [],
            publishMetadata: vi.fn(),
            stopRecordingByServer: vi.fn().mockResolvedValue(undefined),
            getUser: vi.fn(),
        };

        const livekitService = {
            deleteRoom: vi.fn().mockResolvedValue(undefined),
        };

        const strategy = new LivekitCommunicationStrategy(space, livekitService as never);
        const firstStreamer = createUser("streamer-1");
        const secondStreamer = createUser("streamer-2");

        (
            strategy as unknown as {
                streamingUsers: Map<string, SpaceUser>;
            }
        ).streamingUsers.set(firstStreamer.spaceUserId, firstStreamer);
        (
            strategy as unknown as {
                streamingUsers: Map<string, SpaceUser>;
            }
        ).streamingUsers.set(secondStreamer.spaceUserId, secondStreamer);

        strategy.deleteUser(firstStreamer);

        await vi.waitFor(() => {
            expect(
                (
                    strategy as unknown as {
                        streamingUsers: Map<string, SpaceUser>;
                    }
                ).streamingUsers.has(secondStreamer.spaceUserId)
            ).toBe(true);
        });

        expect(space.stopRecordingByServer).not.toHaveBeenCalled();
        expect(livekitService.deleteRoom).not.toHaveBeenCalled();
    });

    it("re-sends a fresh invitation when a user re-registers as receiving without an intervening removal", async () => {
        const dispatchPrivateEvent = vi.fn();

        const space: ICommunicationSpace = {
            getAllUsers: () => [],
            getUsersInFilter: () => [],
            getUsersToNotify: () => [],
            getRecordingState: () => ({ isRecording: false, recorder: null, status: "idle" }),
            dispatchPrivateEvent,
            dispatchPublicEvent: vi.fn(),
            getSpaceName: () => "test-space",
            getPropertiesToSync: () => [],
            publishMetadata: vi.fn(),
            stopRecordingByServer: vi.fn().mockResolvedValue(undefined),
            getUser: vi.fn(),
        };

        const livekitService = {
            generateToken: vi.fn().mockResolvedValue("token"),
            getLivekitFrontendUrl: vi.fn().mockReturnValue("wss://livekit.example.com"),
        };

        const strategy = new LivekitCommunicationStrategy(space, livekitService as never);
        // Simulate the room already being created (as if some other user is streaming) so
        // addUserToNotify() takes the "send invitation" branch instead of returning early.
        (strategy as unknown as { createRoomPromise: Promise<void> }).createRoomPromise = Promise.resolve();

        const watcher = createUser("watcher-1");

        // First registration - a normal join/proximity-enter.
        await strategy.addUserToNotify(watcher);

        // Second registration for the SAME spaceUserId with no deleteUserFromNotify in
        // between - mirrors a reconnect where the server hasn't yet observed the old
        // connection drop. Previously this hit the "already receiving" guard and returned
        // without sending anything, leaving a reconnecting client with no fresh token -
        // audio would never resume. It must now refresh the registration instead.
        await strategy.addUserToNotify(watcher);

        expect(livekitService.generateToken).toHaveBeenCalledTimes(2);
        const invitationCalls = dispatchPrivateEvent.mock.calls.filter(
            ([event]) => event.spaceEvent?.event?.$case === "livekitInvitationMessage",
        );
        expect(invitationCalls).toHaveLength(2);
    });
});
