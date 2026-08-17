import { derived, writable } from "svelte/store";
import { menuInputFocusStore } from "./MenuInputFocusStore";
import { chatInputFocusStore } from "./ChatStore";
import { showReportScreenStore, userReportEmpty } from "./ShowReportScreenStore";
import { emoteMenuStore } from "./EmoteStore";
import { refreshPromptStore } from "./RefreshPromptStore";
import { mapDeletedPromptStore } from "./MapDeletedPromptStore";

export const inputFormFocusStore = writable(false);

export const mapExplorerSearchinputFocusStore = writable(false);

//derived from the focus on Menu, ConsoleGlobal, Chat and ...
export const enableUserInputsStore = derived(
    [
        menuInputFocusStore,
        chatInputFocusStore,
        showReportScreenStore,
        inputFormFocusStore,
        mapExplorerSearchinputFocusStore,
        emoteMenuStore,
        refreshPromptStore,
        mapDeletedPromptStore,
    ],
    ([
        $menuInputFocusStore,
        $chatInputFocusStore,
        $showReportScreenStore,
        $inputFormFocusStore,
        $mapExplorerSearchinputFocusStore,
        $emoteMenuStore,
        $refreshPromptStore,
        $mapDeletedPromptStore,
    ]) => {
        const enabled =
            !$menuInputFocusStore &&
            !$chatInputFocusStore &&
            !($showReportScreenStore !== userReportEmpty) &&
            !$inputFormFocusStore &&
            !$mapExplorerSearchinputFocusStore &&
            !$emoteMenuStore &&
            !$refreshPromptStore &&
            !$mapDeletedPromptStore;

        // TEMP DIAGNOSTIC (2026-08-18): reports of movement (keyboard + mouse) becoming
        // completely unresponsive after leaving a proximity bubble, only recoverable via
        // a full app restart. Logging exactly which flag is blocking input, since any one
        // of these staying stuck "true" would produce this symptom. Remove once confirmed.
        if (!enabled) {
            const blockedBy = [
                $menuInputFocusStore && "menuInputFocusStore",
                $chatInputFocusStore && "chatInputFocusStore",
                $showReportScreenStore !== userReportEmpty && "showReportScreenStore",
                $inputFormFocusStore && "inputFormFocusStore",
                $mapExplorerSearchinputFocusStore && "mapExplorerSearchinputFocusStore",
                $emoteMenuStore && "emoteMenuStore",
                $refreshPromptStore && "refreshPromptStore",
                $mapDeletedPromptStore && "mapDeletedPromptStore",
            ].filter(Boolean);
            console.info(`[user-input-diag] inputs disabled by: ${blockedBy.join(", ")}`);
        }

        return enabled;
    },
);
