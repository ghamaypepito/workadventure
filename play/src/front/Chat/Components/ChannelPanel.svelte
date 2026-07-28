<script lang="ts">
    import { onMount } from "svelte";
    import {
        selectedChannelStore,
        markChannelRead,
        postChannelMessage,
        setChannelNotificationLevel,
        type Channel,
    } from "../Stores/ChannelsStore";

    interface Props {
        channel: Channel;
    }

    let { channel }: Props = $props();

    interface ChannelMessage {
        author: string;
        message: string;
        ts: number;
    }

    let messages = $state<ChannelMessage[]>([]);
    let draft = $state("");
    let loading = $state(true);

    const isAdminUser =
        typeof window !== "undefined" && (window as unknown as { __waIsAdmin?: boolean }).__waIsAdmin === true;

    async function loadMessages() {
        loading = true;
        const res = await fetch(`/api/channels/${channel.id}/messages?limit=50`);
        const data = await res.json();
        messages = data.messages;
        loading = false;
    }

    onMount(() => {
        loadMessages();
        markChannelRead(channel.id);
    });

    async function send() {
        if (!draft.trim()) return;
        const text = draft;
        draft = "";
        await postChannelMessage(channel.id, text);
        await loadMessages();
    }

    async function toggleNotifications() {
        const next = channel.notificationLevel === "all" ? "none" : "all";
        await setChannelNotificationLevel(channel.id, next);
    }

    async function rename() {
        const newName = prompt("Rename channel", channel.name);
        if (!newName || !newName.trim()) return;
        await fetch(`/api/channels/${channel.id}/rename`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: newName.trim() }),
        });
    }

    function close() {
        selectedChannelStore.set(undefined);
    }
</script>

<div class="flex flex-col h-full text-white">
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
</div>
