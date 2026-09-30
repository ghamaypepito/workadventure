import { z } from "zod";
let admissionEnabled = false;
export function guestAdmissionScript(): string | undefined {
    return admissionEnabled ? new URL("/scripts/admission-script.html", window.location.origin).toString() : undefined;
}
// Scene scripts are selected before connectToRoomSocket checks admission settings.
// Wait for that connection before deciding whether the host presence script is needed.
export async function loadGuestAdmissionScript(
    connectionReady: Promise<void>,
    mapScripts: string[],
    registerScript: (url: string) => Promise<void>,
): Promise<void> {
    await connectionReady;
    const script = guestAdmissionScript();
    if (script && !mapScripts.includes(script)) await registerScript(script);
}
const accessSchema = z.object({ enabled: z.boolean(), member: z.boolean().optional(), pass: z.string().optional() });
const visitSchema = z.object({ id: z.string(), token: z.string() });
const stateSchema = z.object({ status: z.string() });
async function request(body: Record<string, string>): Promise<unknown> {
    const response = await fetch("/api/guests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
    });
    if (response.status === 404 && body.action === "access") return { enabled: false };
    if (!response.ok) throw new Error("Office entry is unavailable. Please try again.");
    return response.json();
}
export async function ensureGuestEntry(room: string, name: string): Promise<string | undefined> {
    const access = accessSchema.parse(await request({ action: "access", room }));
    admissionEnabled = access.enabled;
    if (!access.enabled) return undefined;
    if (access.member && access.pass) return access.pass;
    let saved: unknown;
    try {
        saved = JSON.parse(sessionStorage.getItem("wa:guest-visit") || "null");
    } catch {
        saved = null;
    }
    let visit = visitSchema.safeParse(saved);
    if (!visit.success) {
        visit = visitSchema.safeParse(await request({ action: "begin", name }));
        if (!visit.success) throw new Error("Could not start guest visit");
        sessionStorage.setItem("wa:guest-visit", JSON.stringify(visit.data));
    }
    const credentials = visit.data;
    const overlay = document.createElement("div");
    overlay.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:#0f172a;display:grid;place-items:center";
    const frame = document.createElement("iframe");
    frame.src = "/scripts/guest-entry.html";
    frame.title = "Request office entry";
    frame.style.cssText = "border:0;width:min(600px,100%);height:100%;max-height:700px";
    overlay.append(frame);
    document.body.append(overlay);
    const waitForApproval = async (): Promise<string> => {
        const state = stateSchema.parse(await request({ action: "status", ...credentials }));
        if (state.status === "approved") return `${credentials.id}.${credentials.token}`;
        if (["removed", "declined", "expired"].includes(state.status)) {
            sessionStorage.removeItem("wa:guest-visit");
            window.location.assign("/guest-removed.html");
            throw new Error("Guest visit ended");
        }
        await new Promise<void>((resolve) => {
            setTimeout(resolve, 3000);
        });
        return waitForApproval();
    };
    try {
        return await waitForApproval();
    } finally {
        overlay.remove();
    }
}
