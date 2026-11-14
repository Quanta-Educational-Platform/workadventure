// quanta: a camera staff turned off stays off until they allow it again (the room's server keeps who: RoomSession
// cameraOff). The page turns it off again whenever anything (settings, a shortcut, a new conversation) turns it on.
// MediaStore imports what imports this, so its store is handed over at start rather than imported here.
import { derived, type Readable } from "svelte/store";
import { QUANTA_UI } from "../Enum/EnvironmentVariable";
import { cameraHeldStore } from "./moderationBridge";

let started = false;
/** `allowed`: told once the hold is lifted. */
export function startCameraHold(camera: Readable<boolean> & { disableWebcam: () => void }, allowed: () => void): void {
    if (started || !QUANTA_UI) return;
    started = true;
    // Singletons for the page's lifetime.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    derived([cameraHeldStore, camera], ([$held, $on]) => $held && $on).subscribe((turnOff) => {
        if (turnOff) queueMicrotask(() => camera.disableWebcam());
    });
    let held = false;
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    cameraHeldStore.subscribe((now) => {
        if (held && !now) allowed();
        held = now;
    });
}
