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
// Monotonically incrementing "which poll chain is the current one" counter. A boolean running
// flag can't distinguish "this specific poll chain was stopped" from "some poll chain is
// currently active": if stopPolling() is followed quickly by startPolling() (e.g. a room
// transition landing mid-fetch), a boolean flips back to true before the stale chain's in-flight
// fetch resolves, so the stale chain would wrongly believe it's still current. Each poll chain
// instead captures the generation value that was current when IT started (see startPolling) and
// compares against the live `generation` in every continuation. startPolling() and stopPolling()
// both bump `generation`, so any chain that isn't the newest one always sees a mismatch and stops
// itself without touching shared state (toasts, previousRequestIds, pollTimer).
let generation = 0;
// requestIds seen on the previous successful poll, so pollOnce can detect requests that
// disappeared (cancelled, aged out server-side, actioned from another tab) and remove their
// toasts instead of leaving them stuck forever.
let previousRequestIds = new Set<string>();

async function pollOnce(myGeneration: number): Promise<void> {
    const response = await fetch("/api/admission/pending");
    if (myGeneration !== generation) return;
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
    if (myGeneration !== generation) return;
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

function scheduleNext(myGeneration: number): void {
    if (myGeneration !== generation || stoppedPermanently) return;
    pollTimer = setTimeout(() => {
        pollOnce(myGeneration)
            .catch((error) => console.error("[admission] pending poll failed", error))
            .finally(() => scheduleNext(myGeneration));
    }, POLL_INTERVAL_MS);
}

export const admissionRequestStore = {
    // Repeated startPolling() calls (with no intervening stopPolling()) are NOT a no-op: each
    // call starts a new, superseding poll chain, firing its own immediate fetch(). The old chain
    // is neutralized via the generation check in pollOnce/scheduleNext, but nothing stops a
    // caller from starting a chain on top of another. This is safe today because the sole call
    // site (GameScene.ts) always pairs stopPolling() before startPolling() via Phaser's
    // scene-cleanup lifecycle - that ordering is a caller invariant this module relies on but
    // does not itself enforce.
    startPolling(): void {
        if (pollTimer !== undefined) {
            // Clear any timer armed by a previous, still-superseded poll chain so it can never
            // fire after this call - otherwise a second startPolling() without an intervening
            // stopPolling() would overwrite the only reference to that timer, orphaning it
            // uncancellable by any future stopPolling() (which can only clear whatever
            // `pollTimer` currently points to).
            clearTimeout(pollTimer);
            pollTimer = undefined;
        }
        if (stoppedPermanently) return;
        const myGeneration = ++generation;
        pollOnce(myGeneration)
            .catch((error) => console.error("[admission] pending poll failed", error))
            .finally(() => scheduleNext(myGeneration));
    },
    stopPolling(): void {
        generation++;
        if (pollTimer !== undefined) {
            clearTimeout(pollTimer);
            pollTimer = undefined;
        }
    },
};
