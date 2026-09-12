<script lang="ts">
    import { fade } from "svelte/transition";
    import { loaderProgressStore } from "../../Stores/LoaderStore";
    import { gameManager } from "../../Phaser/Game/GameManager";
    const bgMap = "/static/images/connectium-office-loading.png";

    const logo = gameManager.currentStartedRoom.loadingLogo;
    const sceneBg = gameManager.currentStartedRoom.backgroundSceneImage ?? bgMap;
    const bgColor = gameManager.currentStartedRoom.backgroundColor ?? "#1B2A41";
    const primary = gameManager.currentStartedRoom.primaryColor ?? "#4056F6";
</script>

<div
    class="absolute top-0 left-0 z-50 h-dvh w-dvw"
    in:fade={{ duration: 100 }}
    out:fade={{ delay: 500, duration: 300 }}
>
    <div class="flex items-center min-h-dvh w-dvw relative z-30">
        <div class="flex flex-col items-center justify-center w-full h-full relative">
            <div class="mb-6 px-6 text-center">
                {#if logo}
                    <img
                        draggable="false"
                        src={logo}
                        class="mx-auto mb-4 max-w-[300px] max-h-[150px]"
                        alt="Office logo"
                    />
                {/if}
                <h1 class="text-4xl sm:text-6xl font-semibold text-white">ConnectiumAI Office</h1>
                <p class="mt-4 text-base text-white/80" role="status">Getting your workplace ready…</p>
            </div>
            <div class="w-56 h-1.5 rounded-full overflow-hidden bg-white/20">
                <div
                    class="h-full transition-all duration-200 motion-reduce:transition-none"
                    style="width: {$loaderProgressStore * 100}%; background-color: {primary};"
                ></div>
            </div>
        </div>
    </div>
    <div
        class="absolute left-0 top-0 w-full h-full bg-cover bg-center z-10"
        style="background-image: url({sceneBg});"
    ></div>
    <div class="absolute left-0 top-0 w-full h-full z-20 opacity-60" style="background-color: {bgColor};"></div>
</div>
