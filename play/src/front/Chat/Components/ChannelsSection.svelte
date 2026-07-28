<script lang="ts">
    import { onMount } from "svelte";
    import { channelsStore, selectedChannelStore, refreshChannels } from "../Stores/ChannelsStore";
    import { selectedRoomStore } from "../Stores/SelectRoomStore";
    import CreateChannelModal from "./CreateChannelModal.svelte";

    let displayChannels = $state(false);
    let showCreateModal = $state(false);

    const isAdminUser =
        typeof window !== "undefined" && (window as unknown as { __waIsAdmin?: boolean }).__waIsAdmin === true;

    onMount(() => {
        refreshChannels();
    });

    function toggleDisplay() {
        displayChannels = !displayChannels;
    }

    function selectChannel(channel: (typeof $channelsStore)[number]) {
        selectedRoomStore.set(undefined);
        selectedChannelStore.set(channel);
    }
</script>

<div
    class="group relative px-3 m-0 rounded-none text-white/75 hover:text-white h-11 hover:bg-contrast-200/10 w-full flex items-center gap-1 border border-solid border-x-0 border-t border-b-0 border-white/10"
>
    <button
        type="button"
        class="flex items-center min-w-0 flex-1 text-start m-0 p-0 h-full bg-transparent border-0 cursor-pointer text-inherit"
        onclick={toggleDisplay}
    >
        <div class="text-white text-sm font-bold tracking-widest uppercase truncate">Channels</div>
    </button>
</div>

{#if displayChannels}
    <div class="flex flex-col px-2 pb-2">
        {#each $channelsStore as channel (channel.id)}
            <button
                class="flex items-center justify-between px-2 py-2 rounded hover:bg-white/10 text-sm text-white/80 hover:text-white text-left"
                onclick={() => selectChannel(channel)}
            >
                <span class="truncate"># {channel.name}</span>
                {#if channel.unreadCount > 0 && channel.notificationLevel !== "none"}
                    <span class="ml-2 px-1.5 rounded-full bg-emerald-500 text-[#0f172a] text-xs font-bold">
                        {channel.unreadCount}
                    </span>
                {/if}
            </button>
        {/each}
        {#if isAdminUser}
            <button
                class="flex items-center gap-2 px-2 py-2 rounded hover:bg-white/10 text-sm text-white/50 hover:text-white text-left"
                onclick={() => (showCreateModal = true)}
            >
                + Add channel
            </button>
        {/if}
    </div>
{/if}

{#if showCreateModal}
    <CreateChannelModal onClose={() => (showCreateModal = false)} />
{/if}
