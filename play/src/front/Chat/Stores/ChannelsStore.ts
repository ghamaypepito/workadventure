import { writable, get } from "svelte/store";
import { gameManager } from "../../Phaser/Game/GameManager";
import { selectedRoomStore } from "./SelectRoomStore";

export interface Channel {
    id: string;
    name: string;
    unreadCount: number;
    notificationLevel: "all" | "none";
}

export const channelsStore = writable<Channel[]>([]);
export const selectedChannelStore = writable<Channel | undefined>(undefined);

// Keep room/DM selection and channel selection mutually exclusive: opening a room or DM while
// a channel panel is open must close the channel panel, otherwise RoomList's channel branch
// (checked first) keeps winning and clicking a DM appears to do nothing.
selectedRoomStore.subscribe((room) => {
    if (room !== undefined) selectedChannelStore.set(undefined);
});

const CHANNEL_SIGNAL_PREFIX = "channel:";
let subscribed = false;

export async function refreshChannels(): Promise<void> {
    const res = await fetch("/api/channels/list");
    if (!res.ok) return;
    const { channels } = await res.json();
    channelsStore.set(
        channels.map((c: { id: string; name: string; unreadCount: number; notificationLevel: "all" | "none" }) => ({
            id: c.id,
            name: c.name,
            unreadCount: c.unreadCount,
            notificationLevel: c.notificationLevel,
        })),
    );
    ensureSocialSignalSubscription();
}

function ensureSocialSignalSubscription(): void {
    if (subscribed) return;
    const connection = gameManager.getCurrentGameScene().connection;
    if (!connection) return;
    subscribed = true;
    connection.socialSignalReceivedStream.subscribe((payload) => {
        if (!payload.kind.startsWith(CHANNEL_SIGNAL_PREFIX)) return;
        const channelId = payload.kind.slice(CHANNEL_SIGNAL_PREFIX.length);
        const channels = get(channelsStore);
        const channel = channels.find((c) => c.id === channelId);
        if (!channel) return; // not a member (shouldn't normally happen; server only signals members)
        if (channel.notificationLevel === "none") return;
        const selected = get(selectedChannelStore);
        if (selected && selected.id === channelId) return; // already viewing it, no badge needed
        channelsStore.set(
            channels.map((c) => (c.id === channelId ? { ...c, unreadCount: c.unreadCount + 1 } : c)),
        );
    });
}

export async function postChannelMessage(channelId: string, message: string): Promise<void> {
    await fetch(`/api/channels/${channelId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
    });

    // Instant badge for other online members: reuses the existing wave/ping socket
    // signal (see RoomConnection.emitSocialSignalRequest) rather than a new protobuf
    // message. Content never rides this signal - only channelId, via the "kind" string.
    try {
        const uuidsRes = await fetch(`/api/channels/${channelId}/online-member-uuids`);
        if (!uuidsRes.ok) return;
        const { uuids } = await uuidsRes.json();
        const connection = gameManager.getCurrentGameScene().connection;
        if (!connection) return;
        for (const uuid of uuids as string[]) {
            connection.emitSocialSignalRequest(uuid, CHANNEL_SIGNAL_PREFIX + channelId);
        }
    } catch (e) {
        console.error("[channels] failed to send real-time notification signal", e);
    }
}

export async function markChannelRead(channelId: string): Promise<void> {
    await fetch(`/api/channels/${channelId}/read`, { method: "POST" });
    channelsStore.set(get(channelsStore).map((c) => (c.id === channelId ? { ...c, unreadCount: 0 } : c)));
}

export async function setChannelNotificationLevel(channelId: string, level: "all" | "none"): Promise<void> {
    await fetch(`/api/channels/${channelId}/notification-level`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level }),
    });
    channelsStore.set(get(channelsStore).map((c) => (c.id === channelId ? { ...c, notificationLevel: level } : c)));
}
