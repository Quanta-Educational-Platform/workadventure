import { get, writable } from "svelte/store";
import HelpCameraSettingsPopup from "../Components/HelpSettings/HelpCameraSettingsPopup.svelte";
import { QUANTA_UI } from "../Enum/EnvironmentVariable";
import { mediaPermissionDeniedStore } from "./MediaStatusStore";
import { popupStore } from "./PopupStore";

const HELP_CAMERA_SETTINGS_POPUP_ID = "cameraAccessDenied";

function hasMediaPermissionDenied() {
    const mediaPermissionDenied = get(mediaPermissionDeniedStore);
    return mediaPermissionDenied.camera || mediaPermissionDenied.microphone;
}

export function showHelpCameraSettings() {
    if (!hasMediaPermissionDenied()) {
        return;
    }

    popupStore.addPopup(HelpCameraSettingsPopup, {}, HELP_CAMERA_SETTINGS_POPUP_ID);
}

export function hideHelpCameraSettings() {
    // quanta: a stream with only the allowed device still leaves the blocked one to explain (blockedDevices.ts).
    if (QUANTA_UI && hasMediaPermissionDenied()) return;
    popupStore.removePopup(HELP_CAMERA_SETTINGS_POPUP_ID);
}

// It is ok to not unsubscribe to this store because it is a singleton.
// eslint-disable-next-line svelte/no-ignored-unsubscribe
mediaPermissionDeniedStore.subscribe((mediaPermissionDenied) => {
    // quanta: blockedDevices.ts shows it only for a device the person wants.
    if (QUANTA_UI) return;
    if (mediaPermissionDenied.camera || mediaPermissionDenied.microphone) {
        popupStore.addPopup(HelpCameraSettingsPopup, {}, HELP_CAMERA_SETTINGS_POPUP_ID);
        return;
    }

    hideHelpCameraSettings();
});

export const helpWebRtcSettingsVisibleStore = writable<"pending" | "error" | "hidden">("hidden");
export const helpNotificationSettingsVisibleStore = writable(false);
