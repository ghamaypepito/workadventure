import { Subject } from "rxjs";
import { writable } from "svelte/store";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpaceInterface } from "../Space/SpaceInterface";
import type { StreamableSubjects } from "../Space/SpacePeerManager/SpacePeerManager";
import { CommunicationMessageType } from "../Space/SpacePeerManager/CommunicationMessageType";
import { LivekitConnection } from "./LivekitConnection";

const rooms = vi.hoisted(() => ({
    instances: [] as Array<{
        destroy: ReturnType<typeof vi.fn>;
        joinRoom: ReturnType<typeof vi.fn<() => Promise<void>>>;
        dispatchStream: ReturnType<typeof vi.fn>;
    }>,
}));

// Room setup opens network connections and subscribes to browser media devices.
vi.mock("./LiveKitRoom", () => ({
    LiveKitRoom: class {
        destroy = vi.fn();
        prepareConnection = vi.fn().mockResolvedValue(undefined);
        joinRoom = vi.fn().mockResolvedValue(undefined);
        dispatchStream = vi.fn().mockResolvedValue(undefined);
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
    it("does not publish queued media into a replacement room before it has joined", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { connection, invite } = setup();
        const stream = {} as MediaStream;
        await connection.dispatchStream(stream);
        invite();
        let finishOldJoin!: () => void;
        rooms.instances[0].joinRoom.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finishOldJoin = resolve;
                }),
        );
        await Promise.resolve();
        invite();
        let finishNewJoin!: () => void;
        rooms.instances[1].joinRoom.mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finishNewJoin = resolve;
                }),
        );
        await Promise.resolve();
        finishOldJoin();
        await Promise.resolve();
        await Promise.resolve();
        expect(rooms.instances[1].dispatchStream).not.toHaveBeenCalled();
        finishNewJoin();
        await Promise.resolve();
        await Promise.resolve();
        expect(rooms.instances[1].dispatchStream).toHaveBeenCalledWith(stream);
        connection.destroy();
    });
    it("keeps only one active room across repeated recovery invitations", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { connection, invite, invitations, disconnects } = setup();
        for (let retry = 0; retry < 50; retry++) {
            invite();
            // Each recovery must finish before the next failure is triggered.
            // eslint-disable-next-line no-await-in-loop
            await Promise.resolve();
            // eslint-disable-next-line no-await-in-loop
            await Promise.resolve();
            expect(rooms.instances.filter((room) => room.destroy.mock.calls.length === 0)).toHaveLength(1);
        }
        connection.destroy();
        expect(rooms.instances.every((room) => room.destroy.mock.calls.length === 1)).toBe(true);
        expect(invitations.observed).toBe(false);
        expect(disconnects.observed).toBe(false);
    });
});
