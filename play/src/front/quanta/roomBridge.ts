// quanta: tells the platform around the room when the room first has something to show (the platform keeps a loading
// cover up until then, over the sign-in redirects) and when WA shows an error screen; the platform times joins with
// both. And the microphone's and camera's state, which the platform's minimized room can turn on and off; and keeps
// the camera on while alone. Only inside the platform's frame.
import { AvailabilityStatus } from "@workadventure/messages";
import { derived, get } from "svelte/store";
import { analyticsClient } from "../Administration/AnalyticsClient";
import { gameSceneIsLoadedStore } from "../Stores/GameSceneStore";
import { selectCharacterSceneVisibleStore } from "../Stores/SelectCharacterStore";
import { selectCompanionSceneVisibleStore } from "../Stores/SelectCompanionStore";
import {
    availabilityStatusStore,
    cameraListStore,
    cameraNoEnergySavingStore,
    enableCameraSceneVisibilityStore,
    microphoneListStore,
    requestedCameraState,
    requestedMicrophoneState,
    silentStore,
} from "../Stores/MediaStore";
import { loginSceneVisibleStore } from "../Stores/LoginSceneStore";
import {
    inExternalServiceStore,
    myCameraStore,
    myMicrophoneStore,
    proximityMeetingStore,
} from "../Stores/MyMediaStore";
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

// As the dock's buttons: busy, away and the like, or a silent zone, block both; no device blocks one; and a device
// the dock hides (a map script turning it off, a Jitsi or BBB meeting) is blocked too.
const BLOCKING = [
    AvailabilityStatus.BUSY,
    AvailabilityStatus.AWAY,
    AvailabilityStatus.BACK_IN_A_MOMENT,
    AvailabilityStatus.SOUND_BLOCKED,
    AvailabilityStatus.DO_NOT_DISTURB,
];
const mediaStore = derived(
    [
        requestedMicrophoneState,
        requestedCameraState,
        availabilityStatusStore,
        silentStore,
        microphoneListStore,
        cameraListStore,
        inExternalServiceStore,
        proximityMeetingStore,
        myMicrophoneStore,
        myCameraStore,
    ],
    ([$mic, $cam, $status, $silent, $microphones, $cameras, $external, $proximity, $micShown, $camShown]) => {
        const blocked = $silent || $external || BLOCKING.includes($status);
        const micUsable =
            !blocked && $proximity && $micShown && !($microphones !== undefined && $microphones.length === 0);
        const camUsable = !blocked && $camShown && !($cameras !== undefined && $cameras.length === 0);
        return { mic: $mic && micUsable, cam: $cam && camUsable, micUsable, camUsable };
    },
);

export function startRoomBridge(): void {
    if (window.parent === window) return;
    const post = (message: Record<string, unknown>) => window.parent.postMessage(message, "*");

    // In the platform the camera stays on while alone: WA's energy saving switched it off after a few still seconds
    // and back on at every move or resize, so the user's own picture kept appearing and going.
    cameraNoEnergySavingStore.set(true);

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

    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    mediaStore.subscribe((media) => post({ type: "quanta_wa_media", ...media }));
    const onMessage = (event: MessageEvent) => {
        if (event.source !== window.parent) return;
        const type = (event.data as { type?: unknown } | null)?.type;
        const media = get(mediaStore);
        if (type === "quanta_wa_media_request") {
            post({ type: "quanta_wa_media", ...media });
        } else if (type === "quanta_wa_toggle_microphone" && media.micUsable) {
            analyticsClient.trackAdminEvent("media.microphone.toggled");
            if (get(requestedMicrophoneState)) requestedMicrophoneState.disableMicrophone();
            else requestedMicrophoneState.enableMicrophone();
        } else if (type === "quanta_wa_toggle_camera" && media.camUsable) {
            analyticsClient.trackAdminEvent("media.camera.toggled");
            if (get(requestedCameraState)) requestedCameraState.disableWebcam();
            else requestedCameraState.enableWebcam();
        }
    };
    // eslint-disable-next-line listeners/no-missing-remove-event-listener
    window.addEventListener("message", onMessage);
}
