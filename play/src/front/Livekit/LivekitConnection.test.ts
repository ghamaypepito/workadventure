import { Subject } from "rxjs";
import { writable } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpaceInterface } from "../Space/SpaceInterface";
import type { StreamableSubjects } from "../Space/SpacePeerManager/SpacePeerManager";
import { CommunicationMessageType } from "../Space/SpacePeerManager/CommunicationMessageType";
import { LivekitConnection } from "./LivekitConnection";

const rooms = vi.hoisted(() => ({ instances: [] as Array<{ destroy: ReturnType<typeof vi.fn> }> }));

// Room setup opens network connections and subscribes to browser media devices.
vi.mock("./LiveKitRoom", () => ({
    LiveKitRoom: class {
        destroy = vi.fn();
        prepareConnection = vi.fn().mockResolvedValue(undefined);
        joinRoom = vi.fn().mockResolvedValue(undefined);
        constructor() {
            rooms.instances.push(this);
        }
    },
}));
vi.mock("../Stores/MediaStore", async () => {
    const { writable } = await import("svelte/store");
    return { streamingMegaphoneStore: writable(false) };
});

describe("LivekitConnection recovery cleanup", () => {
    afterEach(() => {
        rooms.instances.length = 0;
        vi.restoreAllMocks();
    });

    function setup() {
        const invitations = new Subject<unknown>();
        const disconnects = new Subject<unknown>();
        const space = {
            observePrivateEvent: (type: CommunicationMessageType) =>
                type === CommunicationMessageType.LIVEKIT_INVITATION_MESSAGE ? invitations : disconnects,
        } as unknown as SpaceInterface;
        const connection = new LivekitConnection(
            space,
            {} as StreamableSubjects,
            writable(new Set<string>()),
            writable(undefined),
        );
        const invite = () =>
            invitations.next({ livekitInvitationMessage: { serverUrl: "wss://test", token: "token" } });
        return { connection, invitations, disconnects, invite };
    }

    it("closes the previous room when a recovery invitation replaces it", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { connection, invite } = setup();
        invite();
        const previousRoom = rooms.instances[0];
        invite();
        expect(previousRoom.destroy).toHaveBeenCalledOnce();
        expect(rooms.instances).toHaveLength(2);
        connection.destroy();
    });

    it("ignores invitations after destruction before the first room exists", () => {
        const { connection, invite } = setup();
        connection.destroy();
        invite();
        expect(rooms.instances).toHaveLength(0);
    });

    it("ignores invitations after disconnection followed by destruction", () => {
        const { connection, disconnects, invite } = setup();
        invite();
        disconnects.next({});
        connection.destroy();
        invite();
        expect(rooms.instances).toHaveLength(1);
    });
});
