// quanta: the class screen's layout, each person's own choice from the dock's ⋮ menu. B (the strip, stage.ts) is the
// default; A puts the room and the call in a column beside the stage (rail.ts), C floats the call over it as bubbles
// (bubbles.ts). The platform keeps the choice in its own storage and says it as the room starts (quanta_layout); a
// choice made here is drawn at once and told to the platform (quanta_wa_layout), which lays its board out to match.
import { get, writable, type Readable } from "svelte/store";
import { QUANTA_UI } from "../Enum/EnvironmentVariable";
import { fromPlatform, onPlatformOriginLearned, platformOrigin } from "./platformOrigin";

export const ROOM_LAYOUTS = ["a", "b", "c"] as const;
export type RoomLayout = (typeof ROOM_LAYOUTS)[number];

export function isRoomLayout(value: unknown): value is RoomLayout {
    return typeof value === "string" && (ROOM_LAYOUTS as readonly string[]).includes(value);
}

const layout = writable<RoomLayout>("b");
export const roomLayoutStore: Readable<RoomLayout> = layout;

/**
 * Layout A on an upright screen: the call's row of tiles under the stage, this tall with its gap (rail.ts). The map's
 * window ends above it, as above the chat's band (sidePanel.ts adds it to the band).
 */
export const railRowStore = writable(0);

/**
 * Layouts A and C on an upright screen put A's row of tiles and an open panel's band under the stage, on the dock. What
 * otherwise stands on the dock (its notices, the on-air line, the view-as-student pill) stands on them instead, at the
 * stage's foot: this far up from the window's (0 when nothing is under the stage; sidePanel.ts). B keeps them on the dock.
 */
export const dockLiftStore = writable(0);

/**
 * Layout A's tiles are small (three to a row in the column, a row under the stage): they name people as a call does,
 * "Iryna M.", or only by first name on a phone's row, so no name is cut off.
 */
export type TileNames = "full" | "initial" | "first";
export const tileNamesStore = writable<TileNames>("full");

export function tileName(name: string, form: TileNames): string {
    const words = name.trim().split(/\s+/);
    if (form === "full" || words.length < 2) return name;
    return form === "first" ? words[0] : `${words[0]} ${words[words.length - 1].charAt(0)}.`;
}

function tell(message: object): void {
    const origin = platformOrigin();
    if (origin && window.parent !== window) window.parent.postMessage(message, origin);
}

/** The person picks a layout: drawn here at once, kept by the platform. */
export function chooseRoomLayout(next: RoomLayout): void {
    layout.set(next);
    tell({ type: "quanta_wa_layout", layout: next, chosen: true });
}

function onPlatformWord(event: MessageEvent): void {
    if (event.data?.type !== "quanta_layout" || !fromPlatform(event)) return;
    const next = event.data.layout;
    if (!isRoomLayout(next)) return;
    layout.set(next);
    // Said back once applied: the platform lays its board out for the layout the room draws, never ahead of it.
    tell({ type: "quanta_wa_layout", layout: next });
}

let stop: (() => void) | undefined;
/** Listens for the platform's word and says the layout; lives as long as the page (what it returns undoes it). */
export function startRoomLayout(): () => void {
    if (stop || !QUANTA_UI) return () => {};
    const root = document.documentElement;
    const unsubscribe = layout.subscribe((value) => {
        root.dataset.quantaLayout = value;
        // Every piece placed by the layout measures again (the strip's fit, the map's window).
        window.dispatchEvent(new Event("quanta-chat-reserve"));
    });
    window.addEventListener("message", onPlatformWord);
    // The platform answers with the person's layout; said again to an origin learned later (after signing in).
    const hello = () => tell({ type: "quanta_wa_layout", layout: get(layout), ready: true });
    hello();
    const unlearn = onPlatformOriginLearned(hello);
    stop = () => {
        unsubscribe();
        unlearn();
        window.removeEventListener("message", onPlatformWord);
        delete root.dataset.quantaLayout;
        stop = undefined;
    };
    return stop;
}
