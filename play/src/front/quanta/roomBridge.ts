// quanta: tells the platform around the room when the room first has something to show (the platform keeps a loading
// cover up until then, over the sign-in redirects) and when WA shows an error screen; the platform times joins with
// both. And the microphone's and camera's state, which the platform's minimized room can turn on and off; whether
// they are on as the user enters, from their settings; and keeps the camera on while alone; and whether something is
// open over the map (roomOverlay.ts), and whether the map is on screen at all; and hears that the platform's header shows the recording (recordingIndicator.ts).
// Only inside the platform's frame.
import { AvailabilityStatus } from "@workadventure/messages";
import { derived, get } from "svelte/store";
import { analyticsClient } from "../Administration/AnalyticsClient";
import { gameSceneIsLoadedStore } from "../Stores/GameSceneStore";
import { selectCharacterSceneVisibleStore } from "../Stores/SelectCharacterStore";
import { selectCompanionSceneVisibleStore } from "../Stores/SelectCompanionStore";
import {
    availabilityStatusStore,
    batchGetUserMediaStore,
    cameraListStore,
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
import { startCallStats } from "./callStats";
import { pageLeaving, watchPageLeave } from "./pageLeave";
import { quantaCameraAwakeStore } from "./cameraAwake";
import { roomOverlayStore } from "./roomOverlay";
import { roomControlsVisibleStore } from "./roomControlsVisible";
import { dockGuttersStore, dockSizeStore } from "./dockBar";
import { startPhoneShareFullScreen } from "./phoneShare";
import { platformShowsRecording, roomRecordingStateStore } from "./recordingIndicator";
import { fromPlatform } from "./platformOrigin";

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

// Latched from the bridge's start: a room shown before (a reconnect or a map change shows it again) counts.
let roomShown = false;

/** The user's choice from their settings, applied on arrival and again as the room first shows: WA's device check
 * (a browser's first visit) turns both on for its preview and off as it closes (quanta/joinMedia.ts). Without a
 * choice the room starts with both off. A choice that arrives after the room shows is ignored, so it never undoes
 * the user's own toggle. */
function applyJoinMedia(media: { camera: boolean; microphone: boolean }): void {
    const apply = () => {
        batchGetUserMediaStore.startBatch();
        if (media.camera) requestedCameraState.enableWebcam();
        else requestedCameraState.disableWebcam();
        if (media.microphone) requestedMicrophoneState.enableMicrophone();
        else requestedMicrophoneState.disableMicrophone();
        batchGetUserMediaStore.commitChanges();
    };
    if (roomShown) return;
    apply();
    const unsubscribe = gameSceneIsLoadedStore.subscribe((loaded) => {
        if (!loaded) return;
        apply();
        queueMicrotask(() => unsubscribe());
    });
}

export function startRoomBridge(): void {
    if (window.parent === window) return;
    const post = (message: Record<string, unknown>) => window.parent.postMessage(message, "*");
    watchPageLeave();

    quantaCameraAwakeStore.set(true);
    startPhoneShareFullScreen();

    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    gameSceneIsLoadedStore.subscribe((loaded) => {
        if (loaded) roomShown = true;
    });

    // For the stay's session report: drops of the room's connection, and the call's quality.
    startCallStats(post);

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
        // A page closing or reloading shows "Connection lost" on its way out: not one the platform should count.
        if (!error || pageLeaving()) return;
        post({ type: "quanta_wa_error", errorType: error.type, code: error.code ?? "" });
    });

    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    mediaStore.subscribe((media) => post({ type: "quanta_wa_media", ...media }));
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    roomOverlayStore.subscribe((open) => post({ type: "quanta_wa_overlay", open }));
    // Whether the map is on screen at all, not a screen of the room's own over it (the avatar or camera screen, an
    // error): the platform's handle at the edge of a chat column the room draws is not left over such a screen.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    roomControlsVisibleStore.subscribe((room) => post({ type: "quanta_wa_screen", room }));
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    dockSizeStore.subscribe((size) => {
        if (size) post({ type: "quanta_wa_dock", ...size });
    });
    let joinMediaApplied = false;
    const onMessage = (event: MessageEvent) => {
        if (event.source !== window.parent) return;
        const type = (event.data as { type?: unknown } | null)?.type;
        const media = get(mediaStore);
        if (type === "quanta_wa_join_media" && !joinMediaApplied) {
            const { camera, microphone } = event.data as { camera?: unknown; microphone?: unknown };
            if (typeof camera !== "boolean" || typeof microphone !== "boolean") return;
            joinMediaApplied = true;
            applyJoinMedia({ camera, microphone });
        } else if (type === "quanta_wa_media_request") {
            post({ type: "quanta_wa_media", ...media });
        } else if (type === "quanta_wa_toggle_microphone" && media.micUsable) {
            analyticsClient.trackAdminEvent("media.microphone.toggled");
            if (get(requestedMicrophoneState)) requestedMicrophoneState.disableMicrophone();
            else requestedMicrophoneState.enableMicrophone();
        } else if (type === "quanta_wa_dock_gutters") {
            const { left, right } = event.data as { left?: unknown; right?: unknown };
            const gutter = (value: unknown) =>
                typeof value === "number" && Number.isFinite(value) ? Math.min(Math.max(value, 0), 480) : 0;
            dockGuttersStore.set({ left: gutter(left), right: gutter(right) });
        } else if (type === "quanta_wa_recording_indicator") {
            // Only Quanta's own page may take the room's recording indicator away: any page could frame the room. It is
            // told the room's state in answer, whatever it heard before.
            if (fromPlatform(event)) {
                platformShowsRecording();
                postRecording(true);
            }
        } else if (type === "quanta_wa_toggle_camera" && media.camUsable) {
            analyticsClient.trackAdminEvent("media.camera.toggled");
            if (get(requestedCameraState)) requestedCameraState.disableWebcam();
            else requestedCameraState.enableWebcam();
        }
    };
    // eslint-disable-next-line listeners/no-missing-remove-event-listener
    window.addEventListener("message", onMessage);
    // The recording's state, from the room itself on every change: a page that heard `recording` in the hello takes
    // it from here only, never from a frame inside the room (which a website the map opens could forge).
    let lastRecording = "";
    const postRecording = (always = false) => {
        const state = get(roomRecordingStateStore);
        const key = `${state.active}|${state.paused}`;
        if (!always && key === lastRecording) return;
        lastRecording = key;
        post({ type: "quanta_wa_recording", active: state.active, paused: state.paused });
    };
    post({ type: "quanta_wa_hello", recording: true });
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    roomRecordingStateStore.subscribe(() => postRecording());
}
