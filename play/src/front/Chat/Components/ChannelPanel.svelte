<script lang="ts">
    import { onMount } from "svelte";
    import {
        channelsStore,
        selectedChannelStore,
        markChannelRead,
        postChannelMessage,
        setChannelNotificationLevel,
        refreshChannels,
    } from "../Stores/ChannelsStore";

    interface Props {
        channelId: string;
    }

    let { channelId }: Props = $props();

    let channel = $derived($channelsStore.find((c) => c.id === channelId));

    interface ChannelMessage {
        author: string;
        message: string;
        ts: number;
    }

    let messages = $state<ChannelMessage[]>([]);
    let draft = $state("");
    let loading = $state(true);
    let error = $state<string | undefined>(undefined);

    const isAdminUser =
        typeof window !== "undefined" && (window as unknown as { __waIsAdmin?: boolean }).__waIsAdmin === true;

    async function loadMessages() {
        loading = true;
        const res = await fetch(`/api/channels/${channelId}/messages?limit=50`);
        if (!res.ok) {
            loading = false;
            if (res.status === 403) {
                // Per the design doc: a non-member (e.g. just removed by an admin) should see
                // why the panel stopped working rather than a broken/empty panel. Do NOT clear
                // selectedChannelStore here - RoomList gates ChannelPanel's mount on
                // `$selectedChannelStore !== undefined`, so clearing it immediately would
                // unmount this component and destroy the error state before it's ever shown.
                // The channel is removed from the sidebar right away; the user leaves the panel
                // via the existing back-arrow (close()), which clears the store then.
                error = "You've been removed from this channel";
                await refreshChannels();
                return;
            }
            error = "Failed to load messages";
            return;
        }
        const data = await res.json();
        messages = data.messages;
        loading = false;
    }

    onMount(() => {
        loadMessages();
        markChannelRead(channelId);
    });

    async function send() {
        if (!draft.trim()) return;
        const text = draft;
        draft = "";
        const ok = await postChannelMessage(channelId, text);
        if (!ok) {
            error = "Failed to send message";
            draft = text;
            return;
        }
        await loadMessages();
    }

    async function toggleNotifications() {
        const next = channel?.notificationLevel === "all" ? "none" : "all";
        await setChannelNotificationLevel(channelId, next);
    }

    async function rename() {
        const newName = prompt("Rename channel", channel?.name);
        if (!newName || !newName.trim()) return;
        const res = await fetch(`/api/channels/${channelId}/rename`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: newName.trim() }),
        });
        if (!res.ok) {
            error = "Failed to rename channel";
            return;
        }
        // Refresh the sidebar list; since `channel` above is derived live from channelsStore,
        // this also updates the panel's own displayed name - no page reload required.
        await refreshChannels();
    }

    function close() {
        selectedChannelStore.set(undefined);
    }
</script>

<div class="flex flex-col h-full text-white">
    {#if channel === undefined}
        <div class="flex items-center gap-2 px-3 py-2 border-b border-white/10">
            <button class="text-white/60 hover:text-white" onclick={close}>&larr;</button>
            <div class="font-bold flex-1 truncate">Channel not found</div>
        </div>
        {#if error}
            <div class="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">
                <p class="text-sm text-red-400">{error}</p>
                <button class="self-start text-xs text-white/50 hover:text-white underline" onclick={close}>
                    Back to channels
                </button>
            </div>
        {/if}
    {:else}
        <div class="flex items-center gap-2 px-3 py-2 border-b border-white/10">
            <button class="text-white/60 hover:text-white" onclick={close}>&larr;</button>
            <div class="font-bold flex-1 truncate"># {channel.name}</div>
            {#if isAdminUser}
                <button class="text-xs text-white/50 hover:text-white" onclick={rename}>Rename</button>
            {/if}
            <button class="text-xs text-white/50 hover:text-white" onclick={toggleNotifications}>
                {channel.notificationLevel === "all" ? "All messages" : "Nothing"}
            </button>
        </div>
        <div class="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">
            {#if error}
                <p class="text-sm text-red-400">{error}</p>
            {/if}
            {#if loading}
                <p class="text-sm text-white/50">Loading…</p>
            {:else}
                {#each messages as msg, i (i)}
                    <div class="text-sm">
                        <span class="font-semibold">{msg.author}:</span>
                        <span>{msg.message}</span>
                    </div>
                {/each}
            {/if}
        </div>
        <div class="flex gap-2 px-3 py-2 border-t border-white/10">
            <input
                bind:value={draft}
                placeholder="Message #{channel.name}"
                class="flex-1 px-3 py-2 rounded bg-[#0f172a] border border-[#334155] text-white text-sm"
                onkeydown={(e) => {
                    if (e.key === "Enter") send();
                }}
            />
            <button class="px-3 py-2 rounded bg-emerald-500 text-[#0f172a] font-semibold text-sm" onclick={send}
                >Send</button
            >
        </div>
    {/if}
</div>
