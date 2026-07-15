// Lightweight targeted signals (Wave, Ping) piggybacked on the proximity chat's existing
// real-time space broadcast channel, so no protobuf/backend changes are needed. Every client
// in the space receives every signal but ignores ones not addressed to it (targetUuid mismatch).

const SIGNAL_PREFIX = "__social_signal__:";

export type SocialSignalKind = "wave" | "ping";

export interface SocialSignal {
    kind: SocialSignalKind;
    targetUuid: string;
    actorName: string;
}

export function encodeSocialSignal(signal: SocialSignal): string {
    return SIGNAL_PREFIX + JSON.stringify(signal);
}

export function decodeSocialSignal(message: string): SocialSignal | null {
    if (!message.startsWith(SIGNAL_PREFIX)) return null;
    try {
        const parsed = JSON.parse(message.slice(SIGNAL_PREFIX.length));
        if (parsed && typeof parsed.targetUuid === "string" && (parsed.kind === "wave" || parsed.kind === "ping")) {
            return parsed as SocialSignal;
        }
    } catch {
        // not a valid signal payload
    }
    return null;
}

const PING_COOLDOWN_MS = 30_000;
const lastPingSentAt = new Map<string, number>();

/** Per-sender, per-recipient cooldown to prevent bell spam. */
export function canSendPing(targetUuid: string): boolean {
    const last = lastPingSentAt.get(targetUuid);
    return !last || Date.now() - last >= PING_COOLDOWN_MS;
}

export function recordPingSent(targetUuid: string): void {
    lastPingSentAt.set(targetUuid, Date.now());
}
