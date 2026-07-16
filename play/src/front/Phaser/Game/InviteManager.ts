import type { Subscription } from "rxjs";
import type { MeetingInvitationRequestReceivedMessage } from "@workadventure/messages";
import { AskPositionMessage_AskType } from "@workadventure/messages";
import { get } from "svelte/store";
import type { RoomConnection } from "../../Connection/RoomConnection";
import { meetingInvitationRequestStore } from "../../Stores/MeetingInvitationStore";
import { toastStore } from "../../Stores/ToastStoreSingleton";
import { gameManager } from "../../Phaser/Game/GameManager";
// Svelte component used for declined toast (runtime import for toastStore.addToast)
import MeetingInvitationDeclinedToast from "../../Components/MeetingInvitation/MeetingInvitationDeclinedToast.svelte";
import MeetingInvitationAcceptedToast from "../../Components/MeetingInvitation/MeetingInvitationAcceptToast.svelte";
import MeetingInvitationLimitToast from "../../Components/MeetingInvitation/MeetingInvitationLimitToast.svelte";
import PingReceivedToast from "../../Components/SocialSignal/PingReceivedToast.svelte";
import WaveReceivedToast from "../../Components/SocialSignal/WaveReceivedToast.svelte";
import LL from "../../../i18n/i18n-svelte";

export type SocialSignalKind = "wave" | "ping";

const MEETING_INVITATION_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MEETING_INVITATION_MAX_REQUESTS = 50;
const MEETING_INVITATION_MAX_PER_USER = 3;

interface InviteRequestLogEntry {
    at: number;
    receiverUserUuid: string;
}

export class InviteManager {
    private subscriptions: Subscription[] = [];
    private inviteRequestLog: InviteRequestLogEntry[] = [];

    constructor(private connection: RoomConnection) {
        // Show meeting invitation request received toast when the meeting invitation request is received
        this.subscriptions.push(
            this.connection.meetingInvitationRequestReceivedStream.subscribe((payload) => {
                meetingInvitationRequestStore.set(payload);
                // Play a short sound to notify the user that a meeting request has arrived
                const scene = gameManager.getCurrentGameScene();
                if (scene) {
                    scene.playMeetingInSound();
                }
            }),
        );

        // Show accepted or declined toast when the meeting invitation response is received
        this.subscriptions.push(
            this.connection.meetingInvitationResponseReceivedStream.subscribe((payload) => {
                if (!payload.accepted) {
                    const toastId = `meeting-invitation-declined-${Date.now()}`;
                    toastStore.addToast(
                        MeetingInvitationDeclinedToast,
                        {
                            responderName: payload.responderName,
                            toastUuid: toastId,
                        },
                        toastId,
                    );
                }
                if (payload.accepted) {
                    const toastId = `meeting-invitation-accepted-${Date.now()}`;
                    toastStore.addToast(
                        MeetingInvitationAcceptedToast,
                        {
                            responderName: payload.responderName,
                            toastUuid: toastId,
                        },
                        toastId,
                    );
                    // When the invitee accepts, reset the sender's antispam counter so they can send invites again
                    this.inviteRequestLog = [];
                }
            }),
        );

        // Show limit reached toast when the number of meeting invitation requests per sender is too high
        this.subscriptions.push(
            this.connection.meetingInvitationRequestTooHighStream.subscribe(() => {
                this.showLimitReachedToast();
            }),
        );

        // Clear the invitation if the user accepts or declines the invitation
        this.subscriptions.push(
            this.connection.meetingInvitationRequestClosedStream.subscribe(() => {
                meetingInvitationRequestStore.set(null);
            }),
        );

        // Clear the invitation if the user left the room
        this.subscriptions.push(
            this.connection.userLeftMessageStream.subscribe((payload) => {
                if (payload.userId === get(meetingInvitationRequestStore)?.senderUserId) {
                    meetingInvitationRequestStore.set(null);
                }
            }),
        );

        // Show a toast + soft chime when a Wave or Ping is received. Delivered over the persistent
        // connection to a specific user by uuid, independent of proximity space or map location -
        // reaches the target anywhere on the map, including a Busy/Do Not Disturb user (that status
        // change tears down proximity group/space membership, so this can't ride that channel).
        this.subscriptions.push(
            this.connection.socialSignalReceivedStream.subscribe((payload) => {
                const kind = payload.kind === "wave" ? "wave" : "ping";
                const toastId = `social-signal-${kind}-${Date.now()}`;
                toastStore.addToast(
                    kind === "wave" ? WaveReceivedToast : PingReceivedToast,
                    { actorName: payload.senderName, toastUuid: toastId },
                    toastId,
                );
                const scene = gameManager.getCurrentGameScene();
                if (scene) {
                    scene.playSound(kind === "wave" ? "wave" : "ping-bell", 0.15);
                    const text =
                        kind === "wave"
                            ? get(LL).chat.socialSignal.wavedToYou({ name: payload.senderName })
                            : get(LL).chat.socialSignal.pingedYou({ name: payload.senderName });
                    try {
                        scene.proximityChatRoomManager.getDefaultRoom()?.logSystemMessage(text, payload.senderName);
                    } catch (error) {
                        console.error(`Failed to log ${kind} to chat history:`, error);
                    }
                }
            }),
        );
    }

    public handleAccept(request: MeetingInvitationRequestReceivedMessage): void {
        this.connection.emitMeetingInvitationResponse(true, request.senderUserUuid);
        // TODO: Change emitAskPosition to a server query to allow for error handling
        // NOTE: For now, if the user leaves while their position is being requested, nothing happens
        this.connection.emitAskPosition(
            request.senderUserUuid,
            request.senderPlayUri,
            AskPositionMessage_AskType.MOVE,
            request.senderUserId,
        );
    }

    public handleDecline(request: MeetingInvitationRequestReceivedMessage): void {
        this.connection.emitMeetingInvitationResponse(false, request.senderUserUuid);
    }

    /**
     * Sends a meeting invitation request if antispam limits are not exceeded.
     * Limits: max 50 requests in 10 minutes, max 3 requests to the same user in 10 minutes.
     * Admins (moderators) are not subject to these limits.
     * @returns true if the request was sent, false if blocked by limits
     */
    public requestMeetingInvitation(receiverUserUuid: string, receiverUserId?: number): boolean {
        const isAdmin = this.connection.isAdmin();

        if (!isAdmin) {
            const now = Date.now();
            const cutoff = now - MEETING_INVITATION_WINDOW_MS;
            this.inviteRequestLog = this.inviteRequestLog.filter((e) => e.at > cutoff);

            if (this.inviteRequestLog.length >= MEETING_INVITATION_MAX_REQUESTS) {
                this.showLimitReachedToast();
                return false;
            }
            const toSameUser = this.inviteRequestLog.filter((e) => e.receiverUserUuid === receiverUserUuid).length;
            if (toSameUser >= MEETING_INVITATION_MAX_PER_USER) {
                this.showLimitReachedToast();
                return false;
            }

            this.inviteRequestLog.push({ at: now, receiverUserUuid });
        }

        this.connection.emitMeetingInvitationRequest(receiverUserUuid, receiverUserId);
        return true;
    }

    /**
     * Sends a Wave or Ping to a user by uuid, anywhere on the map, over the persistent connection
     * (independent of proximity space membership). Shares the same server-side antispam limits
     * as meeting invitations (max 50 requests/10min, max 3 to the same user/10min).
     * @returns true if the request was sent, false if blocked by limits
     */
    public requestSocialSignal(
        kind: SocialSignalKind,
        receiverUserUuid: string,
        receiverUserName: string,
        receiverUserId?: number,
    ): boolean {
        const isAdmin = this.connection.isAdmin();

        if (!isAdmin) {
            const now = Date.now();
            const cutoff = now - MEETING_INVITATION_WINDOW_MS;
            this.inviteRequestLog = this.inviteRequestLog.filter((e) => e.at > cutoff);

            if (this.inviteRequestLog.length >= MEETING_INVITATION_MAX_REQUESTS) {
                this.showLimitReachedToast();
                return false;
            }
            const toSameUser = this.inviteRequestLog.filter((e) => e.receiverUserUuid === receiverUserUuid).length;
            if (toSameUser >= MEETING_INVITATION_MAX_PER_USER) {
                this.showLimitReachedToast();
                return false;
            }

            this.inviteRequestLog.push({ at: now, receiverUserUuid });
        }

        this.connection.emitSocialSignalRequest(receiverUserUuid, kind, receiverUserId);

        // Log the send side too (item 3: sender sees "You waved at X" / "You pinged X").
        const scene = gameManager.getCurrentGameScene();
        if (scene) {
            const text =
                kind === "wave"
                    ? get(LL).chat.socialSignal.youWavedAt({ name: receiverUserName })
                    : get(LL).chat.socialSignal.youPinged({ name: receiverUserName });
            try {
                scene.proximityChatRoomManager.getDefaultRoom()?.logSystemMessage(text, receiverUserName);
            } catch (error) {
                console.error(`Failed to log ${kind} to chat history:`, error);
            }
        }

        return true;
    }

    private showLimitReachedToast(): void {
        const toastId = `meeting-invitation-limit-${Date.now()}`;
        toastStore.addToast(MeetingInvitationLimitToast, { toastUuid: toastId }, toastId);
    }

    public close(): void {
        this.subscriptions.forEach((s) => s.unsubscribe());
        this.subscriptions.length = 0;
        meetingInvitationRequestStore.set(null);
    }
}
