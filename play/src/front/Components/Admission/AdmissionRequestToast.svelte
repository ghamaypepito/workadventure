<script lang="ts">
    // Minimal placeholder required for Vite's static import analysis: AdmissionRequestStore.ts
    // statically imports this file, and Vite resolves that import to a real path on disk before
    // vi.mock("../Components/Admission/AdmissionRequestToast.svelte", ...) ever gets a chance to
    // intercept it - without a physically resolvable file here, vitest fails at transform time
    // with "Failed to resolve import", before any test code runs. Task 4 owns and replaces the
    // real implementation of this component.
    export let requestId: string;
    export let name: string;
    export let receivedAt: number;
    export let toastUuid: string;
</script>

<!-- Placeholder -->
