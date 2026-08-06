import { describe, expect, it, vi } from "vitest";
// CommunicationManager must be imported before WebRTCState: these modules form a circular
// import (AbstractCommunicationState -> CommunicationManager -> WebRTCState/LivekitState ->
// AbstractCommunicationState), and importing CommunicationManager first is what every other
// test file in this suite does to make sure the cycle resolves in a working order.
import "../src/Model/CommunicationManager";
import type { SpaceUser } from "@workadventure/messages";
import { WebRTCState } from "../src/Model/States/WebRTCState";
import { WebRTCCommunicationStrategy } from "../src/Model/Strategies/WebRTCCommunicationStrategy";
import type { ICommunicationSpace } from "../src/Model/Interfaces/ICommunicationSpace";

describe("CommunicationState.finalize", () => {
    const createSpace = (): ICommunicationSpace => ({
        getAllUsers: () => [],
        getUsersInFilter: () => [],
        getUsersToNotify: () => [],
        getRecordingState: () => ({ isRecording: false, recorder: null, status: "idle" }),
        dispatchPrivateEvent: vi.fn(),
        dispatchPublicEvent: vi.fn().mockResolvedValue(undefined),
        getSpaceName: () => "test-space",
        getPropertiesToSync: () => ["cameraState", "microphoneState"],
        publishMetadata: vi.fn(),
        stopRecordingByServer: vi.fn().mockResolvedValue(undefined),
        getUser: vi.fn(),
    });

    // Reproduces the bug this test guards against: a space that transitioned away from a
    // communication strategy (or was destroyed) while it was active never told that strategy to
    // tear itself down - for LivekitCommunicationStrategy specifically, that meant the LiveKit
    // room and its registered users' connections were never deleted/disconnected, since nothing
    // but finalize() is in a position to know the state is being retired for good. Using
    // WebRTCState/WebRTCCommunicationStrategy here only because they're simpler to construct in
    // isolation than the LiveKit pair; the bug (and the fix) lives in the shared base class.
    it("calls cleanup() on the underlying strategy when the state is finalized", () => {
        const space = createSpace();
        const users = new Map<string, SpaceUser>();
        const usersToNotify = new Map<string, SpaceUser>();
        const cleanupSpy = vi.spyOn(WebRTCCommunicationStrategy.prototype, "cleanup");

        const state = new WebRTCState(space, users, usersToNotify);
        state.finalize();

        expect(cleanupSpy).toHaveBeenCalledTimes(1);
        cleanupSpy.mockRestore();
    });
});
