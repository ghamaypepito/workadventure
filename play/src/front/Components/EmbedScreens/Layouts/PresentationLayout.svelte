<script lang="ts">
    import { onMount } from "svelte";
    import { writable } from "svelte/store";
    import { highlightedEmbedScreen } from "../../../Stores/HighlightedEmbedScreenStore";
    import CamerasContainer from "../CamerasContainer.svelte";
    import MediaBox from "../../Video/MediaBox.svelte";
    import { inExternalServiceStore, proximityMeetingStore } from "../../../Stores/MyMediaStore";
    import { streamableCollectionStore } from "../../../Stores/StreamableCollectionStore";
    import { highlightFullScreen } from "../../../Stores/ActionsCamStore";
    import { isOnOneLine, playerMovedInTheLast10Seconds } from "../../../Stores/VideoLayoutStore";
    import PictureInPictureActionBar from "../../ActionBar/PictureInPictureActionBar.svelte";
    import { activePictureInPictureStore } from "../../../Stores/PeerStore";

    interface Props {
        inPictureInPicture: boolean;
    }

    let { inPictureInPicture }: Props = $props();

    let camContainer: HTMLDivElement | undefined = $state();
    let highlightScreen: HTMLDivElement | undefined = $state();
    let containerWidth = $state(0);
    let containerHeight = $state(0);

    const windowSize = writable({
        height: window.innerHeight,
        width: window.innerWidth,
        camHeight: 0,
        screenShareHeight: 0,
    });

    const handleResize = () => {
        windowSize.set({
            height: window.innerHeight,
            width: window.innerWidth,
            camHeight: camContainer?.offsetHeight || 0,
            screenShareHeight: highlightScreen?.offsetHeight || 0,
        });
        resizeHeight();
    };

    $effect(() => {
        modifySizeCamIfScreenShare();
    });

    onMount(() => {
        resizeHeight();
        window.addEventListener("resize", handleResize);

        return () => {
            window.removeEventListener("resize", handleResize);
        };
    });

    function resizeHeight() {
        let availableHeight = window.innerHeight - (camContainer?.offsetHeight || 0) - 72;
        if (availableHeight < 0) {
            availableHeight = 0;
        }
    }

    $effect(() => {
        if ($highlightedEmbedScreen || $highlightFullScreen) {
            modifySizeCamIfScreenShare();
        }
    });

    function modifySizeCamIfScreenShare() {
        /*if (camContainer) {
            if ($highlightedEmbedScreen !== undefined && !$highlightFullScreen) {
                camContainer.style.transform = "scale(0.7)";
                camContainer.style.marginTop = "-24px";
                camContainer.style.marginBottom = "-8px";
            } else {
                camContainer.style.transform = "scale(1)";
                camContainer.style.marginTop = "0px";
                camContainer.style.marginBottom = "0px";
            }
        }*/
    }

    let oneLineMaxHeight = $derived(containerHeight * 0.2);
    let pipHighlightLayoutEnabled = $derived(
        inPictureInPicture && $activePictureInPictureStore && $highlightedEmbedScreen != undefined,
    );
    let pipHighlightLandscape = $derived(pipHighlightLayoutEnabled && containerWidth > containerHeight);
    let pipCameraContainerStyle = $derived(
        pipHighlightLayoutEnabled
            ? pipHighlightLandscape
                ? "flex: 0 0 20%; max-width: 20%; min-width: 20%;"
                : "flex: 0 0 20%; max-height: 20%; min-height: 20%;"
            : "",
    );
    let pipHighlightContainerStyle = $derived(
        pipHighlightLayoutEnabled
            ? pipHighlightLandscape
                ? "flex: 0 0 80%; max-width: 80%; min-width: 80%;"
                : "flex: 0 0 80%; max-height: 80%; min-height: 80%;"
            : "",
    );
    let pipOneLineMode: "vertical" | "horizontal" = $derived(
        pipHighlightLayoutEnabled
            ? pipHighlightLandscape
                ? "vertical"
                : "horizontal"
            : inPictureInPicture
              ? "vertical"
              : "horizontal",
    );

    // The persistent top bar (see TopBar.svelte) only exists in the main document, not inside
    // the separate Document Picture-in-Picture window this component can also render into (see
    // PictureInPicture.svelte's requestWindow/reparenting) - so the 48px clearance below only
    // applies when NOT in that separate window, to avoid a dead band / overlap with the PiP
    // window's own bottom action bar there.
    let topOffsetClass = $derived(inPictureInPicture ? "top-0 h-full" : "top-12 h-[calc(100%-3rem)]");
</script>

{#if $proximityMeetingStore === true && !$inExternalServiceStore}
    <div
        class="presentation-layout flex pointer-events-none w-full absolute mobile:mt-3 {topOffsetClass}"
        class:flex-col={!pipHighlightLayoutEnabled || !pipHighlightLandscape}
        class:flex-row-reverse={pipHighlightLayoutEnabled && pipHighlightLandscape}
        style={inPictureInPicture && $highlightedEmbedScreen != undefined ? "height: calc(100vh - 80px);" : ""}
        bind:clientWidth={containerWidth}
        bind:clientHeight={containerHeight}
    >
        {#if $streamableCollectionStore.size > 0}
            <div
                class="justify-end md:justify-center w-full relative"
                class:max-height-quarter={$isOnOneLine && !inPictureInPicture}
                class:h-full={!$isOnOneLine || (inPictureInPicture && !pipHighlightLayoutEnabled)}
                class:overflow-y-auto={inPictureInPicture}
                class:flex-1={inPictureInPicture && $highlightedEmbedScreen != undefined && !pipHighlightLayoutEnabled}
                style={pipCameraContainerStyle}
                bind:this={camContainer}
            >
                <CamerasContainer {oneLineMaxHeight} isOnOneLine={$isOnOneLine} oneLineMode={pipOneLineMode} />
            </div>
        {/if}

        {#if $streamableCollectionStore.size > 0 && $highlightedEmbedScreen && !$playerMovedInTheLast10Seconds}
            <div
                id="highlighted-media"
                class="md:mb-0"
                class:flex-1={!inPictureInPicture || $highlightedEmbedScreen == undefined}
                class:flex-[4]={inPictureInPicture &&
                    $highlightedEmbedScreen != undefined &&
                    !pipHighlightLayoutEnabled}
                class:mb-8={!inPictureInPicture || $highlightedEmbedScreen == undefined}
                class:mb-0={inPictureInPicture && $highlightedEmbedScreen != undefined}
                style={pipHighlightContainerStyle}
                bind:this={highlightScreen}
            >
                {#key $highlightedEmbedScreen.uniqueId}
                    <MediaBox videoBox={$highlightedEmbedScreen} />
                {/key}
            </div>
        {/if}

        {#if $activePictureInPictureStore}
            <div
                class="flex-none"
                class:fixed={inPictureInPicture && $highlightedEmbedScreen != undefined}
                class:bottom-0={inPictureInPicture && $highlightedEmbedScreen != undefined}
                class:left-0={inPictureInPicture && $highlightedEmbedScreen != undefined}
                class:right-0={inPictureInPicture && $highlightedEmbedScreen != undefined}
                class:w-full={inPictureInPicture && $highlightedEmbedScreen != undefined}
                class:transition-all={inPictureInPicture && $highlightedEmbedScreen != undefined}
                class:pointer-events-none={inPictureInPicture && $highlightedEmbedScreen != undefined}
                style="z-index: 20;"
            >
                <PictureInPictureActionBar />
            </div>
        {/if}
    </div>
{/if}

<style>
    .max-height-quarter {
        max-height: 25%;
    }
</style>
