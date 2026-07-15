<script lang="ts">
    import { LL } from "../../../i18n/i18n-svelte";
    import ToastContainer from "../Toasts/ToastContainer.svelte";

    interface Props {
        actorName: string;
        toastUuid: string;
    }

    let { actorName, toastUuid = "" }: Props = $props();
    const duration = 5000;
</script>

<ToastContainer theme="secondary" extraClasses="" {toastUuid} {duration}>
    🔔 {$LL.chat.socialSignal.wantsToTalk({ name: actorName })}
</ToastContainer>
