/** What the browser's screen-share picker understands beyond the plain video/audio constraints. */
export interface DisplayCaptureSupport {
    /** The `displaySurface` constraint, which preselects a pane of the picker (Chrome 107+). */
    displaySurface: boolean;
    /** The `restrictOwnAudio` constraint, which leaves the capturing tab's own sound out of a tab capture. */
    restrictOwnAudio: boolean;
    /** Chromium's picker options: selfBrowserSurface, surfaceSwitching and systemAudio (Chrome 105-107+). */
    chromiumPickerOptions: boolean;
}

export type DisplayMediaOptions = {
    video: boolean | MediaTrackConstraints;
    audio: boolean | MediaTrackConstraints;
    selfBrowserSurface?: "include" | "exclude";
    surfaceSwitching?: "include" | "exclude";
    systemAudio?: "include" | "exclude";
};

export function detectDisplayCaptureSupport(): DisplayCaptureSupport {
    const supported: Record<string, boolean | undefined> =
        typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getSupportedConstraints === "function"
            ? (navigator.mediaDevices.getSupportedConstraints() as Record<string, boolean | undefined>)
            : {};
    return {
        displaySurface: supported.displaySurface === true,
        restrictOwnAudio: supported.restrictOwnAudio === true,
        // No direct detection exists for dictionary members; CaptureController shipped right after them (109).
        chromiumPickerOptions: typeof (globalThis as { CaptureController?: unknown }).CaptureController === "function",
    };
}

/**
 * Options for getDisplayMedia. The room runs inside the Quanta page, so the lesson itself is "this tab":
 * Chrome hides the current tab from its picker unless asked (selfBrowserSurface defaults to "exclude"),
 * which left sharing the whole screen, other apps included, as the only way to show it.
 */
export function buildDisplayMediaOptions(
    wants: { video: boolean; audio: boolean },
    support: DisplayCaptureSupport,
): DisplayMediaOptions {
    // Open on the tab list rather than on the whole screen.
    const video: boolean | MediaTrackConstraints =
        wants.video && support.displaySurface ? { displaySurface: "browser" } : wants.video;
    // Sharing this tab with its sound would send the class its own voices back.
    const audio: boolean | MediaTrackConstraints =
        wants.audio && support.restrictOwnAudio ? ({ restrictOwnAudio: true } as MediaTrackConstraints) : wants.audio;
    if (!support.chromiumPickerOptions) {
        return { video, audio };
    }
    return {
        video,
        audio,
        selfBrowserSurface: "include",
        // "Share this tab instead" switches the shared tab without stopping and restarting the share.
        surfaceSwitching: "include",
        // A whole screen's sound carries notifications from other apps and the room's own playback.
        systemAudio: "exclude",
    };
}
