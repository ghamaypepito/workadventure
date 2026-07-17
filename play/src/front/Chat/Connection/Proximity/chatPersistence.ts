// Chat message persistence for signed-in (non-guest) users only.
// Guests (anyone without a `wa_user` cookie, e.g. joined via invite link with no SSO login)
// never have their messages saved, and history is never loaded for them either.
//
// Conversations are keyed by the sorted set of participant uuids (not by the ephemeral
// proximity-bubble spaceName, which is reused/reassigned across unrelated encounters) so a
// 1:1 (or small group) conversation has one continuous, stable history across sessions
// regardless of which physical bubble the messages happened in.

function isGuest(): boolean {
    return !document.cookie.split("; ").some((c) => c.startsWith("wa_user="));
}

/** Builds a stable, order-independent conversation key from a set of participant uuids. */
export function conversationKeyFor(uuids: (string | undefined)[]): string | undefined {
    const unique = Array.from(new Set(uuids.filter((uuid): uuid is string => !!uuid)));
    if (unique.length === 0) return undefined;
    return unique.sort().join("|");
}

export interface PersistedChatMessage {
    author: string;
    message: string;
    ts: number;
}

export interface ChatHistoryPage {
    messages: PersistedChatMessage[];
    hasMore: boolean;
}

const HISTORY_PAGE_SIZE = 50;

export async function loadChatHistory(
    conversationKey: string,
    offset = 0,
    limit = HISTORY_PAGE_SIZE,
): Promise<ChatHistoryPage> {
    if (isGuest()) return { messages: [], hasMore: false };
    try {
        const res = await fetch(
            `/api/admission/chat-history?room=${encodeURIComponent(conversationKey)}&offset=${offset}&limit=${limit}`,
            { credentials: "same-origin" },
        );
        if (!res.ok) return { messages: [], hasMore: false };
        const data = await res.json();
        return {
            messages: Array.isArray(data.messages) ? data.messages : [],
            hasMore: Boolean(data.hasMore),
        };
    } catch (e) {
        console.error("Error loading chat history", e);
        return { messages: [], hasMore: false };
    }
}

export function persistChatMessage(conversationKey: string, author: string, message: string): void {
    if (isGuest()) return;
    fetch("/api/admission/chat-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ room: conversationKey, author, message }),
    }).catch((e) => console.error("Error persisting chat message", e));
}
