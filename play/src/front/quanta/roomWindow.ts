// quanta: the map shows through a rounded window inset from the canvas edges (quanta-ui.css): above the dock and,
// with the class chat open beside it, left of the chat's column (sidePanel.ts).
import { readable } from "svelte/store";
import type { Insets } from "./roomFit";
import { sideSlideActive, sideSlideGained, sideSlideShown } from "./sideSlide";

export const WINDOW = { top: 12, right: 12, bottom: 96, left: 12, radius: 16 };
// The dock is shorter on phones, held either way up (QuantaDock.svelte, quanta-ui.css).
export const PHONE_WINDOW = { top: 8, right: 8, bottom: 84, left: 8, radius: 14 };
export const phoneWindow = window.matchMedia("(max-width: 480px), (max-height: 480px)");

/** The phone layout: the room's insets, its dock and the call's tiles are compact (quanta-ui.css uses the same query). */
export const phoneLayoutStore = readable(phoneWindow.matches, (set) => {
    const update = () => set(phoneWindow.matches);
    phoneWindow.addEventListener("change", update);
    return () => phoneWindow.removeEventListener("change", update);
});

/** The call's tiles in the phone layout: one row, 16:9, about this tall and never narrower than this. */
export const PHONE_TILE_HEIGHT = 72;
export const PHONE_TILE_MIN_WIDTH = 112;

/** A room fitted whole stays this far from the window's top and bottom, rather than sitting on its edge. */
const ROOM_MARGIN = 12;

export function withRoomMargin(insets: Insets): Insets {
    return { ...insets, top: insets.top + ROOM_MARGIN, bottom: insets.bottom + ROOM_MARGIN };
}

/** The chat column's width the map leaves free on its right, in CSS pixels. */
export function chatColumnWidth(): number {
    if (sideSlideActive()) return sideSlideShown();
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--quanta-chat-map")) || 0;
}

/** How much wider the open side column makes the frame (sidePanel.ts): the frame the room is fitted to is narrower by it. */
export function sideColumnFrameShare(): number {
    if (sideSlideActive()) return sideSlideGained();
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--quanta-side-widens")) || 0;
}

/** The window's distance from each edge of the canvas, in CSS pixels. */
/** The chat's band below the map on an upright screen (sidePanel.ts), in CSS pixels. */
export function chatBandHeight(): number {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--quanta-chat-below")) || 0;
}

/** The call's strip above the map's window (stage.ts), in CSS pixels. */
export function callStripHeight(): number {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--quanta-call-strip")) || 0;
}

export function roomWindowInsets(
    chatColumn = chatColumnWidth(),
    chatBand = chatBandHeight(),
    callStrip = callStripHeight(),
): Insets {
    const w = phoneWindow.matches ? PHONE_WINDOW : WINDOW;
    return { top: w.top + callStrip, right: w.right + chatColumn, bottom: w.bottom + chatBand, left: w.left };
}

/** The room's visible window on screen (the map's rounded window, above the dock, left of the open chat), where its
 * menus stay whole. */
export function roomWindowRect(): { x: number; y: number; width: number; height: number } {
    const canvas = document.querySelector("#game > canvas")?.getBoundingClientRect();
    const frame = canvas && canvas.width > 0 ? canvas : new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    const insets = roomWindowInsets();
    return {
        x: frame.left + insets.left,
        y: frame.top + insets.top,
        width: Math.max(frame.width - insets.left - insets.right, 0),
        height: Math.max(frame.height - insets.top - insets.bottom, 0),
    };
}
