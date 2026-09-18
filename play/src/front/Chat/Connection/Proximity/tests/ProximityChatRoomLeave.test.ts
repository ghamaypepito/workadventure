import { describe, expect, it, vi } from "vitest";

// Keep the Phaser game (and everything it drags in) out of this unit test.
vi.mock("../../../../Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../../../../Phaser/Entity/CharacterLayerManager", () => ({ CharacterLayerManager: {} }));
vi.mock("../../../../Api/IframeListener", () => ({
    iframeListener: {
        sendLeaveMeetingEvent: vi.fn(),
        sendLeaveProximityMeetingEvent: vi.fn(),
    },
}));

import { ProximityChatRoom } from "../ProximityChatRoom";
import { DEFAULT_PROXIMITY_SPACE_NAME } from "../ProximityChatRoomManager";
import type { SpaceInterface } from "../../../../Space/SpaceInterface";
import type { SpaceRegistryInterface } from "../../../../Space/SpaceRegistry/SpaceRegistryInterface";

function createFakeSpace(spaceName: string): SpaceInterface {
    return { getName: () => spaceName, destroyed: false } as unknown as SpaceInterface;
}

function createFakeRegistry(joinedSpaceNames: string[]) {
    const spaces = new Map(joinedSpaceNames.map((name) => [name, createFakeSpace(name)]));
    const registry = {
        exist: (spaceName: string) => spaces.has(spaceName),
        get: (spaceName: string) => {
            const space = spaces.get(spaceName);
            if (!space) throw new Error(`Space ${spaceName} does not exist`);
            return space;
        },
        leaveSpace: vi.fn((space: SpaceInterface) => {
            spaces.delete(space.getName());
            return Promise.resolve();
        }),
    };
    return { registry, spaces };
}

function createRoom(spaceName: string, registry: ReturnType<typeof createFakeRegistry>["registry"]) {
    return new ProximityChatRoom(
        spaceName,
        "Proximity",
        spaceName === DEFAULT_PROXIMITY_SPACE_NAME ? "default" : "area",
        "me",
        registry as unknown as SpaceRegistryInterface,
        {} as ConstructorParameters<typeof ProximityChatRoom>[5],
        {} as ConstructorParameters<typeof ProximityChatRoom>[6],
        {} as ConstructorParameters<typeof ProximityChatRoom>[7],
        undefined,
        [],
    );
}

describe("ProximityChatRoom.leaveSpace", () => {
    it("leaves a bubble space it no longer tracks, so its call does not stay connected", async () => {
        // The registry still holds bubble A (and its LiveKit room), but the proximity room lost track of it.
        const { registry, spaces } = createFakeRegistry(["bubble-A"]);
        const room = createRoom(DEFAULT_PROXIMITY_SPACE_NAME, registry);

        const didLeave = await room.leaveSpace("bubble-A");

        expect(didLeave).toBe(false);
        expect(registry.leaveSpace).toHaveBeenCalledTimes(1);
        expect(registry.leaveSpace.mock.calls[0][0].getName()).toBe("bubble-A");
        expect(spaces.has("bubble-A")).toBe(false);
    });

    it("does nothing when the requested bubble is not joined in the registry", async () => {
        const { registry } = createFakeRegistry([]);
        const room = createRoom(DEFAULT_PROXIMITY_SPACE_NAME, registry);

        expect(await room.leaveSpace("bubble-A")).toBe(false);
        expect(registry.leaveSpace).not.toHaveBeenCalled();
    });

    it("never leaves other spaces from an area room", async () => {
        // Area rooms own a single fixed space; an untracked space is not theirs to leave.
        const { registry } = createFakeRegistry(["some-other-space"]);
        const room = createRoom("conference-01", registry);

        expect(await room.leaveSpace("some-other-space")).toBe(false);
        expect(registry.leaveSpace).not.toHaveBeenCalled();
    });
});
