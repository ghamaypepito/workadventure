<script lang="ts">
    import { refreshChannels } from "../Stores/ChannelsStore";

    interface Props {
        onClose: () => void;
    }

    let { onClose }: Props = $props();

    let name = $state("");
    let members = $state<{ email: string; online: boolean }[]>([]);
    let selectedEmails = $state<Set<string>>(new Set());
    let loading = $state(true);
    let error = $state("");

    async function loadMembers() {
        try {
            const res = await fetch("/api/admission/known-members");
            const { members: fetched } = await res.json();
            members = fetched;
        } catch (e) {
            error = "Failed to load members";
        } finally {
            loading = false;
        }
    }
    loadMembers();

    function toggle(email: string) {
        const next = new Set(selectedEmails);
        if (next.has(email)) next.delete(email);
        else next.add(email);
        selectedEmails = next;
    }

    async function create() {
        if (!name.trim()) {
            error = "Channel name is required";
            return;
        }
        try {
            const res = await fetch("/api/channels/create", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: name.trim(), memberEmails: Array.from(selectedEmails) }),
            });
            if (!res.ok) {
                const data = await res.json();
                error = data.error || "Failed to create channel";
                return;
            }
            await refreshChannels();
            onClose();
        } catch (e) {
            error = "Failed to create channel";
        }
    }
</script>

<div class="fixed inset-0 z-[400] bg-black/50 flex items-center justify-center" onclick={onClose}>
    <div
        class="bg-[#1e293b] rounded-lg p-4 w-full max-w-sm text-white"
        onclick={(e) => e.stopPropagation()}
    >
        <h2 class="text-lg font-bold mb-3">New channel</h2>
        <input
            bind:value={name}
            placeholder="Channel name"
            class="w-full mb-3 px-3 py-2 rounded bg-[#0f172a] border border-[#334155] text-white"
        />
        {#if loading}
            <p class="text-sm text-white/50">Loading members…</p>
        {:else}
            <div class="max-h-48 overflow-y-auto flex flex-col gap-1 mb-3">
                {#each members as member (member.email)}
                    <label class="flex items-center gap-2 px-2 py-1 rounded hover:bg-white/10 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={selectedEmails.has(member.email)}
                            onchange={() => toggle(member.email)}
                        />
                        <span class="text-sm">{member.email}</span>
                    </label>
                {/each}
            </div>
        {/if}
        {#if error}
            <p class="text-sm text-red-400 mb-2">{error}</p>
        {/if}
        <div class="flex gap-2 justify-end">
            <button class="px-3 py-1.5 rounded text-white/70 hover:text-white" onclick={onClose}>Cancel</button>
            <button class="px-3 py-1.5 rounded bg-emerald-500 text-[#0f172a] font-semibold" onclick={create}
                >Create</button
            >
        </div>
    </div>
</div>
