// quanta: tells the platform around the room when the room first has something to show (the platform keeps a loading
// cover up until then, over the sign-in redirects) and when WA shows an error screen; the platform times joins with
// both. Only inside the platform's frame.
import { derived } from "svelte/store";
import { gameSceneIsLoadedStore } from "../Stores/GameSceneStore";
import { selectCharacterSceneVisibleStore } from "../Stores/SelectCharacterStore";
import { selectCompanionSceneVisibleStore } from "../Stores/SelectCompanionStore";
import { enableCameraSceneVisibilityStore } from "../Stores/MediaStore";
import { loginSceneVisibleStore } from "../Stores/LoginSceneStore";
import { errorScreenStore } from "../Stores/ErrorScreenStore";

const firstScreenStore = derived(
    [
        gameSceneIsLoadedStore,
        enableCameraSceneVisibilityStore,
        selectCharacterSceneVisibleStore,
        selectCompanionSceneVisibleStore,
        loginSceneVisibleStore,
    ],
    ([$game, $camera, $character, $companion, $login]) =>
        $game ? "room" : $camera ? "camera" : $character || $companion ? "character" : $login ? "login" : undefined,
);

export function startRoomBridge(): void {
    if (window.parent === window) return;
    const post = (message: Record<string, unknown>) => window.parent.postMessage(message, "*");

    let ready = false;
    // Singletons for the page's lifetime, like the stores they read.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    firstScreenStore.subscribe((screen) => {
        if (!screen || ready) return;
        ready = true;
        post({ type: "quanta_wa_ready", screen });
    });
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    errorScreenStore.subscribe((error) => {
        if (!error) return;
        post({ type: "quanta_wa_error", errorType: error.type, code: error.code ?? "" });
    });
}
