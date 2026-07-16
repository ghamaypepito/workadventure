<script lang="ts">
    import { LL } from "../../../i18n/i18n-svelte";
    import ToastContainer from "../Toasts/ToastContainer.svelte";
    import { toastStore } from "../../Stores/ToastStoreSingleton";

    interface Props {
        actorName: string;
        toastUuid: string;
    }

    let { actorName, toastUuid = "" }: Props = $props();
</script>

<ToastContainer theme="secondary" extraClasses="" {toastUuid}>
    🔔 {$LL.chat.socialSignal.wantsToTalk({ name: actorName })}
    {#snippet buttons()}
        <button
            type="button"
            class="btn btn-light btn-ghost text-sm"
            onclick={() => toastStore.removeToast(toastUuid)}
        >
            {$LL.chat.socialSignal.dismiss()}
        </button>
    {/snippet}
</ToastContainer>
