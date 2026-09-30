import { createHash, timingSafeEqual } from "crypto";
import { z } from "zod";

const visitSchema = z.object({
    tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.string(),
    expiresAt: z.number(),
    kind: z.string().optional(),
    email: z.string().optional(),
    sessionId: z.string().optional(),
});
export async function validateGuestAccess(
    pass: string | undefined,
    lookup: (id: string) => Promise<string | null>,
    activeSession?: (email: string) => Promise<string | null>,
): Promise<boolean> {
    if (!pass || !/^[a-f0-9]{32}\.[a-f0-9]{64}$/.test(pass)) return false;
    const [id, token] = pass.split(".");
    const raw = await lookup(id);
    if (!raw) return false;
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return false;
    }
    const parsed = visitSchema.safeParse(value);
    if (!parsed.success) return false;
    const visit = parsed.data;
    if (visit.status !== "approved" || visit.expiresAt <= Date.now()) return false;
    if (!timingSafeEqual(Buffer.from(visit.tokenHash, "hex"), createHash("sha256").update(token).digest()))
        return false;
    if (visit.kind === "member") {
        if (!visit.email || !visit.sessionId || !activeSession) return false;
        return (await activeSession(visit.email)) === visit.sessionId;
    }
    return true;
}

export function isGuestRoom(room: string, configured: string | undefined): boolean {
    if (!configured) return false;
    return new URL(room).origin === new URL(configured).origin;
}

export function startGuestAccessWatch(check: () => Promise<boolean>, terminate: () => void): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
        let allowed = false;
        try {
            allowed = await check();
        } catch {
            allowed = false;
        }
        if (stopped) return;
        if (!allowed) {
            stopped = true;
            terminate();
            return;
        }
        timer = setTimeout(() => {
            poll().catch((error: unknown) => console.error("Guest access watcher failed", error));
        }, 5000);
    };
    timer = setTimeout(() => {
        poll().catch((error: unknown) => console.error("Guest access watcher failed", error));
    }, 5000);
    return () => {
        stopped = true;
        clearTimeout(timer);
    };
}
