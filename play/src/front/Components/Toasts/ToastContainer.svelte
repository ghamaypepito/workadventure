<script lang="ts">
    import type { Snippet } from "svelte";
    import { fly } from "svelte/transition";
    import { onDestroy, onMount } from "svelte";
    import { toastStore } from "../../Stores/ToastStoreSingleton";
    import { formatRelativeTime } from "../../Utils/RelativeTime";

    interface Props {
        extraClasses: string;
        duration?: number;
        toastUuid?: string;
        theme: "success" | "error" | "secondary" | "light";
        receivedAt?: number;
        children?: Snippet;
        buttons?: Snippet;
    }

    let {
        extraClasses = "",
        duration = undefined,
        toastUuid = undefined,
        theme = "success",
        receivedAt = undefined,
        children,
        buttons,
    }: Props = $props();

    let timeout: ReturnType<typeof setTimeout>;

    // Live-updating "Just now" / "2m ago" label. Only runs while receivedAt is set, so toasts
    // that don't pass it (every existing toast) pay no cost.
    let relativeTimeLabel: string | undefined = $state(undefined);
    let relativeTimeTimer: ReturnType<typeof setInterval> | undefined;

    if (receivedAt !== undefined) {
        relativeTimeLabel = formatRelativeTime(receivedAt, Date.now());
        relativeTimeTimer = setInterval(() => {
            relativeTimeLabel = formatRelativeTime(receivedAt, Date.now());
        }, 15_000);
    }

    onMount(() => {
        if (duration !== undefined && toastUuid === undefined) {
            throw new Error("ToastContainer: if duration is set, toastUuid must be defined");
        }

        if (duration !== undefined && toastUuid !== undefined) {
            const theToastUuid = toastUuid;
            timeout = setTimeout(() => {
                toastStore.removeToast(theToastUuid);
            }, duration);
        }
    });

    onDestroy(() => {
        clearTimeout(timeout);
        if (relativeTimeTimer) {
            clearInterval(relativeTimeTimer);
        }
    });
</script>

<div class="toast-container flex flex-row flex-nowrap items-stretch gap-1">
    <div
        class="w-2 rounded-lg my-3"
        class:bg-danger={theme === "error"}
        class:bg-success={theme === "success"}
        class:bg-secondary={theme === "secondary"}
        class:bg-slate-300={theme === "light"}
    ></div>
    <div
        class="flex flex-col backdrop-blur-md min-w-60 min-h-12 rounded-lg overflow-hidden transition-all responsive z-20 {extraClasses} {theme !== 'light' ? 'bg-contrast/50 text-white' : 'bg-white/95 text-slate-900'}"
        transition:fly={{ x: 900, duration: 500 }}
    >
        <!-- Progress bar -->
        {#if duration !== undefined}
            <div class="progress-bar-container" class:success={theme === "success"} class:error={theme === "error"}>
                <div
                    class="progress-bar"
                    class:success={theme === "success"}
                    class:error={theme === "error"}
                    class:secondary={theme === "secondary"}
                    style="animation-duration: {duration}ms;"
                ></div>
            </div>
        {/if}

        <div class="flex items-center p-4 pointer-events-auto justify-center grow">
            <div class="text-center leading-6 responsive-message">
                {@render children?.()}
                {#if relativeTimeLabel}
                    <div class="text-xs opacity-60 mt-1">{relativeTimeLabel}</div>
                {/if}
            </div>
        </div>
        {#if buttons}
            <div
                class="buttons-wrapper flex items-center justify-center p-2 space-x-2 bg-contrast/60 pointer-events-auto"
            >
                {@render buttons()}
            </div>
        {/if}
    </div>
</div>

<style>
    .progress-bar-container {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 3px;
        overflow: hidden;
    }

    .progress-bar-container.success {
        background: rgba(34, 197, 94, 0.1);
    }

    .progress-bar-container.error {
        background: rgba(239, 68, 68, 0.1);
    }

    .progress-bar {
        height: 100%;
        transform-origin: left center;
        animation-name: progress-fill;
        animation-timing-function: linear;
        animation-fill-mode: forwards;
        will-change: transform;
    }

    .progress-bar.success {
        background: linear-gradient(90deg, #22c55e 0%, #16a34a 100%);
        box-shadow: 0 0 10px rgba(34, 197, 94, 0.4);
    }

    .progress-bar.error {
        background: linear-gradient(90deg, #ef4444 0%, #dc2626 100%);
        transition: width 0.05s linear;
    }

    .progress-bar.secondary {
        background: linear-gradient(90deg, #4156f6 0%, #3145e3 100%);
        transition: width 0.05s linear;
    }

    @keyframes progress-fill {
        from {
            transform: scaleX(0);
        }
        to {
            transform: scaleX(1);
        }
    }
</style>
