import * as Sentry from "@sentry/svelte";
import { get } from "svelte/store";
import type { CancelablePromise } from "cancelable-promise";
import {
    AskPositionMessage_AskType,
    AvailabilityStatus,
    type PositionMessage,
    type PositionMessage_Direction,
    type SayMessage,
} from "@workadventure/messages";
import type { WokaMenuAction } from "../../Stores/WokaMenuStore";
import { wokaMenuStore } from "../../Stores/WokaMenuStore";
import { Character } from "../Entity/Character";
import type { GameScene } from "../Game/GameScene";
import { WOKA_SPEED } from "../../Enum/EnvironmentVariable";
import type { ActivatableInterface } from "../Game/ActivatableInterface";
import { LL } from "../../../i18n/i18n-svelte";
import { blackListManager } from "../../WebRtc/BlackListManager";
import { iframeListener } from "../../Api/IframeListener";
import { openDirectChatRoom } from "../../Chat/Utils";
import chat from "../../Components/images/chat.png";
import { userIsConnected } from "../../Stores/MenuStore";
import RequiresLoginForChatModal from "../../Chat/Components/RequiresLoginForChatModal.svelte";
import { analyticsClient } from "../../Administration/AnalyticsClient";
import { hoverPreviewStore } from "../../Stores/HoverPreviewStore";
import { IconCamera, IconUserPlus, IconBellRinging, IconHandStop } from "@wa-icons";
import { modals } from "@wa-modals";

export enum RemotePlayerEvent {
    Clicked = "Clicked",
}

/**
 * Class representing the sprite of a remote player (a player that plays on another computer)
 */
export class RemotePlayer extends Character implements ActivatableInterface {
    public readonly userId: number;
    public readonly userUuid: string;
    public readonly activationRadius: number;

    private visitCardUrl: string | null;
    private pathFollowingUpdateCallback: (time: number, delta: number) => void;
    private hoverTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        userId: number,
        userUuid: string,
        Scene: GameScene,
        x: number,
        y: number,
        name: string,
        texturesPromise: CancelablePromise<string[]>,
        direction: PositionMessage_Direction,
        moving: boolean,
        visitCardUrl: string | null,
        companionTexturePromise: CancelablePromise<string> | undefined,
        activationRadius?: number,
        private chatID: string | undefined = undefined,
        sayMessage?: SayMessage,
    ) {
        super(Scene, x, y, texturesPromise, name, direction, moving, 1, true, companionTexturePromise);

        //set data
        this.userId = userId;
        this.userUuid = userUuid;
        this.visitCardUrl = visitCardUrl;
        this.setClickable(this.getDefaultWokaMenuActions().length > 0);
        this.activationRadius = activationRadius ?? 76;

        if (sayMessage) {
            this.say(sayMessage.message, sayMessage.type);
        }

        this.bindEventHandlers();
        this.pathFollowingUpdateCallback = (_time: number, delta: number) => this.followPath(delta);
    }

    public updatePosition(position: PositionMessage): void {
        this.stopMoveTo();
        this.playAnimation(position.direction, position.moving);
        this.setPosition(position.x, position.y);

        if (this.companion) {
            this.companion.setTarget(position.x, position.y, position.direction);
        }
    }

    /**
     * Move to a position using pathfinding (same logic as GameScene.moveTo).
     * Uses the PathfindingManager to find a path and follows it with proper walking animation.
     * Named moveToPosition to avoid conflict with Phaser Container.moveTo.
     * @param position Target position in game pixels
     * @param tryFindingNearestAvailable If true, finds nearest available tile when exact target is blocked
     * @param speed Walking speed (default: WOKA_SPEED)
     * @returns Promise that resolves with final position and whether the move was cancelled
     */
    public async moveToPosition(
        position: { x: number; y: number },
        tryFindingNearestAvailable = false,
        speed: number | undefined = undefined,
    ): Promise<{ x: number; y: number; cancelled: boolean }> {
        this.stopMoveTo();

        const gameScene = this.scene;
        const path = await gameScene
            .getPathfindingManager()
            .findPathFromGameCoordinates({ x: this.x, y: this.y }, position, tryFindingNearestAvailable);

        if (path.length === 0) {
            throw new Error("No path found");
        }

        const pathFollowingPromise = this.setPathToFollow(path, speed ?? WOKA_SPEED);
        this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.pathFollowingUpdateCallback);
        return pathFollowingPromise;
    }

    /**
     * Stop any ongoing moveTo.
     */
    public stopMoveTo(): void {
        if (this.isFollowingPath()) {
            this.finishFollowingPath(true);
        }
    }

    public finishFollowingPath(cancelled = false): void {
        super.finishFollowingPath(cancelled);
        this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.pathFollowingUpdateCallback);
        this.scene.markDirty();
    }

    public getVisitCardUrl(): string | null {
        return this.visitCardUrl;
    }

    public setChatID(chatID: string | undefined): void {
        this.chatID = chatID;
        this.setClickable(this.getDefaultWokaMenuActions().length > 0);
    }

    public registerWokaMenuAction(action: WokaMenuAction): void {
        wokaMenuStore.addAction({
            ...action,
            priority: action.priority ?? 0,
            callback: () => {
                action.callback();
                wokaMenuStore.removeRemotePlayer(this.userUuid);
            },
        });
    }

    public unregisterWokaMenuAction(actionName: string) {
        wokaMenuStore.removeAction(actionName);
    }

    public activate(): void {
        this.toggleActionsMenu();
    }

    public deactivate(): void {
        wokaMenuStore.removeRemotePlayer(this.userUuid);
    }

    public destroy(): void {
        if (this.hoverTimer) {
            clearTimeout(this.hoverTimer);
            this.hoverTimer = undefined;
        }
        // Defensive: if this player is removed from the scene (e.g. they disconnect) while their
        // hover-preview is showing, POINTER_OUT may never fire (nothing moved the mouse), which
        // would otherwise leave a permanently stale popup pointing at a player who no longer exists.
        hoverPreviewStore.update((current) => (current?.userId === this.userId ? undefined : current));
        this.stopMoveTo();
        wokaMenuStore.removeRemotePlayer(this.userUuid);
        super.destroy();
    }

    public isActivatable(): boolean {
        return this.isClickable();
    }

    private toggleActionsMenu(): void {
        // This runs on click, via activate() (see ActivatableInterface). For a RemotePlayer that is
        // actually triggered on POINTER_UP, not POINTER_DOWN: GameSceneUserInputHandler.handlePointerUpEvent()
        // calls ActivatablesManager.handlePointerDownEvent(object) (confusingly named - it's invoked from
        // the pointer-*up* handler) -> object.activate() -> toggleActionsMenu(). The object-level
        // POINTER_DOWN handler in bindEventHandlers() below only emits RemotePlayerEvent.Clicked, which
        // nothing currently subscribes to - it does not open this menu.
        //
        // Click always wins over hover: cancel any pending dwell timer (so a click released before the
        // 300ms hover dwell elapses can't pop the hover preview up afterwards, on top of the click-popup
        // we're about to open) and clear any hover preview already showing. Since activation fires on
        // mouse-up, this only needs to race against dwell times up to how long the mouse was held down -
        // in practice always well inside the 300ms window for an ordinary click. One narrow, low-impact
        // edge case: holding the mouse button down for >300ms before releasing over the hovered player
        // lets the hover popup actually render while the button is held (the dwell timer isn't gated on
        // mouse-button state), then get cleared synchronously the instant this method runs on release -
        // a brief flash-then-replace, not true coexistence with the click-popup.
        if (this.hoverTimer) {
            clearTimeout(this.hoverTimer);
            this.hoverTimer = undefined;
        }
        hoverPreviewStore.set(undefined);

        // Track the open woka menu action
        analyticsClient.openWokaMenu();

        // Close the woka menu if it is already open by the same remote player
        const wokaMenuStoreValue = get(wokaMenuStore);
        if (
            wokaMenuStoreValue?.userUuid !== undefined &&
            wokaMenuStoreValue.userUuid !== "" &&
            wokaMenuStoreValue.userUuid === this.userUuid
        ) {
            wokaMenuStore.removeRemotePlayer(this.userUuid);
            return;
        }

        // Initialize the woka menu
        wokaMenuStore.initialize(this.playerName, this.userId, this.userUuid, this.visitCardUrl ?? undefined);

        // Add the default actions to the woka menu
        for (const action of this.getDefaultWokaMenuActions()) {
            wokaMenuStore.addAction(action);
        }

        // Send the remote player clicked event to the iframe listener
        const userFound = this.scene.getRemotePlayersRepository().getPlayers().get(this.userId);
        if (!userFound) {
            console.error("Undefined clicked player!");
            return;
        }

        // Send the remote player clicked event to the iframe listener
        iframeListener.sendRemotePlayerClickedEvent(userFound);
    }

    private getDefaultWokaMenuActions(): WokaMenuAction[] {
        const actions: WokaMenuAction[] = [];
        if (!blackListManager.isBlackListed(this.userUuid)) {
            actions.push({
                actionName: "Go to Desk",
                protected: false,
                priority: 1,
                style: "bg-white/10 hover:bg-white/30",
                callback: () => {
                    // Track the talk to user action
                    analyticsClient.goToUser();

                    if (this.scene.connection != undefined)
                        this.scene.connection.emitAskPosition(
                            this.userUuid,
                            this.scene.roomUrl,
                            AskPositionMessage_AskType.MOVE,
                            this.userId,
                        );
                },
                actionIcon: IconCamera,
            });
        }
        if (this.chatID != undefined) {
            actions.push({
                actionName: get(LL).chat.userList.sendMessage(),
                protected: false,
                priority: 2,
                style: "bg-white/10 hover:bg-white/30",
                callback: () => {
                    // Track the opened chat action
                    analyticsClient.openedChat();

                    if (!get(userIsConnected)) {
                        modals.open(RequiresLoginForChatModal);
                        return;
                    }

                    openDirectChatRoom(this.chatID!).catch((error) => {
                        console.error("Error opening direct chat room:", error);
                        Sentry.captureException(error, {
                            extra: {
                                userId: this.userUuid,
                                chatId: this.chatID!,
                                playUri: this.scene.roomUrl,
                                username: this.playerName,
                            },
                        });
                    });
                },
                actionIcon: chat,
            });
        }
        // Wave: sends a lightweight targeted signal (toast + chat-history line) to this player,
        // over the persistent connection by uuid - reaches them anywhere on the map, not just
        // while sharing a proximity space.
        actions.push({
            actionName: get(LL).chat.socialSignal.wave(),
            protected: false,
            priority: 4,
            style: "bg-white/10 hover:bg-white/30",
            callback: () => {
                this.scene.inviteManager?.requestSocialSignal("wave", this.userUuid, this.playerName, this.userId);
            },
            actionIcon: IconHandStop,
        });

        // Ping (bell): only offered when the target is currently Busy / Do Not Disturb.
        const remotePlayerStatus = this.scene.getRemotePlayersRepository().getPlayers().get(this.userId)
            ?.availabilityStatus;
        if (
            remotePlayerStatus === AvailabilityStatus.BUSY ||
            remotePlayerStatus === AvailabilityStatus.DO_NOT_DISTURB
        ) {
            actions.push({
                actionName: get(LL).chat.socialSignal.ping(),
                protected: false,
                priority: 4,
                style: "bg-white/10 hover:bg-white/30",
                callback: () => {
                    // Uses the dedicated UUID-targeted backend message (not the proximity space
                    // broadcast channel generic proximity chat uses) because going Busy/DND itself
                    // tears down the recipient's proximity space membership server-side.
                    this.scene.inviteManager?.requestSocialSignal("ping", this.userUuid, this.playerName, this.userId);
                },
                actionIcon: IconBellRinging,
            });
        }

        // Add new action invite user to meet me
        actions.push({
            actionName: get(LL).chat.userList.invite(),
            protected: false,
            priority: 3,
            style: "bg-white/10 hover:bg-white/30",
            callback: () => {
                const sent = this.scene.inviteManager?.requestMeetingInvitation(this.userUuid, this.userId);
                if (sent) {
                    try {
                        this.scene.playMeetingInviteSound();
                    } catch (error) {
                        Sentry.captureException(error);
                    }
                }
            },
            actionIcon: IconUserPlus,
        });

        return actions;
    }

    private bindEventHandlers(): void {
        // Note: this object-level POINTER_DOWN only emits RemotePlayerEvent.Clicked (currently
        // unused by anything). It does NOT open the click-popup - that happens via activate() /
        // toggleActionsMenu(), invoked on POINTER_UP instead (see the comment there for the real
        // pipeline). Don't confuse this handler with what "click always wins" races against.
        this.on(Phaser.Input.Events.POINTER_DOWN, (event: Phaser.Input.Pointer) => {
            if (event.downElement.nodeName === "CANVAS" && event.leftButtonDown()) {
                this.emit(RemotePlayerEvent.Clicked);
            }
        });

        // Hover-preview: a compact Wave/Message popup shown after a short dwell, so a cursor
        // just passing over someone on the way elsewhere doesn't pop something up (the same
        // fly-by-click lesson from the fullscreen-exit dwell guard elsewhere in this app).
        this.on(Phaser.Input.Events.POINTER_OVER, () => {
            // Re-entering the sprite (e.g. cursor wobbles back onto the woka on its way to the
            // card) should cancel any pending clear from a just-fired POINTER_OUT, same as the
            // card itself does in PersonHoverPreview.svelte.
            hoverPreviewStore.cancelClear();
            this.hoverTimer = setTimeout(() => {
                this.hoverTimer = undefined;
                const player = this.scene.getRemotePlayersRepository().getPlayers().get(this.userId);
                const { x: screenX, y: screenY } = this.getScreenPosition();
                hoverPreviewStore.set({
                    userId: this.userId,
                    userUuid: this.userUuid,
                    name: this.playerName,
                    availabilityStatus: player?.availabilityStatus ?? AvailabilityStatus.UNCHANGED,
                    customStatusMessage: player?.customStatusMessage,
                    screenX,
                    screenY,
                });
            }, 300);
        });

        this.on(Phaser.Input.Events.POINTER_OUT, () => {
            if (this.hoverTimer) {
                clearTimeout(this.hoverTimer);
                this.hoverTimer = undefined;
            }
            // Grace period, not an immediate clear: the card floats above the sprite, not over it,
            // so leaving the sprite is the expected first step of the cursor travelling up to the
            // card - see the comment on scheduleClear() in HoverPreviewStore.ts.
            hoverPreviewStore.scheduleClear(this.userId);
        });
    }

    /**
     * Converts this player's world position to CSS/browser pixels, for positioning `position: fixed`
     * DOM overlays (like the hover preview) above their head.
     *
     * Two separate corrections are needed on top of a plain `(x - cam.scrollX) * cam.zoom`:
     *
     * 1. That formula is only correct when `cam.zoom === 1`. Phaser's real camera transform
     *    (Camera.preRender() building its matrix via applyITRS() then translate(-originX, -originY),
     *    in node_modules/phaser/src/cameras/2d/Camera.js) works out to:
     *        bufferX = (worldX - scrollX) * zoomX + originX * (1 - zoomX)
     *    (and the same for Y), where `originX = cam.width * cam.originX` (camera origin, default
     *    center, i.e. width/2). The `(x - scrollX) * zoom` term is only PART of this - there's an
     *    additive offset around the camera's origin that only vanishes when zoom is exactly 1. E.g.
     *    with cam.width=800, zoom=0.5, worldX-scrollX=50: correct bufferX = 50*0.5 + 400*0.5 = 225,
     *    not 25. Since this app's camera zooms out via an ordinary mouse-wheel action (see
     *    WaScaleManager.applyNewSize()'s camera-zoom branch), zoom !== 1 is a steady, common state,
     *    not a rare edge case.
     *
     *    We reproduce this with Phaser's own TransformMatrix primitives (applyITRS + translate +
     *    transformPoint) rather than hand-rolling the closed-form algebra, so this stays correct even
     *    if Phaser's camera math changes, and so it also covers non-uniform zoom for free (rotation is
     *    passed as a literal 0 below - see the comment at that call site for why).
     *    This is the same math Utils/E2EHooks.ts's getGameToBrowserCoordinatesSnapshot relies on for
     *    verified-correct coordinate conversion - but we build an equivalent matrix from the camera's
     *    public scroll/zoom/origin properties instead of reading the camera's own `matrix` field.
     *    Reading that field the way E2EHooks.ts does requires calling the protected `camera.preRender()`
     *    first to guarantee it's not a frame stale; calling that manually here would also re-run its
     *    follow/lerp step and re-emit `followupdate`, which CameraManager forwards into
     *    GameScene.sendViewportToServer() - firing an unwanted extra network call on every hover. Our
     *    manually-built matrix produces the identical transform without that side effect.
     *
     * 2. WaScaleManager separately scales the actual `<canvas>` element (for HDPI screens, and in one
     *    of its two sizing branches, for the gameplay zoom too - see WaScaleManager.applyNewSize), so
     *    the camera's render-target pixel space and the canvas's on-screen CSS pixel space can still
     *    differ (most commonly by devicePixelRatio, e.g. 2x on a Retina display) even after (1) is
     *    correct. We map the render-target point onto the canvas's actual on-screen rect to correct
     *    for this, same as E2EHooks.ts does.
     */
    private getScreenPosition(): { x: number; y: number } {
        const cam = this.scene.cameras.main;
        const canvas = this.scene.game.canvas;
        const canvasRect = canvas.getBoundingClientRect();

        const originX = cam.width * cam.originX;
        const originY = cam.height * cam.originY;
        // Rotation is hardcoded to 0 rather than read from `cam.rotation`: this app never rotates its
        // camera (no .rotation/.setAngle/.setRotation call anywhere in CameraManager.ts), and the
        // installed Phaser version's shipped type declarations don't expose `rotation` on
        // Camera/BaseCamera at all (it exists at runtime - see BaseCamera.js - but svelte-check's
        // checker flags `cam.rotation` as TS2339 even though a plain `tsc --noEmit` run over this
        // project does not; treating svelte-check, the project's actual gate, as authoritative here
        // rather than reaching for an `as` cast to punch through a real gap in Phaser's own types).
        const matrix = new Phaser.GameObjects.Components.TransformMatrix();
        matrix.applyITRS(cam.x + originX, cam.y + originY, 0, cam.zoomX, cam.zoomY);
        matrix.translate(-originX, -originY);
        const bufferPoint = matrix.transformPoint(this.x - cam.scrollX, this.y - cam.scrollY);

        const scaleX = canvasRect.width / (canvas.width || cam.width);
        const scaleY = canvasRect.height / (canvas.height || cam.height);
        return {
            x: canvasRect.left + bufferPoint.x * scaleX,
            y: canvasRect.top + bufferPoint.y * scaleY,
        };
    }
}
