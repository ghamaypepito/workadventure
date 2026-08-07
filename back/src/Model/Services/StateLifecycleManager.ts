import * as Sentry from "@sentry/node";
import type { ICommunicationState } from "../Interfaces/ICommunicationState";
import type { IStateLifecycleManager } from "../Interfaces/IStateLifecycleManager";
import type { ICommunicationStrategy } from "../Interfaces/ICommunicationStrategy";

/**
 * Manages the lifecycle of communication states.
 *
 * Responsibilities:
 * - Maintain the current active state
 * - Handle state transitions with proper initialization
 * - Manage deferred finalization of previous states
 * - Dispatch switch events to users
 */
export class StateLifecycleManager implements IStateLifecycleManager {
    private _currentState: ICommunicationState<ICommunicationStrategy>;
    private _toFinalizeState: ICommunicationState<ICommunicationStrategy> | undefined;
    private _finalizeStateTimeout: ReturnType<typeof setTimeout> | undefined;

    /**
     * Creates a new StateLifecycleManager with an initial state.
     *
     * @param initialState - The initial communication state
     * @param finalizeDelayMs - Delay before finalizing previous state (default: 5000ms)
     */
    constructor(
        initialState: ICommunicationState<ICommunicationStrategy>,
        private readonly finalizeDelayMs: number = 5000,
    ) {
        this._currentState = initialState;
    }

    /**
     * Returns the current active communication state.
     */
    getCurrentState(): ICommunicationState<ICommunicationStrategy> {
        return this._currentState;
    }

    /**
     * Transitions to a new state.
     *
     * Process:
     * 1. If there's a pending state to finalize, finalize it immediately
     * 2. Mark the current state as pending finalization
     * 3. Set the new state as current
     * 4. Dispatch switch events from the old state
     * 5. Initialize the new state
     * 6. Schedule deferred finalization of the old state
     */
    async transitionTo(newState: ICommunicationState<ICommunicationStrategy>): Promise<void> {
        // Finalize any previously pending state immediately
        if (this._toFinalizeState) {
            this.finalizeState(this._toFinalizeState);
            this.clearFinalizeTimeout();
        }

        // Move current state to pending finalization
        this._toFinalizeState = this._currentState;
        this._currentState = newState;

        // Dispatch switch event to all users through the old state
        this._toFinalizeState.switchState(newState.communicationType);

        // Initialize the new state after dispatching switch event
        // This ensures clients are ready before the new state starts working
        await newState.init();

        // Schedule deferred finalization
        this._finalizeStateTimeout = setTimeout(() => {
            if (this._toFinalizeState) {
                try {
                    this.finalizeState(this._toFinalizeState);
                } catch (error) {
                    console.error("Error while finalizing state:", error);
                    Sentry.captureException(error);
                }
            }
            this._finalizeStateTimeout = undefined;
            this._toFinalizeState = undefined;
        }, this.finalizeDelayMs);
    }

    /**
     * Dispatches a switch event from the current state.
     * Used when notifying users of the current state type without transitioning.
     */
    dispatchSwitchEvent(targetCommunicationType: string): void {
        this._currentState.switchState(targetCommunicationType);
    }

    /**
     * Disposes of all resources (timeouts) and finalizes both the pending and the current state.
     *
     * The current state also needs finalizing here, not just the pending one: dispose() is what
     * runs when the whole space is torn down (see CommunicationManager.destroy()), and in the
     * common case - no transition in flight - _toFinalizeState is undefined and _currentState is
     * the only state there is. Leaving it un-finalized skips its strategy's cleanup() (for
     * LivekitCommunicationStrategy: deleting the LiveKit room and disconnecting every registered
     * user), which is the same class of leak fixed in AbstractCommunicationState.finalize() - just
     * via space teardown instead of a state transition.
     */
    dispose(): void {
        // Finalize pending state if exists
        if (this._toFinalizeState) {
            try {
                this.finalizeState(this._toFinalizeState);
            } catch (error) {
                console.error("Error while finalizing state during dispose:", error);
                Sentry.captureException(error);
            }
            this._toFinalizeState = undefined;
        }

        try {
            this.finalizeState(this._currentState);
        } catch (error) {
            console.error("Error while finalizing current state during dispose:", error);
            Sentry.captureException(error);
        }

        this.clearFinalizeTimeout();
    }

    /**
     * Checks if there's a state pending finalization.
     */
    hasPendingFinalization(): boolean {
        return this._toFinalizeState !== undefined;
    }

    /**
     * Finalizes a state.
     */
    private finalizeState(state: ICommunicationState<ICommunicationStrategy>): void {
        state.finalize();
    }

    /**
     * Clears the finalization timeout.
     */
    private clearFinalizeTimeout(): void {
        if (this._finalizeStateTimeout) {
            clearTimeout(this._finalizeStateTimeout);
            this._finalizeStateTimeout = undefined;
        }
    }
}
