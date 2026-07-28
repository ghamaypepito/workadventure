<script lang="ts">
    import { onMount } from "svelte";
    import { resolveEmailFromUuid, addChannelMembers } from "../Stores/ChannelsStore";

    interface Props {
        userUuid: string;
        userName: string;
        onClose: () => void;
    }

    let { userUuid, userName, onClose }: Props = $props();

    interface ChannelOption {
        id: string;
        name: string;
    }

    let email = $state<string | null>(null);
    let channels = $state<ChannelOption[]>([]);
    let selected = $state<Set<string>>(new Set());
    let loading = $state(true);
    let error = $state("");
    let success = $state(false);

    async function load() {
        loading = true;
        const [resolvedEmail, channelsRes] = await Promise.all([
            resolveEmailFromUuid(userUuid),
            fetch("/api/channels/list")
                .then((r) => r.json())
                .then((d) => d.channels)
                .catch(() => []),
        ]);
        email = resolvedEmail;
        channels = channelsRes;
        loading = false;
        if (!resolvedEmail) {
            error = `${userName} hasn't signed in with an account yet (guest or no session), so they can't be added to a channel.`;
        }
    }
    onMount(load);

    function toggle(id: string) {
        const next = new Set(selected);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        selected = next;
    }

    async function confirmAdd() {
        if (!email || selected.size === 0) return;
        for (const channelId of selected) {
            await addChannelMembers(channelId, [email]);
        }
        success = true;
    }
</script>

<div class="fixed inset-0 z-[400] bg-black/50 flex items-center justify-center" onclick={onClose}>
    <div class="bg-[#1e293b] rounded-lg p-4 w-full max-w-sm text-white" onclick={(e) => e.stopPropagation()}>
        <h2 class="text-lg font-bold mb-3">Add {userName} to a channel</h2>
        {#if loading}
            <p class="text-sm text-white/50">Loading…</p>
        {:else if success}
            <p class="text-sm text-emerald-400 mb-3">Added.</p>
        {:else if error}
            <p class="text-sm text-red-400 mb-3">{error}</p>
        {:else}
            <div class="max-h-48 overflow-y-auto flex flex-col gap-1 mb-3">
                {#each channels as ch (ch.id)}
                    <label class="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/10 cursor-pointer">
                        <input type="checkbox" checked={selected.has(ch.id)} onchange={() => toggle(ch.id)} />
                        <span class="text-sm"># {ch.name}</span>
                    </label>
                {/each}
                {#if channels.length === 0}
                    <p class="text-xs text-white/50">You don't have any channels yet.</p>
                {/if}
            </div>
        {/if}
        <div class="flex gap-2 justify-end">
            <button class="px-3 py-1.5 rounded text-white/70 hover:text-white" onclick={onClose}>
                {success ? "Close" : "Cancel"}
            </button>
            {#if !loading && !error && !success}
                <button
                    class="px-3 py-1.5 rounded bg-emerald-500 text-[#0f172a] font-semibold"
                    disabled={selected.size === 0}
                    onclick={confirmAdd}
                >
                    Add
                </button>
            {/if}
        </div>
    </div>
</div>
