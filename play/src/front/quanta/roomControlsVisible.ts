// quanta: whether the room itself is on screen, under the same conditions GameOverlay.svelte shows the room's UI
// (MainLayout): no error screen or dialog, no entry screen, no deleted-map prompt, the scene loaded and no loader.
// The docked controls live outside that overlay (App.svelte), so they follow this instead.
import { derived } from "svelte/store";
import { errorStore } from "../Stores/ErrorStore";
import { errorScreenStore } from "../Stores/ErrorScreenStore";
import { loginSceneVisibleStore } from "../Stores/LoginSceneStore";
import { enableCameraSceneVisibilityStore } from "../Stores/MediaStore";
import { selectCharacterSceneVisibleStore } from "../Stores/SelectCharacterStore";
import { selectCompanionSceneVisibleStore } from "../Stores/SelectCompanionStore";
import { gameSceneIsLoadedStore } from "../Stores/GameSceneStore";
import { pwaInstallSceneVisibleStore } from "../Stores/PwaInstallStore";
import { mapDeletedPromptStore } from "../Stores/MapDeletedPromptStore";
import { loaderVisibleStore } from "../Stores/LoaderStore";

export const roomControlsVisibleStore = derived(
    [
        errorScreenStore,
        errorStore,
        loginSceneVisibleStore,
        selectCharacterSceneVisibleStore,
        selectCompanionSceneVisibleStore,
        enableCameraSceneVisibilityStore,
        pwaInstallSceneVisibleStore,
        mapDeletedPromptStore,
        gameSceneIsLoadedStore,
        loaderVisibleStore,
    ],
    ([$errorScreen, $errors, $login, $character, $companion, $camera, $pwa, $mapDeleted, $gameSceneLoaded, $loader]) =>
        $errorScreen === undefined &&
        $errors.length === 0 &&
        !$login &&
        !$character &&
        !$companion &&
        !$camera &&
        !$pwa &&
        !$mapDeleted &&
        $gameSceneLoaded &&
        !$loader,
);
