// quanta: a room drawn to fit the screen (map property quantaFitCamera) is shown whole and centred, the room's ground
// around it, as long as its tiles stay big enough to make out people; on a smaller screen it fills the width and the
// camera follows the avatar up and down.

export interface Size {
    width: number;
    height: number;
}

export interface Rect extends Size {
    x: number;
    y: number;
}

/** The smallest a tile may be drawn, in CSS pixels, for the whole room to be shown at once (a Woka at half size). */
export const MIN_FITTED_TILE_PX = 16;

/** On a touch screen too small for the whole room, the tiles grow up to this size, in CSS pixels, to fill the window. */
export const READABLE_TILE_PX = 24;

/**
 * How much bigger than the whole-room fit a room may be drawn to fill its window: about an eighth of it may be cut off,
 * the floor along its edges, so a room nearly the window's shape fills it and any other shows thinner bands.
 */
export const MAX_FILL_CROP = 1.15;

export type RoomFit = "whole" | "width";

/** How a room of `map` pixels, with tiles `tileWidth` pixels wide, fits a `screen` measured in CSS pixels. */
export function roomFit(screen: Size, map: Size, tileWidth: number): RoomFit {
    const wholeZoom = Math.min(screen.width / map.width, screen.height / map.height);
    return wholeZoom * tileWidth >= MIN_FITTED_TILE_PX ? "whole" : "width";
}

/** The part of the room the screen must contain; a height of 0 leaves the width alone to set the zoom. */
export function roomFitView(fit: RoomFit, map: Size): Size {
    return fit === "whole" ? { width: map.width, height: map.height } : { width: map.width, height: 0 };
}

export interface Insets {
    top: number;
    right: number;
    bottom: number;
    left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * The part of the map the whole screen must show for `view` to fill the window left inside `insets` (CSS pixels):
 * the camera's zoom fills the screen, the room has to fit the window.
 */
export function windowView(view: Size, screen: Size, insets: Insets): Size {
    const width = Math.max(1, screen.width - insets.left - insets.right);
    const height = Math.max(1, screen.height - insets.top - insets.bottom);
    return { width: (view.width * screen.width) / width, height: (view.height * screen.height) / height };
}

/** The part of the map the screen must show for the room's fit inside the window left by `insets`. */
export function roomFitTarget(screen: Size, insets: Insets, map: Size, tileWidth: number): Size {
    const window = {
        width: screen.width - insets.left - insets.right,
        height: screen.height - insets.top - insets.bottom,
    };
    return windowView(roomFitView(roomFit(window, map, tileWidth), map), screen, insets);
}

/**
 * Camera bounds for a view of `view` map pixels showing the room through a window `insets` map pixels in from its
 * edges: along an axis where the window is larger than the room, the room sits in the window's middle; where it is
 * smaller, the camera can bring each edge of the room to the window's edge, and no further.
 */
export function roomBounds(map: Size, view: Size, insets: Insets = NO_INSETS): Rect {
    const axis = (room: number, seen: number, before: number, after: number) => {
        const window = seen - before - after;
        return window >= room ? [(room - window) / 2 - before, seen] : [before ? -before : 0, room + before + after];
    };
    const [x, width] = axis(map.width, view.width, insets.left, insets.right);
    const [y, height] = axis(map.height, view.height, insets.top, insets.bottom);
    return { x, y, width, height };
}

/**
 * The on-screen scale (CSS pixels per map pixel) of the room's fit inside the window left by `insets`. The fit is for
 * the room's own window, the whole frame: a board or the chat column beside the map covers part of it rather than
 * shrinking the room, so opening one keeps the scale and closing it comes back to the same view.
 */
export function roomFitScale(
    screen: Size,
    insets: Insets,
    map: Size,
    tileWidth: number,
    readable = false,
    fill = true,
): number {
    const view = roomFitTarget(screen, insets, map, tileWidth);
    const scale = Math.min(screen.width / view.width, view.height ? screen.height / view.height : Infinity);
    const window = {
        width: Math.max(1, screen.width - insets.left - insets.right),
        height: Math.max(1, screen.height - insets.top - insets.bottom),
    };
    // The room zooms in towards filling its window, at most MAX_FILL_CROP past the whole-room fit: a room almost the
    // window's shape fills it, any other keeps thinner bands of ground; the camera follows the avatar over what is cut.
    const cover = Math.max(window.width / map.width, window.height / map.height);
    if (fill && roomFit(window, map, tileWidth) === "whole") return Math.min(cover, scale * MAX_FILL_CROP);
    if (!readable || roomFit(window, map, tileWidth) === "whole") return scale;
    // A phone: the room fills its window, with no ground above or below it, and its people stay big enough to tell
    // apart; the camera follows the avatar, and pinching out still shows the whole room.
    return Math.max(scale, Math.min(cover, READABLE_TILE_PX / tileWidth));
}
