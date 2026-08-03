<script lang="ts">
    import type { Readable } from "svelte/store";
    import type { ChatMessageContent } from "../../../Connection/ChatConnection";
    import { formatRelativeTime } from "../../../../Utils/RelativeTime";

    interface Props {
        content: Readable<ChatMessageContent>;
        date?: Date;
    }

    let { content, date }: Props = $props();

    let relativeTimeLabel = $derived(date ? formatRelativeTime(date.getTime(), Date.now()) : undefined);
</script>

<p class="p-0 m-0 text-xs italic">
    {$content.body}
    {#if relativeTimeLabel}
        <span class="opacity-60">- {relativeTimeLabel}</span>
    {/if}
</p>
