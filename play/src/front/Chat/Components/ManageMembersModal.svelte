<script lang="ts">
    import { onMount } from "svelte";
    import { fetchChannelMembers, addChannelMembers, removeChannelMember } from "../Stores/ChannelsStore";

    interface Props {
        channelId: string;
        channelName: string;
        onClose: () => void;
    }

    let { channelId, channelName, onClose }: Props = $props();

    let currentMembers = $state<string[]>([]);
    let knownMembers = $state<{ email: string; online: boolean }[]>([]);
    let selectedToAdd = $state<Set<string>>(new Set());
    let loading = $state(true);
    let error = $state("");

    async function load() {
        loading = true;
        error = "";
        const knownPromise = fetch("/api/admission/known-members")
            .then((r) => r.json())
            .then((d) => d.members)
            .catch(() => []);
        try {
            const members = await fetchChannelMembers(channelId);
            currentMembers = members;
            knownMembers = await knownPromise;
        } catch {
            error = "Failed to load channel members";
            knownMembers = await knownPromise;
        } finally {
            loading = false;
        }
    }
    onMount(load);

    let addableMembers = $derived(knownMembers.filter((m) => !currentMembers.includes(m.email)));

    function toggle(email: string) {
        const next = new Set(selectedToAdd);
        if (next.has(email)) next.delete(email);
        else next.add(email);
        selectedToAdd = next;
    }

    async function addSelected() {
        if (selectedToAdd.size === 0) return;
        error = "";
        const ok = await addChannelMembers(channelId, Array.from(selectedToAdd));
        if (!ok) {
            error = "Failed to add members";
            return;
        }
        selectedToAdd = new Set();
        await load();
    }

    async function remove(email: string) {
        if (!confirm(`Remove ${email} from #${channelName}?`)) return;
        error = "";
        const ok = await removeChannelMember(channelId, email);
        if (!ok) {
            error = "Failed to remove member";
            return;
        }
        await load();
    }
</script>

<div class="fixed inset-0 z-[400] bg-black/50 flex items-center justify-center" onclick={onClose}>
    <div class="bg-[#1e293b] rounded-lg p-4 w-full max-w-sm text-white" onclick={(e) => e.stopPropagation()}>
        <h2 class="text-lg font-bold mb-3">Manage members — #{channelName}</h2>
        {#if loading}
            <p class="text-sm text-white/50">Loading…</p>
        {:else}
            <p class="text-xs text-white/50 uppercase tracking-wide mb-1">Current members</p>
            <div class="max-h-32 overflow-y-auto flex flex-col gap-1 mb-3">
                {#each currentMembers as email (email)}
                    <div class="flex items-center justify-between px-2 py-1 rounded bg-[#0f172a]">
                        <span class="text-sm truncate">{email}</span>
                        <button class="text-xs text-red-400 hover:text-red-300 shrink-0" onclick={() => remove(email)}
                            >Remove</button
                        >
                    </div>
                {/each}
            </div>
            <p class="text-xs text-white/50 uppercase tracking-wide mb-1">Add members</p>
            <div class="max-h-32 overflow-y-auto flex flex-col gap-1 mb-3">
                {#each addableMembers as member (member.email)}
                    <label class="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/10 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={selectedToAdd.has(member.email)}
                            onchange={() => toggle(member.email)}
                        />
                        <span class="text-sm">{member.email}</span>
                    </label>
                {/each}
                {#if addableMembers.length === 0}
                    <p class="text-xs text-white/50">Everyone known is already in this channel.</p>
                {/if}
            </div>
        {/if}
        {#if error}
            <p class="text-sm text-red-400 mb-2">{error}</p>
        {/if}
        <div class="flex gap-2 justify-end">
            <button class="px-3 py-1.5 rounded text-white/70 hover:text-white" onclick={onClose}>Close</button>
            <button
                class="px-3 py-1.5 rounded bg-emerald-500 text-[#0f172a] font-semibold"
                disabled={selectedToAdd.size === 0}
                onclick={addSelected}
            >
                Add selected
            </button>
        </div>
    </div>
</div>
