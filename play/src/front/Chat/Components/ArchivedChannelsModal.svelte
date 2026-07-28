<script lang="ts">
    import { onMount } from "svelte";
    import {
        fetchArchivedChannels,
        restoreChannel,
        deleteChannelPermanently,
        type ArchivedChannel,
    } from "../Stores/ChannelsStore";

    interface Props {
        onClose: () => void;
    }

    let { onClose }: Props = $props();

    let channels = $state<ArchivedChannel[]>([]);
    let loading = $state(true);
    let error = $state("");

    async function load() {
        loading = true;
        channels = await fetchArchivedChannels();
        loading = false;
    }
    onMount(load);

    async function restore(channel: ArchivedChannel) {
        const ok = await restoreChannel(channel.id);
        if (!ok) {
            error = "Failed to restore channel";
            return;
        }
        await load();
    }

    async function deletePermanently(channel: ArchivedChannel) {
        if (
            !confirm(
                `Permanently delete #${channel.name}? This erases all its messages and cannot be undone.`,
            )
        )
            return;
        const ok = await deleteChannelPermanently(channel.id);
        if (!ok) {
            error = "Failed to delete channel";
            return;
        }
        await load();
    }
</script>

<div class="fixed inset-0 z-[400] bg-black/50 flex items-center justify-center" onclick={onClose}>
    <div class="bg-[#1e293b] rounded-lg p-4 w-full max-w-sm text-white" onclick={(e) => e.stopPropagation()}>
        <h2 class="text-lg font-bold mb-3">Archived channels</h2>
        {#if loading}
            <p class="text-sm text-white/50">Loading…</p>
        {:else if channels.length === 0}
            <p class="text-sm text-white/50 mb-3">No archived channels.</p>
        {:else}
            <div class="max-h-64 overflow-y-auto flex flex-col gap-1 mb-3">
                {#each channels as channel (channel.id)}
                    <div class="flex items-center justify-between gap-2 px-2 py-2 rounded bg-[#0f172a]">
                        <span class="text-sm truncate"># {channel.name}</span>
                        <div class="flex gap-2 shrink-0">
                            <button
                                class="text-xs text-emerald-400 hover:text-emerald-300"
                                onclick={() => restore(channel)}
                            >
                                Restore
                            </button>
                            <button
                                class="text-xs text-red-400 hover:text-red-300"
                                onclick={() => deletePermanently(channel)}
                            >
                                Delete permanently
                            </button>
                        </div>
                    </div>
                {/each}
            </div>
        {/if}
        {#if error}
            <p class="text-sm text-red-400 mb-2">{error}</p>
        {/if}
        <div class="flex justify-end">
            <button class="px-3 py-1.5 rounded text-white/70 hover:text-white" onclick={onClose}>Close</button>
        </div>
    </div>
</div>
