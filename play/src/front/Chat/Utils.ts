import * as Sentry from "@sentry/svelte";
import { get } from "svelte/store";
import type { MatrixClient } from "matrix-js-sdk";
import { analyticsClient } from "../Administration/AnalyticsClient";
import { iframeListener } from "../Api/IframeListener";
import { connectionManager } from "../Connection/ConnectionManager";
import type { CoWebsite } from "../WebRtc/CoWebsite/CoWebsite";
import { SimpleCoWebsite } from "../WebRtc/CoWebsite/SimpleCoWebsite";
import { coWebsites } from "../Stores/CoWebsiteStore";
import { scriptUtils } from "../Api/ScriptUtils";
import { gameManager } from "../Phaser/Game/GameManager";
import { userIsConnected } from "../Stores/MenuStore";
import { chatVisibilityStore } from "../Stores/ChatStore";
import { warningMessageStore } from "../Stores/ErrorStore";
import { LL } from "../../i18n/i18n-svelte";
import { hasMatrixChatCapabilities } from "./Connection/ChatConnection";
import { navChat } from "./Stores/ChatStore";
import { selectedRoomStore } from "./Stores/SelectRoomStore";
import { selectedChannelStore } from "./Stores/ChannelsStore";
import RequiresLoginForChatModal from "./Components/RequiresLoginForChatModal.svelte";
import { modals } from "@wa-modals";

export type OpenCoWebsiteObject = {
    url: string;
    allowApi?: boolean;
    allowPolicy?: string;
    widthPercent?: number;
    closable?: boolean;
    hideUrl?: boolean;
};

//enlever les events lié au chat dans iframelistener
export const openCoWebSite = (
    { url, allowApi, allowPolicy, widthPercent, closable }: OpenCoWebsiteObject,
    source: MessageEventSource | null,
) => {
    if (!url || !source) {
        throw new Error("Unknown query source");
    }

    const coWebsite: SimpleCoWebsite = new SimpleCoWebsite(
        new URL(url, iframeListener.getBaseUrlFromSource(source)),
        allowApi,
        allowPolicy,
        widthPercent,
        closable,
    );

    return openSimpleCowebsite(coWebsite);
};

export const getCoWebSite = () => {
    return get(coWebsites).map((coWebsite: CoWebsite) => {
        return {
            id: coWebsite.getId(),
        };
    });
};

export const sendRedirectPricing = () => {
    if (connectionManager.currentRoom && connectionManager.currentRoom.pricingUrl) {
        window.location.href = connectionManager.currentRoom.pricingUrl;
    }
};

export const sendLogin = () => {
    analyticsClient.login();
    window.location.href = "/login";
};

export const openTab = (url: string) => {
    scriptUtils.openTab(url);
};

export const openDirectChatRoom = async (chatID: string) => {
    try {
        if (!get(userIsConnected)) {
            modals.open(RequiresLoginForChatModal);
            return;
        }
        const chatConnection = await gameManager.getChatConnection();
        let room = chatConnection.getDirectRoomFor(chatID);
        if (!room) room = await chatConnection.createDirectRoom(chatID);
        if (!room) throw new Error("Failed to create room");
        analyticsClient.createMatrixRoom();

        if (get(room.myMembership) === "invite") {
            room.joinRoom().catch((error: unknown) => console.error(error));
        }

        selectedChannelStore.set(undefined);
        selectedRoomStore.set(room);
        navChat.switchToChat();
        chatVisibilityStore.set(true);
    } catch (error) {
        warningMessageStore.addWarningMessage(get(LL).chat.failedToOpenRoom({ roomId: chatID }));
        console.error(error);
        Sentry.captureException(error);
    }
};

/**
 * Sends a direct message to chatID without opening the chat panel - used for the wave/ping
 * toast's canned quick-reply, where popping the whole chat UI open would be more disruptive
 * than the one-line reply itself.
 *
 * KNOWN LIMITATION (documented, not fixed, by explicit decision for this fix round): the
 * quick-reply's "failed" state only reliably catches the two failure modes this function itself
 * can observe and throw for - "not connected" (above) and "room creation failed" (below). Once
 * execution reaches `room.sendMessage(message)`, a genuine network/Matrix-level send failure will
 * NOT surface as "failed" to the caller, and the quick-reply will show "sent" even though the
 * message never actually went out.
 *
 * This is because MatrixChatRoom.sendMessage (Chat/Connection/Matrix/MatrixChatRoom.ts) is
 * fire-and-forget by design: it kicks off `matrixRoom.client.sendMessage(...)` and swallows/logs
 * any rejection internally (`.catch((error) => console.error(error))`) rather than returning a
 * Promise the caller could await/catch. That method is shared with other existing callers (e.g.
 * the real chat input box), so changing its signature to propagate send failures is out of scope
 * here - it was a real option that was explicitly considered and declined for this batch, to
 * avoid widening a shared interface. Fixing this fully would require that wider change.
 */
export const sendDirectMessage = async (chatID: string, message: string): Promise<void> => {
    if (!get(userIsConnected)) {
        // Unlike openDirectChatRoom (which prompts a login modal - reasonable when the user is
        // about to look at a chat panel), this helper is used for a fire-and-forget quick-reply
        // that has no UI of its own to prompt from. Throwing lets the caller's try/catch treat
        // "not connected" as a real send failure instead of a silent, indistinguishable no-op -
        // guests/anonymous users (userIsConnected tracks SSO/OpenID login, not toast eligibility)
        // must not see a false "sent" confirmation.
        throw new Error("Cannot send direct message: user is not connected");
    }
    const chatConnection = await gameManager.getChatConnection();
    let room = chatConnection.getDirectRoomFor(chatID);
    if (!room) room = await chatConnection.createDirectRoom(chatID);
    if (!room) throw new Error("Failed to create room");
    if (get(room.myMembership) === "invite") {
        room.joinRoom().catch((error: unknown) => console.error(error));
    }
    room.sendMessage(message);
};

export const openChatRoom = async (roomId: string) => {
    try {
        if (!get(userIsConnected)) {
            modals.open(RequiresLoginForChatModal);
            return;
        }
        const chatConnection = await gameManager.getChatConnection();
        const room = chatConnection.getRoomByID(roomId);

        if (!room) throw new Error("Failed to retrieve room");

        selectedChannelStore.set(undefined);
        selectedRoomStore.set(room);
        navChat.switchToChat();
        chatVisibilityStore.set(true);
    } catch (error) {
        warningMessageStore.addWarningMessage(get(LL).chat.failedToOpenRoom({ roomId }));
        console.error(error);
        Sentry.captureException(error);
    }
};

export const openCoWebSiteWithoutSource = ({
    url,
    allowApi,
    allowPolicy,
    widthPercent,
    closable,
    hideUrl,
}: OpenCoWebsiteObject) => {
    if (!url) {
        throw new Error("Unknown query source");
    }

    const coWebsite: SimpleCoWebsite = new SimpleCoWebsite(
        new URL(url),
        allowApi,
        allowPolicy,
        widthPercent,
        closable,
        hideUrl,
    );

    return openSimpleCowebsite(coWebsite);
};

const openSimpleCowebsite = (coWebsite: SimpleCoWebsite) => {
    coWebsites.add(coWebsite);

    return {
        id: coWebsite.getId(),
    };
};

export const closeCoWebsite = (coWebsiteId: string) => {
    const coWebsite = coWebsites.findById(coWebsiteId);

    if (!coWebsite) {
        console.warn("Unknown co-website, probably already closed", coWebsiteId);
        return;
    }

    coWebsites.remove(coWebsite);
};

/** Matrix client for chat tint resolution; undefined if Matrix chat is not active. */
export function getMatrixClientForChatTint(): MatrixClient | undefined {
    try {
        const c = gameManager.chatConnection;
        if (hasMatrixChatCapabilities(c)) {
            return c.getMatrixClient();
        }
    } catch {
        /* game scene not ready */
    }
    return undefined;
}
