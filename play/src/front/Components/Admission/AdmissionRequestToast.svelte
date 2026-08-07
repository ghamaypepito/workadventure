<script lang="ts">
    import ToastContainer from "../Toasts/ToastContainer.svelte";
    import { toastStore } from "../../Stores/ToastStoreSingleton";

    interface Props {
        requestId: string;
        name: string;
        receivedAt: number;
        toastUuid: string;
    }

    let { requestId, name, receivedAt, toastUuid }: Props = $props();

    let actionState: "idle" | "sending" = $state("idle");
    // Set on a 409 from approve (the destination area doesn't exist on the current live map) -
    // shown inline rather than letting the toast close with nothing visibly having happened,
    // same failure-visibility pattern used by the Wave/Ping toasts' own inline error states.
    let destinationUnavailable = $state(false);

    async function respond(body: Record<string, unknown>, endpoint: "approve" | "deny"): Promise<void> {
        if (actionState === "sending") return;
        actionState = "sending";
        destinationUnavailable = false;
        try {
            const response = await fetch(`/api/admission/${endpoint}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (response.status === 409) {
                destinationUnavailable = true;
                // eslint-disable-next-line require-atomic-updates
                actionState = "idle";
                return;
            }
            if (!response.ok) {
                throw new Error(`Request failed: ${response.status}`);
            }
            toastStore.removeToast(toastUuid);
        } catch (error) {
            console.error(`[admission] ${endpoint} failed:`, error);
            // eslint-disable-next-line require-atomic-updates
            actionState = "idle";
        }
    }

    function letThemIn() {
        respond({ requestId, destination: "demo-area" }, "approve").catch((error) =>
            console.error("[admission] approve (demo-area) failed:", error),
        );
    }

    function sendToLobby() {
        respond({ requestId, destination: "receiving" }, "approve").catch((error) =>
            console.error("[admission] approve (receiving) failed:", error),
        );
    }

    function deny() {
        respond({ requestId }, "deny").catch((error) => console.error("[admission] deny failed:", error));
    }
</script>

<ToastContainer theme="light" extraClasses="" {toastUuid} {receivedAt}>
    {name} is here to visit
    {#snippet buttons()}
        <button
            type="button"
            class="btn btn-light btn-ghost text-sm w-full"
            onclick={letThemIn}
            disabled={actionState === "sending"}
        >
            Let them in
        </button>
        <button
            type="button"
            class="btn btn-light btn-ghost text-sm w-full"
            onclick={sendToLobby}
            disabled={actionState === "sending"}
        >
            Send to Lobby
        </button>
        <button
            type="button"
            class="btn btn-light btn-ghost text-sm w-full col-span-2"
            onclick={deny}
            disabled={actionState === "sending"}
        >
            Deny
        </button>
        {#if destinationUnavailable}
            <span class="text-xs opacity-70 col-span-2 text-center">That location isn't available right now</span>
        {/if}
    {/snippet}
</ToastContainer>
