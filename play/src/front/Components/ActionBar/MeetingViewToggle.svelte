<script lang="ts">
    import { meetingViewStore } from "../../Stores/MeetingViewStore";
    import { isInRemoteConversation } from "../../Stores/StreamableCollectionStore";
    import { highlightFullScreen } from "../../Stores/ActionsCamStore";
    import { LL } from "../../../i18n/i18n-svelte";
    import { IconMap, IconLayoutGrid } from "@wa-icons";

    // Only worth offering when there's actually a call to show in a grid.
    let show = $derived($isInRemoteConversation || $meetingViewStore);

    function toggle() {
        // The single-participant fullscreen highlight (MainLayout.svelte's
        // {#if $highlightedEmbedScreen && $highlightFullScreen} block) renders at z-[310],
        // above meeting view's own grid overlay at z-[300] - turning meeting view on while that
        // highlight is still active would silently render the grid underneath it, making the
        // toggle look like it did nothing. The two are mutually exclusive full-screen
        // presentations, so entering meeting view always exits the highlight first.
        highlightFullScreen.set(false);
        meetingViewStore.update((v) => !v);
    }
</script>

{#if show}
    <button
        type="button"
        class="pointer-events-auto flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20 transition-all"
        data-testid="meeting-view-toggle"
        onclick={toggle}
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
