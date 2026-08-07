import AdmissionRequestToast from "../Components/Admission/AdmissionRequestToast.svelte";
import { toastStore } from "./ToastStoreSingleton";

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
// The real "should this loop keep going" signal, separate from stoppedPermanently. pollTimer
// alone can't answer this: it's only assigned inside scheduleNext(), so during the entire
// window from "timer fires" to "next timer armed" (the duration of the in-flight fetch),
// pollTimer holds an already-fired id and stopPolling() would clear nothing meaningful. running
// is set synchronously by startPolling()/stopPolling() and checked both before arming the next
// timeout and inside the in-flight poll's own continuation, so a stopPolling() call always wins
// regardless of what stage the current poll cycle is in.
let running = false;
// requestIds seen on the previous successful poll, so pollOnce can detect requests that
// disappeared (cancelled, aged out server-side, actioned from another tab) and remove their
// toasts instead of leaving them stuck forever.
let previousRequestIds = new Set<string>();

async function pollOnce(): Promise<void> {
    const response = await fetch("/api/admission/pending");
    if (!running) return;
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
    if (!running) return;
    const currentRequestIds = new Set<string>();
    for (const request of data.requests) {
        currentRequestIds.add(request.requestId);
        // toastStore.addToast is keyed by uuid - calling it again for a still-pending request
        // on the next tick harmlessly overwrites the same entry rather than adding a duplicate.
        toastStore.addToast(
            AdmissionRequestToast,
            { requestId: request.requestId, name: request.name, receivedAt: request.ts, toastUuid: request.requestId },
            request.requestId,
        );
    }
    for (const previousId of previousRequestIds) {
        if (!currentRequestIds.has(previousId)) {
            toastStore.removeToast(previousId);
        }
    }
    previousRequestIds = currentRequestIds;
}

function scheduleNext(): void {
    if (!running || stoppedPermanently) return;
    pollTimer = setTimeout(() => {
        pollOnce()
            .catch((error) => console.error("[admission] pending poll failed", error))
            .finally(scheduleNext);
    }, POLL_INTERVAL_MS);
}

export const admissionRequestStore = {
    startPolling(): void {
        if (running || stoppedPermanently) return;
        running = true;
        pollOnce()
            .catch((error) => console.error("[admission] pending poll failed", error))
            .finally(scheduleNext);
    },
    stopPolling(): void {
        running = false;
        if (pollTimer !== undefined) {
            clearTimeout(pollTimer);
            pollTimer = undefined;
        }
    },
};
