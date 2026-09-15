import type {
    HandleRecordingWebhookRequest,
    MeetingConnectionRestartMessage,
    SpaceUser,
} from "@workadventure/messages";
import * as Sentry from "@sentry/node";
import type { ICommunicationSpace } from "../Interfaces/ICommunicationSpace";
import type { IRecordableStrategy } from "../Interfaces/ICommunicationStrategy";
import type { LiveKitService, RecordingStartInfo } from "../Services/LivekitService";

import { LivekitRoomLease } from "../Services/LivekitRoomLease";

export class LivekitCommunicationStrategy implements IRecordableStrategy {
    private disposed = false;
    private roomLease: LivekitRoomLease | undefined;

    private getRoomLease(): LivekitRoomLease {
        return (this.roomLease ??= new LivekitRoomLease(
            JSON.stringify([this.livekitService.getLivekitFrontendUrl(), this.space.getSpaceName()]),
        ));
    }

    private usersReady: Set<string> = new Set();
    private createRoomPromise: Promise<void> | null = null;

    private streamingUsers: Map<string, SpaceUser> = new Map<string, SpaceUser>();
    private receivingUsers: Map<string, SpaceUser> = new Map<string, SpaceUser>();

    /**
     * Queue of pending operations per user to prevent race conditions
     * when users rapidly move between zones.
     */
    private pendingOperations: Map<string, Promise<void>> = new Map();

    constructor(
        private space: ICommunicationSpace,
        private livekitService: LiveKitService,
    ) {}

    /**
     * Queues an operation for a specific user to ensure sequential execution.
     * This prevents race conditions when addUser/deleteUser are called in rapid succession.
     */
    private queueUserOperation(userId: string, operation: () => Promise<void>): Promise<void> {
        const previousOperation = this.pendingOperations.get(userId) ?? Promise.resolve();

        const newOperation = previousOperation
            .catch(() => {
                // Ignore errors from previous operations to continue the queue
            })
            .then(async () => {
                if (!this.disposed) await operation();
            });

        this.pendingOperations.set(userId, newOperation);

        // Clean up the map when the operation completes
        newOperation
            .finally(() => {
                if (this.pendingOperations.get(userId) === newOperation) {
                    this.pendingOperations.delete(userId);
                }
            })
            .catch(() => {
                // Ignore cleanup errors
            });

        return newOperation;
    }

    async addUser(user: SpaceUser): Promise<void> {
        return this.queueUserOperation(user.spaceUserId, async () => {
            // A second addUser() for a spaceUserId already marked streaming, with no deleteUser()
            // in between, is most commonly a reconnect the server hasn't yet observed the old
            // connection drop for - not a genuine duplicate. Previously this bailed out entirely,
            // leaving a reconnecting client with no fresh invitation and no way to ever resume
            // (see the identical fix in addUserToNotify() below for the receiving-side case).
            // Refresh the registration and fall through so a new token is sent below, instead of
            // silently dropping it.
            const refreshingRegistration = this.streamingUsers.has(user.spaceUserId);
            if (refreshingRegistration) {
                console.warn("User already streaming in the room - refreshing registration", user.spaceUserId);
            }

            // Reserve membership before asynchronous creation so pending deletion sees new publishers.
            const firstPublisher = this.streamingUsers.size === 0;
            this.streamingUsers.set(user.spaceUserId, user);
            if (!this.createRoomPromise) {
                this.createRoomPromise = this.getRoomLease().run(() =>
                    this.livekitService.createRoom(this.space.getSpaceName()),
                );
            }
            try {
                await this.createRoomPromise;
            } catch (error) {
                this.createRoomPromise = null;
                this.streamingUsers.delete(user.spaceUserId);
                throw error;
            }
            if (this.disposed || !this.getRoomLease().isCurrent) return;

            // Send invitation to all receiving users if this is the first room creation. Routed
            // through each receivingUser's OWN per-spaceUserId queue (not this addUser() call's
            // queue, which is keyed by the new streaming user, not them) - otherwise a concurrent
            // deleteUserFromNotify() for one of THEM, which does run on that queue, could remove
            // them from the space while this invitation's generateToken() round-trip was still in
            // flight, hitting the exact same silent-drop race the awaited send below was fixed for
            // (Space.dispatchPrivateEvent()'s self-dispatch case drops a message with no recipient
            // left to deliver to). This is what let it recur in a conference room after the first
            // fix: this loop, not the one below, is what notifies users who were already receiving
            // before the room existed.
            if (this.receivingUsers.size > 0 && firstPublisher) {
                for (const receivingUser of this.receivingUsers.values()) {
                    this.queueUserOperation(receivingUser.spaceUserId, () =>
                        this.sendLivekitInvitationMessage(receivingUser),
                    ).catch((error) => {
                        console.error(
                            `Error generating token for user ${receivingUser.spaceUserId} in Livekit:`,
                            error,
                        );
                        Sentry.captureException(error);
                    });
                }
            }

            // Send invitation to the new user if not already receiving. Awaited (matching
            // addUserToNotify() below) rather than fire-and-forget: this runs inside this user's own
            // per-spaceUserId queue, so awaiting it blocks any deleteUser() for this same user from
            // running until the invitation is actually sent. Without the await, a fast-following
            // leave (a reconnect, a brief proximity overlap) could remove the user from the space
            // while generateToken()'s network round-trip was still in flight; by the time
            // dispatchPrivateEvent() ran, the user was gone, and the self-dispatch case in
            // Space.dispatchPrivateEvent() drops that silently - the recipient's client never
            // received a token and just sat there, which is why some 1:1 proximity rooms end up with
            // only one side ever actually publishing.
            if (refreshingRegistration || !this.receivingUsers.has(user.spaceUserId)) {
                await this.sendLivekitInvitationMessage(user).catch((error) => {
                    console.error(`Error generating token for user ${user.spaceUserId} in Livekit:`, error);
                    Sentry.captureException(error);
                });
            }
        });
    }

    private sendLivekitDisconnectMessage(user: SpaceUser): void {
        try {
            this.space.dispatchPrivateEvent({
                spaceName: this.space.getSpaceName(),
                receiverUserId: user.spaceUserId,
                senderUserId: user.spaceUserId,
                spaceEvent: {
                    event: {
                        $case: "livekitDisconnectMessage",
                        livekitDisconnectMessage: {},
                    },
                },
            });
        } catch (error) {
            console.error(`Error dispatching livekitDisconnectMessage for user ${user.spaceUserId}:`, error);
            Sentry.captureException(error);
        }
    }

    deleteUser(user: SpaceUser): void {
        this.queueUserOperation(user.spaceUserId, async () => {
            const deleted = this.streamingUsers.delete(user.spaceUserId);

            if (!deleted) {
                return;
            }

            // Let's only disconnect from Livekit if the user is not watching in the room anymore
            if (!this.receivingUsers.has(user.spaceUserId)) {
                this.sendLivekitDisconnectMessage(user);
            }

            if (this.streamingUsers.size === 0) {
                try {
                    await this.space.stopRecordingByServer();
                } catch (error) {
                    console.error(`Error stopping recording for space ${this.space.getSpaceName()}:`, error);
                    Sentry.captureException(error);
                }

                if (this.disposed) return;
                await this.getRoomLease().run(async () => {
                    // Recheck after recording cleanup and after waiting for other room API calls.
                    if (this.streamingUsers.size > 0) return;
                    this.createRoomPromise = null;
                    for (const receivingUser of this.receivingUsers.values()) {
                        this.sendLivekitDisconnectMessage(receivingUser);
                    }
                    await this.livekitService.deleteRoom(this.space.getSpaceName());
                });
            }
        }).catch((error) => {
            console.error(`Error in deleteUser for ${user.spaceUserId}:`, error);
            Sentry.captureException(error);
        });
    }

    updateUser(user: SpaceUser): void {}

    async initialize(
        users: ReadonlyMap<string, SpaceUser>,
        usersToNotify: ReadonlyMap<string, SpaceUser>,
    ): Promise<void> {
        for (const user of users.values()) {
            // We want to add users sequentially
            // The first user will trigger the room creation (which is async) but for other users, the
            // room will already be created, and the execution will not wait at all.
            // eslint-disable-next-line no-await-in-loop
            await this.addUser(user).catch((error) => {
                console.error(`Error adding user ${user.spaceUserId} to Livekit:`, error);
                Sentry.captureException(error);
            });
        }

        for (const user of usersToNotify.values()) {
            // We want to add users sequentially
            // The first user will trigger the room creation (which is async) but for other users, the
            // room will already be created, and the execution will not wait at all.
            // eslint-disable-next-line no-await-in-loop
            await this.addUserToNotify(user).catch((error) => {
                console.error(`Error adding user ${user.spaceUserId} to Livekit:`, error);
                Sentry.captureException(error);
            });
        }
    }

    addUserReady(userId: string): void {
        this.usersReady.add(userId);
    }

    canSwitch(): boolean {
        return this.usersReady.size === this.space.getAllUsers().length;
    }

    async addUserToNotify(user: SpaceUser): Promise<void> {
        return this.queueUserOperation(user.spaceUserId, async () => {
            // See the identical comment in addUser() above: a second addUserToNotify() for a
            // spaceUserId already marked receiving, with no deleteUserFromNotify() in between, is
            // most commonly a reconnect - not a genuine duplicate. Bailing out here used to leave
            // the reconnecting client with no fresh invitation and audio that never resumed once
            // the first connection dropped. Refresh the registration and fall through instead.
            if (this.receivingUsers.has(user.spaceUserId)) {
                console.warn("User already receiving in the room - refreshing registration", user.spaceUserId);
            }

            this.receivingUsers.set(user.spaceUserId, user);

            if (!this.createRoomPromise) {
                return;
            }
            await this.createRoomPromise;

            // Let's only send the invitation if the user is not already streaming in the room
            if (!this.streamingUsers.has(user.spaceUserId)) {
                await this.sendLivekitInvitationMessage(user);
            }
        });
    }

    deleteUserFromNotify(user: SpaceUser): void {
        this.queueUserOperation(user.spaceUserId, () => {
            const deleted = this.receivingUsers.delete(user.spaceUserId);
            if (!deleted) {
                console.warn("User to delete not found in receiving users", user.spaceUserId);
            }

            // Let's only disconnect from Livekit if the user is not streaming in the room anymore
            if (!this.streamingUsers.has(user.spaceUserId)) {
                this.sendLivekitDisconnectMessage(user);
            }
            return Promise.resolve();
        }).catch((error) => {
            console.error(`Error in deleteUserFromNotify for ${user.spaceUserId}:`, error);
            Sentry.captureException(error);
        });
    }

    private async sendLivekitInvitationMessage(user: SpaceUser): Promise<void> {
        if (this.disposed || !this.space.getUser(user.spaceUserId)) return;
        const token = await this.livekitService.generateToken(this.space.getSpaceName(), user);
        if (this.disposed || (this.roomLease && !this.roomLease.isCurrent) || !this.space.getUser(user.spaceUserId))
            return;

        this.space.dispatchPrivateEvent({
            spaceName: this.space.getSpaceName(),
            receiverUserId: user.spaceUserId,
            senderUserId: user.spaceUserId,
            spaceEvent: {
                event: {
                    $case: "livekitInvitationMessage",
                    livekitInvitationMessage: {
                        token: token,
                        serverUrl: this.livekitService.getLivekitFrontendUrl(),
                    },
                },
            },
        });
    }

    public handleMeetingConnectionRestartMessage(
        meetingConnectionRestartMessage: MeetingConnectionRestartMessage,
        senderUserId: string,
    ): void {
        if (
            this.disposed ||
            !this.roomLease?.isCurrent ||
            (!this.streamingUsers.has(senderUserId) && !this.receivingUsers.has(senderUserId))
        )
            return;
        const senderUser = this.space.getUser(senderUserId);
        if (!senderUser) {
            console.warn("User not found in space", senderUserId);
            return;
        }
        // Same reasoning as the other sendLivekitInvitationMessage() call sites in this file:
        // route through this user's own per-spaceUserId queue so a concurrent deleteUser() /
        // deleteUserFromNotify() for them can't remove them from the space mid-flight and cause
        // the invitation to be silently dropped.
        this.queueUserOperation(senderUser.spaceUserId, () => this.sendLivekitInvitationMessage(senderUser)).catch(
            (error) => {
                console.error(`Error generating token for user ${senderUser.spaceUserId} in Livekit:`, error);
                Sentry.captureException(error);
            },
        );
    }

    cleanup(): void {
        if (this.disposed) return;
        this.disposed = true;
        // finalizeSwitchMessage already retires client connections. Do not send old disconnect
        // messages that could arrive after a replacement strategy has invited the same user.
        this.streamingUsers.clear();
        this.receivingUsers.clear();
        this.usersReady.clear();
        this.createRoomPromise = null;
        this.roomLease
            ?.release(() => this.livekitService.deleteRoom(this.space.getSpaceName()))
            .catch((error) => {
                console.error("Error releasing Livekit room", error);
                Sentry.captureException(error);
            });
    }

    async startRecording(user: SpaceUser, recordingSessionId: string): Promise<RecordingStartInfo> {
        if (!this.createRoomPromise) {
            console.warn("Room not created yet");
            Sentry.captureMessage("[LivekitCommunicationStrategy] Room not created yet when starting recording");
            throw new Error("Livekit room not created yet");
        }

        await this.createRoomPromise;
        return await this.livekitService.startRecording(this.space.getSpaceName(), user, user.uuid, recordingSessionId);
    }
    async stopRecording(egressId?: string): Promise<void> {
        await this.livekitService.stopRecording(egressId);
    }

    async handleLivekitWebhook(
        rawBody: Buffer | Uint8Array,
        authorizationHeader: string | undefined,
        spaceName: string,
        recordingSessionId: string,
    ): Promise<HandleRecordingWebhookRequest | "ignored"> {
        return this.livekitService.handleLivekitWebhook(rawBody, authorizationHeader, spaceName, recordingSessionId);
    }
}
