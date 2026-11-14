// quanta: WA's picture-in-picture window grew by a video for everyone in the call, up to the whole screen.
const VIDEO_HEIGHT = 227;
const ACTION_BAR_HEIGHT = 80;
const OWN_VIDEO_HEIGHT = 78;
const MAX_VIDEOS = 2;

/** The window's height for a call of `streams`, at most two videos tall and never taller than the screen. */
export function pipWindowHeight(streams: number, screenHeight: number | undefined): number {
    const videos = Math.min(Math.max(streams - 1, 1), MAX_VIDEOS);
    const height = videos * VIDEO_HEIGHT + ACTION_BAR_HEIGHT + OWN_VIDEO_HEIGHT;
    return screenHeight ? Math.min(height, screenHeight) : height;
}
