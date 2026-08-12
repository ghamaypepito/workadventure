import { describe, expect, it, vi, beforeEach } from "vitest";
import { Subject } from "rxjs";
import type { JoinSpaceRequestMessage } from "@workadventure/messages";
import { ProximitySpaceManager } from "./ProximitySpaceManager";
import type { RoomConnection } from "../Connection/RoomConnection";
import type { ProximityChatRoomManager } from "../Chat/Connection/Proximity/ProximityChatRoomManager";

const { disableWebcam, disableMicrophone } = vi.hoisted(() => ({
    disableWebcam: vi.fn(),
    disableMicrophone: vi.fn(),
}));

vi.mock("../Stores/MediaStore", () => ({
    requestedCameraState: { disableWebcam },
    requestedMicrophoneState: { disableMicrophone },
}));

describe("ProximitySpaceManager", () => {
    beforeEach(() => {
        disableWebcam.mockClear();
        disableMicrophone.mockClear();
    });

    it("forces the camera and microphone off every time the client is asked to join a space", async () => {
        const joinSpaceRequestMessage = new Subject<JoinSpaceRequestMessage>();
        const roomConnection = {
            joinSpaceRequestMessage: joinSpaceRequestMessage.asObservable(),
            leaveSpaceRequestMessage: new Subject().asObservable(),
        } as unknown as RoomConnection;

        const proximityChatRoomManager = {
            joinDefaultSpace: vi.fn().mockResolvedValue(undefined),
            leaveDefaultSpace: vi.fn().mockResolvedValue(undefined),
        } as unknown as ProximityChatRoomManager;

        new ProximitySpaceManager(roomConnection, proximityChatRoomManager);

        expect(disableWebcam).not.toHaveBeenCalled();
        expect(disableMicrophone).not.toHaveBeenCalled();

        joinSpaceRequestMessage.next({ spaceName: "some-space", propertiesToSync: [] });

        expect(disableWebcam).toHaveBeenCalledTimes(1);
        expect(disableMicrophone).toHaveBeenCalledTimes(1);

        // A second, different space join must mute again too - not just once per session.
        joinSpaceRequestMessage.next({ spaceName: "another-space", propertiesToSync: [] });

        expect(disableWebcam).toHaveBeenCalledTimes(2);
        expect(disableMicrophone).toHaveBeenCalledTimes(2);
    });
});
