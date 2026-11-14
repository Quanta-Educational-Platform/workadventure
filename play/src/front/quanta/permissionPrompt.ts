// quanta: while the browser asks for the camera and microphone, the device check says where to answer: its prompt is
// easy to miss beside a page that seems to be loading.
import type { BrowserMediaPermissionState } from "../Stores/MediaStatusStore";

/** The browser's question is up: at least one of the devices is still to be allowed. Unknown states show nothing. */
export function permissionPromptPending(
    camera: BrowserMediaPermissionState,
    microphone: BrowserMediaPermissionState,
): boolean {
    return camera === "prompt" || microphone === "prompt";
}

/**
 * Where the browser asks. Desktop Chrome, Edge and Firefox drop their prompt from the left of the address bar; Safari,
 * every iPad and iPhone browser and Android show a dialog of their own.
 */
export function permissionPromptPlace(userAgent: string, maxTouchPoints = 0): "addressBar" | "dialog" {
    if (/Android|iPhone|iPad|iPod/i.test(userAgent)) return "dialog";
    // iPadOS asks for the desktop site and names itself a Mac, but has a touch screen.
    if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return "dialog";
    if (/Safari\//.test(userAgent) && !/Chrome\/|Chromium\/|Edg\/|OPR\/|Firefox\//.test(userAgent)) return "dialog";
    return "addressBar";
}
