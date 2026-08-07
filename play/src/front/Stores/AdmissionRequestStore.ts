import { toastStore } from "./ToastStoreSingleton";
import AdmissionRequestToast from "../Components/Admission/AdmissionRequestToast.svelte";

const POLL_INTERVAL_MS = 5000;

interface PendingAdmissionRequest {
    requestId: string;
    name: string;
    ts: number;
}

let pollTimer: ReturnType<typeof setTimeout> | undefined;
// Set true on a 401 (guest / not signed in) so polling stops for good instead of retrying
// forever against a route that can never succeed for this session. This flag is permanent for
// the lifetime of this module instance: stopPolling() only cancels the pending timer, it does
// NOT clear this flag, so a subsequent startPolling() call (e.g. on the next room join) will
// not resume polling a route that already told us it will 401 again.
let stoppedPermanently = false;

async function pollOnce(): Promise<void> {
    const response = await fetch("/api/admission/pending");
    if (response.status === 401) {
        stoppedPermanently = true;
        return;
    }
    if (!response.ok) {
        // Transient error - keep polling, same "don't destroy state on a network blip" pattern
        // already used by guest-picker.html's own poll loop.
        return;
    }
    const data: { requests: PendingAdmissionRequest[] } = await response.json();
    for (const request of data.requests) {
        // toastStore.addToast is keyed by uuid - calling it again for a still-pending request
        // on the next tick harmlessly overwrites the same entry rather than adding a duplicate.
        toastStore.addToast(
            AdmissionRequestToast,
            { requestId: request.requestId, name: request.name, receivedAt: request.ts, toastUuid: request.requestId },
            request.requestId,
        );
    }
}

function scheduleNext(): void {
    if (stoppedPermanently) return;
    pollTimer = setTimeout(() => {
        pollOnce()
            .catch((error) => console.error("[admission] pending poll failed", error))
            .finally(scheduleNext);
    }, POLL_INTERVAL_MS);
}

export const admissionRequestStore = {
    startPolling(): void {
        if (pollTimer !== undefined || stoppedPermanently) return;
        pollOnce()
            .catch((error) => console.error("[admission] pending poll failed", error))
            .finally(scheduleNext);
    },
    stopPolling(): void {
        if (pollTimer !== undefined) {
            clearTimeout(pollTimer);
            pollTimer = undefined;
        }
    },
};
