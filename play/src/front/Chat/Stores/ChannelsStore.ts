import { writable, get } from "svelte/store";
import { gameManager } from "../../Phaser/Game/GameManager";
import type { RoomConnection } from "../../Connection/RoomConnection";

export interface Channel {
    id: string;
    name: string;
    unreadCount: number;
    notificationLevel: "all" | "none";
}

export const channelsStore = writable<Channel[]>([]);
export const selectedChannelStore = writable<Channel | undefined>(undefined);

// NOTE: Room/DM selection and channel selection are kept mutually exclusive by having each
// genuine user-click call site that sets selectedRoomStore also clear selectedChannelStore
// (see ProximityRoomRow.svelte and Chat/Utils.ts). Do NOT reintroduce a blanket
// selectedRoomStore.subscribe(...) here - it also fires on the automatic/non-user-intent
// selectedRoomStore.set() calls in ProximityChatRoom.ts (incoming proximity message /
// auto-join), which would wrongly force-close an open channel panel during ordinary
// proximity chat activity.

const CHANNEL_SIGNAL_PREFIX = "channel:";
// Tracks which RoomConnection instance's socialSignalReceivedStream we're currently subscribed
// to (rather than a plain boolean flag). RoomConnection.tearDown() completes this stream on
// map change / network blip / reconnect, and a brand-new RoomConnection instance is then
// created; comparing instances lets us detect that swap and resubscribe, instead of leaving
// real-time badges dead until a full page reload.
let subscribedConnection: RoomConnection | undefined;

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
    const connection = gameManager.getCurrentGameScene().connection;
    if (!connection) return;
    if (connection === subscribedConnection) return;
    subscribedConnection = connection;
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

export async function postChannelMessage(channelId: string, message: string): Promise<boolean> {
    const res = await fetch(`/api/channels/messages?id=${channelId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
    });
    if (!res.ok) return false;

    // Instant badge for other online members: reuses the existing wave/ping socket
    // signal (see RoomConnection.emitSocialSignalRequest) rather than a new protobuf
    // message. Content never rides this signal - only channelId, via the "kind" string.
    try {
        const uuidsRes = await fetch(`/api/channels/online-member-uuids?id=${channelId}`);
        if (!uuidsRes.ok) return true;
        const { uuids } = await uuidsRes.json();
        const connection = gameManager.getCurrentGameScene().connection;
        if (!connection) return true;
        for (const uuid of uuids as string[]) {
            connection.emitSocialSignalRequest(uuid, CHANNEL_SIGNAL_PREFIX + channelId);
        }
    } catch (e) {
        console.error("[channels] failed to send real-time notification signal", e);
    }
    return true;
}

export async function markChannelRead(channelId: string): Promise<void> {
    await fetch(`/api/channels/read?id=${channelId}`, { method: "POST" });
    channelsStore.set(get(channelsStore).map((c) => (c.id === channelId ? { ...c, unreadCount: 0 } : c)));
}

export async function setChannelNotificationLevel(channelId: string, level: "all" | "none"): Promise<void> {
    await fetch(`/api/channels/notification-level?id=${channelId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level }),
    });
    channelsStore.set(get(channelsStore).map((c) => (c.id === channelId ? { ...c, notificationLevel: level } : c)));
}

export async function archiveChannel(channelId: string): Promise<boolean> {
    const res = await fetch(`/api/channels/archive?id=${channelId}`, { method: "POST" });
    if (res.ok) await refreshChannels();
    return res.ok;
}

export async function restoreChannel(channelId: string): Promise<boolean> {
    const res = await fetch(`/api/channels/restore?id=${channelId}`, { method: "POST" });
    if (res.ok) await refreshChannels();
    return res.ok;
}

export async function deleteChannelPermanently(channelId: string): Promise<boolean> {
    const res = await fetch(`/api/channels/delete?id=${channelId}`, { method: "POST" });
    return res.ok;
}

export interface ArchivedChannel {
    id: string;
    name: string;
    createdAt: number;
    createdBy?: string;
}

export async function fetchArchivedChannels(): Promise<ArchivedChannel[]> {
    const res = await fetch("/api/channels/archived");
    if (!res.ok) return [];
    const { channels } = await res.json();
    return channels;
}

export async function fetchChannelMembers(channelId: string): Promise<string[]> {
    const res = await fetch(`/api/channels/members?id=${channelId}`);
    if (!res.ok) {
        throw new Error("Failed to load channel members");
    }
    const { members } = await res.json();
    return members;
}

export async function addChannelMembers(channelId: string, emails: string[]): Promise<boolean> {
    const res = await fetch(`/api/channels/members?id=${channelId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ add: emails }),
    });
    return res.ok;
}

export async function removeChannelMember(channelId: string, email: string): Promise<boolean> {
    const res = await fetch(`/api/channels/members?id=${channelId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remove: [email] }),
    });
    return res.ok;
}

export async function resolveEmailFromUuid(uuid: string): Promise<string | null> {
    const res = await fetch(`/api/channels/resolve-email?uuid=${uuid}`);
    if (!res.ok) return null;
    const { email } = await res.json();
    return email;
}
