// Chat message persistence for signed-in (non-guest) users only.
// Guests (anyone without a `wa_user` cookie, e.g. joined via invite link with no SSO login)
// never have their messages saved, and history is never loaded for them either.

function isGuest(): boolean {
    return !document.cookie.split("; ").some((c) => c.startsWith("wa_user="));
}

export interface PersistedChatMessage {
    author: string;
    message: string;
    ts: number;
}

export async function loadChatHistory(room: string): Promise<PersistedChatMessage[]> {
    if (isGuest()) return [];
    try {
        const res = await fetch(`/api/admission/chat-history?room=${encodeURIComponent(room)}`, {
            credentials: "same-origin",
        });
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data.messages) ? data.messages : [];
    } catch (e) {
        console.error("Error loading chat history", e);
        return [];
    }
}

export function persistChatMessage(room: string, author: string, message: string): void {
    if (isGuest()) return;
    fetch("/api/admission/chat-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ room, author, message }),
    }).catch((e) => console.error("Error persisting chat message", e));
}
