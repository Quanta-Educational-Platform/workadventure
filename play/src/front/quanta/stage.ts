// quanta: the class's stage (room layout B). While the platform shows a presented board over the room's window, the
// room steps down to the first tile of a strip along its top, the call's tiles beside it, and the board takes the
// rest above the dock. The platform says when (quanta_stage); the room tells it how tall the strip is
// (quanta_wa_stage) and when someone asks for the room back (quanta_wa_stage_pin).
import { derived, get, readable, writable, type Readable } from "svelte/store";
import { QUANTA_UI } from "../Enum/EnvironmentVariable";
import { highlightedEmbedScreen } from "../Stores/HighlightedEmbedScreenStore";
import { highlightFullScreen } from "../Stores/ActionsCamStore";
import { proximityMeetingStore } from "../Stores/MyMediaStore";
import { streamableCollectionStore } from "../Stores/StreamableCollectionStore";
import { roomLayoutStore } from "./layout";
import { fromPlatform, platformOrigin } from "./platformOrigin";
import { phoneLayoutStore } from "./roomWindow";

const on = writable(false);
/** A board the platform presents is on the stage (not a share, not the room put back). */
export const boardOnStageStore: Readable<boolean> = on;
/** How far up from the window's foot the notices over the dock reach while a board is presented (0 without one). */
const noticesAbove = writable(0);
export const noticesAboveStore: Readable<number> = noticesAbove;
/** A share or an enlarged camera takes the stage the same way, within the room (not on full screen). */
export const shareStageStore: Readable<boolean> = derived(
    [highlightedEmbedScreen, highlightFullScreen],
    ([$highlighted, $full]) => QUANTA_UI && $highlighted !== undefined && !$full,
);
export const stageStore: Readable<boolean> = derived([on, shareStageStore], ([$on, $share]) => $on || $share);

// With the room put back on the stage over a presented board, the board waits in the strip: its label (who presents),
// or null when there is none to go back to.
const boardTile = writable<string | null>(null);
export const boardTileStore: Readable<string | null> = boardTile;

// The strip folded to a row of faces (the person's choice, kept in this browser).
const COLLAPSED_KEY = "quanta.stripCollapsed";
function readCollapsed(): boolean {
    try {
        return window.localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
        return false;
    }
}
const collapsed = writable(readCollapsed());
export const stripCollapsedStore: Readable<boolean> = collapsed;
export function setStripCollapsed(value: boolean): void {
    collapsed.set(value);
    try {
        window.localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
    } catch {
        // Kept for this page only.
    }
}

/**
 * How many of the call's tiles are on screen: what WA actually draws, not its list of streams, which can hold one that
 * is never drawn (a listener's zone, a camera that is off), and then the strip was an empty band above the map.
 * Watched only while in a call.
 */
export const callTilesStore = readable(0, (set) => {
    let observer: MutationObserver | undefined;
    let retry: ReturnType<typeof setInterval> | undefined;
    const count = () => set(document.querySelectorAll(".presentation-layout #cameras-container > .camera-box").length);
    const stopWatching = () => {
        observer?.disconnect();
        observer = undefined;
        clearInterval(retry);
        retry = undefined;
    };
    const watch = () => {
        const layout = document.querySelector(".presentation-layout");
        if (!layout) return false;
        observer = new MutationObserver(count);
        observer.observe(layout, { childList: true, subtree: true });
        count();
        return true;
    };
    const unsubscribe = proximityMeetingStore.subscribe((meeting) => {
        stopWatching();
        if (meeting !== true) return set(0);
        // The layout mounts with the call: looked for again until it is there.
        if (!watch()) retry = setInterval(() => watch() && (clearInterval(retry), (retry = undefined)), 250);
    });
    return () => {
        unsubscribe();
        stopWatching();
    };
});

/**
 * In a call with nothing on the stage the call's tiles still make a strip above the map's window, which the map
 * fits below rather than being covered by them (Ako #1).
 */
export const callStripStore = derived(
    [proximityMeetingStore, callTilesStore, stageStore, boardTile, roomLayoutStore],
    ([$meeting, $tiles, $stage, $board, $layout]) =>
        // A call with a tile to draw: your own counts (with nobody else publishing the call still shows it, which
        // otherwise fell back to WA's column at the map's left edge). In a call with nothing drawn (a listener's zone,
        // your camera off) there is no strip, not an empty band above the map.
        QUANTA_UI && $meeting === true && $tiles > 0 && !$stage && $board === null && $layout === "b",
);

/** The strip along the room's top (layout B only): on the stage, with the board waiting in it, or the call's alone. */
export const stripStore = derived(
    [stageStore, boardTile, callStripStore, roomLayoutStore],
    ([$stage, $board, $call, $layout]) => $layout === "b" && ($stage || $board !== null || $call),
);

/** Where the room's own picture is drawn while the stage is taken (StageRoomTile.svelte), in the frame's pixels. */
export interface PictureRect {
    x: number;
    y: number;
    width: number;
    height: number;
    /** Filled rather than whole: the map's middle, cut to the box (rounded by `radius`). */
    cover?: boolean;
    radius?: number;
}
/** Layouts A and C say where they draw it (rail.ts, bubbles.ts); B draws it in the strip's first tile. */
export const otherPictureRect = writable<PictureRect | null>(null);

/** The strip's tiles: the room's and the call's, 16:9, this tall; with the gap above, what the strip takes. */
export const STAGE_TILE = { height: 112, phoneHeight: 72, gap: 12, phoneGap: 8 } as const;
export const STRIP_FACES_HEIGHT = 36;
// The width the strip's tiles get to share them all, measured in startStage (null: as wide as 16:9 lets them be).
const fitWidth = writable<number | null>(null);
const MIN_TILE_WIDTH = 96;

export const stageTileStore = derived([phoneLayoutStore, collapsed, fitWidth], ([phone, $collapsed, $fit]) => {
    const height = phone ? STAGE_TILE.phoneHeight : STAGE_TILE.height;
    const gap = phone ? STAGE_TILE.phoneGap : STAGE_TILE.gap;
    // Folded, the room's tile is a pill as tall as the faces.
    if ($collapsed) return { height: STRIP_FACES_HEIGHT, width: 96, gap, collapsed: true };
    // Narrower than 16:9 when that's what it takes for every tile to show whole beside the chat; below the minimum
    // the strip scrolls whole tiles instead.
    const full = Math.round((height * 16) / 9);
    const width = $fit === null ? full : Math.max(MIN_TILE_WIDTH, Math.min(full, $fit));
    return { height, width, gap, collapsed: false };
});

function tell(message: object): void {
    const origin = platformOrigin();
    if (origin && window.parent !== window) window.parent.postMessage(message, origin);
}

/**
 * Puts the room back on the stage: a share steps down to its tile in the strip, a presented board asks the platform
 * (it waits as the strip's first tile until presented again).
 */
export function pinRoom(): void {
    if (get(shareStageStore) && !get(on)) highlightedEmbedScreen.removeHighlight();
    else tell({ type: "quanta_wa_stage_pin", pin: "room" });
}

/** Asks the platform to put the waiting board back on the stage. */
export function pinBoard(): void {
    tell({ type: "quanta_wa_stage_pin", pin: "board" });
}

let started = false;
export function startStage(): void {
    if (started || !QUANTA_UI) return;
    started = true;
    window.addEventListener("message", (event: MessageEvent) => {
        if (event.data?.type !== "quanta_stage" || !fromPlatform(event)) return;
        on.set(event.data.on === true);
        const label = event.data.boardTile;
        boardTile.set(event.data.on !== true && typeof label === "string" ? label.slice(0, 120) : null);
    });
    // The strip's tiles share its width: the window less the chat column and the fold button at its end.
    let fitFrame = 0;
    const fit = () => {
        cancelAnimationFrame(fitFrame);
        fitFrame = requestAnimationFrame(() => {
            const root = document.documentElement;
            if (root.dataset.quantaStrip === undefined) return fitWidth.set(null);
            const css = getComputedStyle(root);
            const gap = parseFloat(css.getPropertyValue("--quanta-stage-gap")) || STAGE_TILE.gap;
            const chat = parseFloat(css.getPropertyValue("--quanta-chat-map")) || 0;
            const cameras = document.querySelectorAll("#cameras-container > .camera-box").length;
            const tiles = cameras + (get(stageStore) || get(boardTile) !== null ? 1 : 0);
            if (!tiles) return fitWidth.set(null);
            // The strip's own box: from the layout's left edge to where its row ends before the fold button (the
            // layout's padding and the row's margins), as laid out now.
            const lay = document.querySelector<HTMLElement>(".presentation-layout");
            let room = window.innerWidth - chat - gap * 3 - 40 - 8;
            if (lay) {
                const box = lay.getBoundingClientRect();
                room = box.width - parseFloat(getComputedStyle(lay).paddingRight) - 12;
            }
            const next = Math.floor((room - gap * (tiles - 1)) / tiles);
            if (get(fitWidth) !== next) fitWidth.set(next);
        });
    };
    window.addEventListener("resize", fit);
    window.addEventListener("quanta-chat-reserve", fit);
    // Lives as long as the page.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    derived([streamableCollectionStore, stripStore, stageStore, boardTile], (values) => values).subscribe(() => {
        // Again once the tiles are in the page: a new camera's box comes a moment after its stream.
        fit();
        setTimeout(fit, 400);
    });
    let tile = { height: 0, width: 0, gap: 0 };
    let shown = false;
    // Only B draws a strip above the stage: A and C leave the stage its whole height (they say their own pieces).
    let layoutB = true;
    // A phone draws no room tile in the strip (StageRoomTile.svelte): out of a call it holds nothing, and the board
    // takes its band.
    let emptyStrip = false;
    const report = () =>
        tell({
            type: "quanta_wa_stage",
            on: shown,
            strip: shown && layoutB && !emptyStrip ? tile.height + tile.gap * 2 : 0,
        });
    // Lives as long as the page.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    derived(
        [
            on,
            stageStore,
            shareStageStore,
            stripStore,
            stageTileStore,
            callStripStore,
            roomLayoutStore,
            phoneLayoutStore,
            callTilesStore,
        ],
        (values) => values,
    ).subscribe(([$on, $stage, $share, $strip, $tile, $call, $layout, $phone, $tiles]) => {
        shown = $on;
        tile = $tile;
        layoutB = $layout === "b";
        emptyStrip = $phone && $tiles === 0;
        const root = document.documentElement;
        if ($stage) root.dataset.quantaStage = $share && !$on ? "share" : "";
        else delete root.dataset.quantaStage;
        if ($strip) root.dataset.quantaStrip = $tile.collapsed ? "faces" : "";
        else delete root.dataset.quantaStrip;
        if ($call) root.dataset.quantaCallStrip = "";
        else delete root.dataset.quantaCallStrip;
        // The platform's board covers the map: the names over people near the map's top would show above its edge.
        if ($on) root.dataset.quantaBoardOn = "";
        else delete root.dataset.quantaBoardOn;
        // The map's window starts below the call's strip; the map refits to it (CameraManager listens).
        // Also with the board waiting in the strip: either way the room itself is on the stage, below the strip.
        const callStrip = $strip && !$stage ? `${$tile.height + $tile.gap}px` : "0px";
        if (root.style.getPropertyValue("--quanta-call-strip") !== callStrip) {
            root.style.setProperty("--quanta-call-strip", callStrip);
            window.dispatchEvent(new Event("quanta-chat-reserve"));
        }
        // Folded with the room on the stage, the board's tile is not drawn (StageRoomTile.svelte): the faces start at
        // the strip's edge.
        root.style.setProperty("--quanta-stage-tile-w", `${$tile.collapsed && !$stage ? 0 : $tile.width}px`);
        // What the strip's first tile takes before the call's tiles: nothing on a phone, which draws no room or board
        // tile at all (StageRoomTile.svelte).
        root.style.setProperty("--quanta-stage-lead", `${($tile.collapsed && !$stage) || $phone ? 0 : $tile.width}px`);
        root.style.setProperty("--quanta-stage-tile-h", `${$tile.height}px`);
        root.style.setProperty("--quanta-stage-gap", `${$tile.gap}px`);
        report();
    });
    // The board on the stage stops above the dock; notices above the dock (the room's own, the on-air line) would be
    // under it, so the platform is told how far up from the window's foot they reach and stops the board above them.
    let notices = -1;
    const measure = () => {
        // The page's board covers the space over the dock where the buttons' own tips show: while it is up, the
        // browser's tooltips (drawn above the page) name the buttons instead.
        for (const button of document.querySelectorAll<HTMLElement>(".quanta-dock [data-tip]")) {
            const tip = button.dataset.tip ?? "";
            if (shown && button.title !== tip) button.title = tip;
            else if (!shown && button.title && button.title === tip) button.removeAttribute("title");
        }
        // Off the stage the last reach stands: the platform keeps it for the board's return (and lays nothing by it
        // meanwhile), which then doesn't glide up from the dock each time.
        if (!shown) return;
        let above = 0;
        // Stood on what layouts A and C put under the stage (layout.ts), they can reach past the window's middle.
        const floor = document.documentElement.hasAttribute("data-quanta-lifted") ? 0 : window.innerHeight / 2;
        for (const item of document.querySelectorAll<HTMLElement>(
            "[data-quanta-notices] > *, [data-testid='quanta-on-air-strip'] > *",
        )) {
            const box = item.getBoundingClientRect();
            if (box.height > 0 && box.width > 0 && box.top > floor)
                above = Math.max(above, Math.ceil(window.innerHeight - box.top));
        }
        if (above === notices) return;
        notices = above;
        noticesAbove.set(above);
        tell({ type: "quanta_wa_notices", above });
    };
    // Measured only while a board is on the stage: the rest of the class needs no timer waking ten times a second.
    let timer: ReturnType<typeof setInterval> | undefined;
    // Lives as long as the page.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    on.subscribe(($on) => {
        // Before the stage's own subscriber above hears it (a store's subscribers run in order, derived ones after).
        shown = $on;
        if ($on && timer === undefined) timer = setInterval(measure, 100);
        else if (!$on && timer !== undefined) {
            clearInterval(timer);
            timer = undefined;
            // Said again on the board's return, for a platform that dropped it meanwhile.
            notices = -1;
        }
        measure();
    });
}
