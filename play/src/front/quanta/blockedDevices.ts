// quanta: the camera and microphone help shows only for a device the person wants and the browser blocks, and the
// room picks the device up again as soon as the browser allows it, with no reload.
// MediaStore imports the help's own store, so its stores are handed over at start rather than imported here.
import type { Readable } from "svelte/store";
import { derived, get, writable } from "svelte/store";
import type { WorkAdventureComponent } from "../../types/component";
import { cameraPermissionStateStore, microphonePermissionStateStore } from "../Stores/MediaStatusStore";
import { popupStore } from "../Stores/PopupStore";

const POPUP_ID = "cameraAccessDenied";

interface Device {
    requested: Readable<boolean>;
    on: () => void;
    off: () => void;
}

let devices: { camera: Device; microphone: Device } | undefined;

const blocked = writable({ camera: false, microphone: false });
export const blockedRequestedStore: Readable<{ camera: boolean; microphone: boolean }> = blocked;

function askAgain(device: Device): void {
    device.off();
    queueMicrotask(device.on);
}

/** Asks the browser again for the blocked devices the person wants. */
export function requestBlockedAgain(): void {
    const now = get(blocked);
    if (!devices) return;
    if (now.camera) askAgain(devices.camera);
    if (now.microphone) askAgain(devices.microphone);
}

/** Turns the blocked devices off, so the help stays away until the person asks for them again. */
export function giveUpBlocked(): void {
    const now = get(blocked);
    if (devices) {
        if (now.camera) devices.camera.off();
        if (now.microphone) devices.microphone.off();
    }
    popupStore.removePopup(POPUP_ID);
}

export function startBlockedDevices(
    help: WorkAdventureComponent,
    camera: Device,
    microphone: Device,
): void {
    if (devices) return;
    devices = { camera, microphone };

    // Singletons for the page's lifetime.
    const wanted = derived(
        [cameraPermissionStateStore, microphonePermissionStateStore, camera.requested, microphone.requested],
        ([$camera, $microphone, $wantsCamera, $wantsMicrophone]) => ({
            camera: $camera === "denied" && $wantsCamera,
            microphone: $microphone === "denied" && $wantsMicrophone,
        }),
    );
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    wanted.subscribe((now) => {
        blocked.set(now);
        if (now.camera || now.microphone) {
            if (!popupStore.hasPopup(POPUP_ID)) popupStore.addPopup(help, {}, POPUP_ID);
        } else {
            popupStore.removePopup(POPUP_ID);
        }
    });

    // Allowed from the address bar while in the room: the stream that failed is asked for again.
    const reacquire = (store: typeof cameraPermissionStateStore, device: Device): void => {
        let previous = get(store);
        // eslint-disable-next-line svelte/no-ignored-unsubscribe
        store.subscribe((state) => {
            if (previous === "denied" && state !== "denied" && state !== null && get(device.requested)) {
                askAgain(device);
            }
            previous = state;
        });
    };
    reacquire(cameraPermissionStateStore, camera);
    reacquire(microphonePermissionStateStore, microphone);
}
