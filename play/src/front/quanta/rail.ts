// quanta: layout A, the rail. The stage keeps its full height on the left; a column on the right stacks the room (its
// picture while something is presented), the call's tiles, then People or Chat, at the platform's side column width
// (the person drags it as before). On an upright screen or a phone the column becomes a band under the stage: one row
// of tiles, the room's first, above the panel. RailColumn.svelte draws the cards and places WA's tiles in them; the
// platform is told where the panel starts (column) or how tall the row is (band), for People and the presented board.
import { derived, writable, type Readable } from "svelte/store";
import { proximityMeetingStore } from "../Stores/MyMediaStore";
import { roomLayoutStore } from "./layout";
import { platformOrigin } from "./platformOrigin";
import { railColumnStore } from "./sidePanel";
import { boardTileStore, stageStore } from "./stage";

export type RailMode = "column" | "band";

export const railModeStore: Readable<RailMode | null> = derived(
    [roomLayoutStore, railColumnStore],
    ([$layout, $column]) => ($layout === "a" ? ($column ? "column" : "band") : null),
);

/** The rail's first card: the room's picture while something is presented, or the board waiting while the room is. */
export const railRoomCardStore: Readable<"room" | "board" | null> = derived(
    [stageStore, boardTileStore],
    ([$stage, $board]) => ($stage ? "room" : $board !== null ? "board" : null),
);

/** In a call, own tile included (as the strip's rule in stage.ts). */
export const railInCallStore = derived(proximityMeetingStore, ($meeting) => $meeting === true);

function readFlag(key: string): boolean {
    try {
        return window.localStorage.getItem(key) === "1";
    } catch {
        return false;
    }
}

function keptFlag(key: string) {
    const store = writable(readFlag(key));
    return {
        subscribe: store.subscribe,
        set(value: boolean) {
            store.set(value);
            try {
                window.localStorage.setItem(key, value ? "1" : "0");
            } catch {
                // Kept for this page only.
            }
        },
    };
}

/** The room's card folded to its header, and the call's tiles folded away: each person's choice, kept here. */
export const railRoomFoldedStore = keptFlag("quanta.railRoomFolded");
export const railCallFoldedStore = keptFlag("quanta.railCallFolded");

/** Where People or Chat starts in the column, from the frame's top (null outside the column). */
export const railPanelTopStore = writable<number | null>(null);

/** The column's sizes, from the side column's width and margin. */
export const RAIL = {
    header: 40,
    foldedCard: 44,
    tilePad: 8,
    tileGap: 8,
    /** The room's card is twice as wide as tall. */
    roomAspect: 0.5,
    /** The call's tiles take at most this share of the window's height; more scroll. */
    tilesMaxShare: 0.5,
    /** With People or Chat open under them, they leave it at least this tall. */
    panelMin: 240,
    /** Camera-off tiles go three to a row from this column width; below it two, so their names fit. */
    threeAcross: 380,
    rowHeight: 96,
    phoneRowHeight: 64,
} as const;

let told = "";
/** Tells the platform where the panel starts (column) and how tall the row under the stage is (band). */
export function tellRail(mode: RailMode | null, top: number, below: number): void {
    const message = { type: "quanta_wa_rail", mode, top: Math.round(top), below: Math.round(below) };
    const key = JSON.stringify(message);
    if (key === told) return;
    told = key;
    const origin = platformOrigin();
    if (origin && window.parent !== window) window.parent.postMessage(message, origin);
}

/** A platform that reloaded its side (or a room that started again) hears the rail again. */
export function retellRail(): void {
    const last = told;
    told = "";
    if (last) {
        const parsed = JSON.parse(last) as { mode: RailMode | null; top: number; below: number };
        tellRail(parsed.mode, parsed.top, parsed.below);
    }
}
