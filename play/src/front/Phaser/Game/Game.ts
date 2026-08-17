/* eslint-disable @typescript-eslint/ban-ts-comment */
import { SKIP_RENDER_OPTIMIZATIONS } from "../../Enum/EnvironmentVariable";
import { ResizableScene } from "../Login/ResizableScene";
import { chatVisibilityStore } from "../../Stores/ChatStore";

const Events = Phaser.Core.Events;

// While the chat panel is open, the user's attention (and the main thread) is on the chat UI,
// not the game canvas - throttling the (otherwise continuous, up-to-60fps) WebGL render pass to
// roughly this often instead frees up meaningful CPU time for the chat panel to open/update
// smoothly, without touching scene.update() below (game logic - player positions, etc. - still
// runs every frame at full rate, so nothing becomes stale or desyncs; only how often that state
// gets visually redrawn to the canvas is reduced).
const CHAT_OPEN_RENDER_THROTTLE_MS = 100;

/**
 * A specialization of the main Phaser Game scene.
 * It comes with an optimization to skip rendering.
 *
 * Beware, the "step" function might vary in future versions of Phaser.
 *
 * It also automatically calls "onResize" on any scenes extending ResizableScene.
 */
export class Game extends Phaser.Game {
    private _isDirty = false;
    private isChatVisible = false;
    private lastRenderTime = 0;
    private chatVisibilityStoreUnsubscribe: () => void;

    constructor(GameConfig: Phaser.Types.Core.GameConfig) {
        super(GameConfig);

        // TEMP DIAGNOSTIC (2026-08-18): reports of the whole game canvas going black during
        // a call, only recoverable via a full app restart - the game has no handling at all
        // for its own WebGL context being lost, so if this fires, that's the direct cause.
        // Remove once confirmed.
        this.canvas.addEventListener("webglcontextlost", this.handleWebGlContextLost);
        this.canvas.addEventListener("webglcontextrestored", this.handleWebGlContextRestored);

        this.scale.on(Phaser.Scale.Events.RESIZE, () => {
            for (const scene of this.scene.getScenes(true)) {
                if (scene instanceof ResizableScene) {
                    scene.onResize();
                }
            }
        });

        this.chatVisibilityStoreUnsubscribe = chatVisibilityStore.subscribe((visible) => {
            this.isChatVisible = visible;
        });
    }

    private readonly handleWebGlContextLost = (event: Event): void => {
        console.error("[webgl-context-diag] main game canvas lost its WebGL context", event);
    };

    private readonly handleWebGlContextRestored = (): void => {
        console.info("[webgl-context-diag] main game canvas WebGL context restored");
    };

    public destroy(removeCanvas: boolean, noReturn?: boolean): void {
        this.canvas.removeEventListener("webglcontextlost", this.handleWebGlContextLost);
        this.canvas.removeEventListener("webglcontextrestored", this.handleWebGlContextRestored);
        this.chatVisibilityStoreUnsubscribe();
        super.destroy(removeCanvas, noReturn);
    }

    public step(time: number, delta: number) {
        // @ts-ignore
        if (this.pendingDestroy) {
            // @ts-ignore
            return this.runDestroy();
        }

        // An uncaught exception anywhere in this method (scene update, a plugin, a tween
        // callback, ...) used to propagate straight out of Phaser's requestAnimationFrame
        // loop with nothing catching it - which doesn't just skip a frame, it kills the loop
        // outright, permanently freezing the whole game (movement, clicks, rendering) until
        // the page is reloaded. One such bug (a fade tween racing a sound's own destroy) hit
        // production on 2026-08-18. Catching here means a future bug like that drops a frame
        // and gets logged instead of taking the whole game down.
        try {
            this.stepInternal(time, delta);
        } catch (e) {
            console.error("[game-step-diag] uncaught error in Game.step(), frame skipped:", e);
        }
    }

    private stepInternal(time: number, delta: number) {
        const eventEmitter = this.events;

        //  Global Managers like Input and Sound update in the prestep

        eventEmitter.emit(Events.PRE_STEP, time, delta);

        //  This is mostly meant for user-land code and plugins

        eventEmitter.emit(Events.STEP, time, delta);

        //  Update the Scene Manager and all active Scenes

        this.scene.update(time, delta);

        //  Our final event before rendering starts

        eventEmitter.emit(Events.POST_STEP, time, delta);

        // Skip the (expensive) render pass if we're deliberately throttling it while the chat
        // panel is open (see CHAT_OPEN_RENDER_THROTTLE_MS above) - scene.update() already ran
        // above regardless, so game state itself stays fully live either way.
        if (this.isChatVisible && time - this.lastRenderTime < CHAT_OPEN_RENDER_THROTTLE_MS) {
            // @ts-ignore
            this.scene.isProcessing = false;
            return;
        }

        // This "if" is the changed introduced by the new "Game" class to avoid rendering unnecessarily.
        if (SKIP_RENDER_OPTIMIZATIONS || this.isDirty()) {
            this.lastRenderTime = time;
            const renderer = this.renderer;

            //  Run the Pre-render (clearing the canvas, setting background colors, etc)

            renderer.preRender();

            eventEmitter.emit(Events.PRE_RENDER, renderer, time, delta);

            //  The main render loop. Iterates all Scenes and all Cameras in those scenes, rendering to the renderer instance.

            this.scene.render(renderer);

            //  The Post-Render call. Tidies up loose end, takes snapshots, etc.

            renderer.postRender();

            //  The final event before the step repeats. Your last chance to do anything to the canvas before it all starts again.

            eventEmitter.emit(Events.POST_RENDER, renderer, time, delta);
        } else {
            // @ts-ignore
            this.scene.isProcessing = false;
        }
    }

    private isDirty(): boolean {
        if (this._isDirty) {
            this._isDirty = false;
            return true;
        }

        //  Loop through the scenes in forward order
        for (let i = 0; i < this.scene.scenes.length; i++) {
            const scene = this.scene.scenes[i];
            const sys = scene.sys;

            if (
                sys.settings.visible &&
                sys.settings.status >= Phaser.Scenes.LOADING &&
                sys.settings.status < Phaser.Scenes.SLEEPING
            ) {
                // @ts-ignore
                if (typeof scene.isDirty === "function") {
                    // @ts-ignore
                    const isDirty = scene.isDirty() || scene.tweens.getTweens().length > 0;
                    if (isDirty) {
                        return true;
                    }
                } else {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Marks the game as needing to be redrawn.
     */
    public markDirty(): void {
        this._isDirty = true;
    }

    /**
     * Return the first scene found in the game
     */
    public findAnyScene(): Phaser.Scene {
        return this.scene.getScenes()[0];
    }
}
