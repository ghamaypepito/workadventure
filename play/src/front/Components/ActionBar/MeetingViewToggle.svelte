<script lang="ts">
    import { meetingViewStore } from "../../Stores/MeetingViewStore";
    import { isInRemoteConversation } from "../../Stores/StreamableCollectionStore";
    import { LL } from "../../../i18n/i18n-svelte";
    import { IconMap, IconLayoutGrid } from "@wa-icons";

    // Only worth offering when there's actually a call to show in a grid.
    let show = $derived($isInRemoteConversation || $meetingViewStore);
</script>

{#if show}
    <button
        type="button"
        class="pointer-events-auto flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20 transition-all"
        data-testid="meeting-view-toggle"
        onclick={() => meetingViewStore.update((v) => !v)}
    >
        {#if $meetingViewStore}
            <IconMap font-size="18" />
            {$LL.actionbar.mapView()}
        {:else}
            <IconLayoutGrid font-size="18" />
            {$LL.actionbar.meetingView()}
        {/if}
    </button>
{/if}
