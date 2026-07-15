// Wave is a lightweight targeted signal piggybacked on the proximity chat's existing real-time
// space broadcast channel, so no protobuf/backend changes are needed for it. Every client in the
// space receives every signal but ignores ones not addressed to it (targetUuid mismatch).
//
// Ping does NOT use this mechanism - see RemotePlayer.ts / InviteManager.ts - because Ping
// specifically targets Busy/Do Not Disturb users, and going Busy/DND itself tears down the
// sender's proximity space membership server-side, which would make this channel unreliable
// for exactly the audience Ping needs to reach.

const SIGNAL_PREFIX = "__social_signal__:";

export interface SocialSignal {
    kind: "wave";
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
        if (parsed && typeof parsed.targetUuid === "string" && parsed.kind === "wave") {
            return parsed as SocialSignal;
        }
    } catch {
        // not a valid signal payload
    }
    return null;
}
