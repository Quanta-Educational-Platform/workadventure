// quanta: layout C, bubbles. The stage takes the whole window; only people on camera or talking float over it as round
// bubbles (top right unless moved), the rest of the call is a face pile beside them, and while something is presented
// the room is a small floating window (bottom left unless moved). Bubbles and the window are dragged to a corner,
// snap to it and stay there (kept in this browser). A shared screen leaves a band under it where they park instead.
// BubblesLayer.svelte draws the pile, the names and the window and moves WA's tiles (quanta-ui.css); the platform is
// told their shapes so its board, laid over the room, leaves them uncovered (quanta_wa_floats).
import { derived, writable, type Readable } from "svelte/store";
import { roomLayoutStore } from "./layout";
import { platformOrigin } from "./platformOrigin";
import { boardOnStageStore, boardTileStore, shareStageStore, stageStore } from "./stage";

export type Corner = "tl" | "tr" | "bl" | "br";
const CORNERS: Corner[] = ["tl", "tr", "bl", "br"];

function readCorner(key: string, fallback: Corner): Corner {
    try {
        const value = window.localStorage.getItem(key);
        return CORNERS.includes(value as Corner) ? (value as Corner) : fallback;
    } catch {
        return fallback;
    }
}

function keptCorner(key: string, fallback: Corner) {
    const store = writable(readCorner(key, fallback));
    return {
        subscribe: store.subscribe,
        set(value: Corner) {
            store.set(value);
            try {
                window.localStorage.setItem(key, value);
            } catch {
                // Kept for this page only.
            }
        },
    };
}

export const bubblesCornerStore = keptCorner("quanta.bubblesCorner", "tr");
export const roomWindowCornerStore = keptCorner("quanta.roomWindowCorner", "bl");

export const bubblesOnStore: Readable<boolean> = derived(roomLayoutStore, ($layout) => $layout === "c");

/** A shared screen on the stage: the bubbles and the room park in a band under it. */
export const bubblesParkedStore: Readable<boolean> = derived(
    [roomLayoutStore, shareStageStore, boardOnStageStore],
    ([$layout, $share, $board]) => $layout === "c" && $share && !$board,
);

/** While something is presented the room floats as a small window (layout C); put back, the board waits there. */
export const roomWindowOnStore: Readable<boolean> = derived(
    [roomLayoutStore, stageStore, boardTileStore],
    ([$layout, $stage, $board]) => $layout === "c" && ($stage || $board !== null),
);

/** A bubble's size: desktop, tablet, phone (the spec's 104/88/64). */
export function bubbleSize(width: number, height: number, phone: boolean): number {
    if (phone) return 64;
    return Math.min(width, height) < 900 ? 88 : 104;
}

/** The band a shared screen leaves under it, where the bubbles park. */
export function parkHeight(phone: boolean): number {
    return phone ? 72 : 88;
}

/** The nearest corner to a point, within a rectangle. */
export function nearestCorner(x: number, y: number, rect: { x: number; y: number; width: number; height: number }) {
    const right = x > rect.x + rect.width / 2;
    const bottom = y > rect.y + rect.height / 2;
    return `${bottom ? "b" : "t"}${right ? "r" : "l"}` as Corner;
}

export interface FloatShape {
    x: number;
    y: number;
    w: number;
    h: number;
    r: number;
}

let told = "";
/** The shapes floating over the stage, in the frame's pixels: the platform's board leaves holes for them. */
export function tellFloats(shapes: FloatShape[]): void {
    const rounded = shapes.map((s) => ({
        x: Math.round(s.x),
        y: Math.round(s.y),
        w: Math.round(s.w),
        h: Math.round(s.h),
        r: Math.round(s.r),
    }));
    const key = JSON.stringify(rounded);
    if (key === told) return;
    told = key;
    const origin = platformOrigin();
    if (origin && window.parent !== window)
        window.parent.postMessage({ type: "quanta_wa_floats", shapes: rounded }, origin);
}

/** Said again to a platform that starts listening later. */
export function retellFloats(): void {
    const last = told;
    told = "";
    if (last) tellFloats(JSON.parse(last) as FloatShape[]);
}
