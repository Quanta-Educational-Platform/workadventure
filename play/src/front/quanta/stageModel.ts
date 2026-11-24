// quanta: what fills the class's main area (the stage), decided in one place. At any moment it shows exactly one item:
// the map, the board the platform presents, or one picture (a screen share or an enlarged camera); everything else
// waits as a tile in the strip. This module holds that item and a history of what was there before, applies it (WA's
// highlight for a picture, the platform's board through quanta_wa_stage_pin) and is the only thing that changes either.
//
// Takes over the stage: a new presentation of the board, a teacher's screen share reaching this person, and whatever
// this person picks (a tile, the enlarge button, "Back to the board", the phone's switch). Never takes over: a
// student's screen share (a notice offers to show it), one's own share, a camera turning on. When the item on the
// stage ends or is closed, the stage goes back to the most recent item in its history that still exists.
import { get } from "svelte/store";
import { highlightedEmbedScreen } from "../Stores/HighlightedEmbedScreenStore";
import { streamableCollectionStore } from "../Stores/StreamableCollectionStore";
import { notificationPlayingStore } from "../Stores/NotificationStore";
import type { VideoBox } from "../Space/VideoBox";
import { staffTarget } from "./staffTargets";
import { QL } from "./i18n";

export type StageItem = "map" | "board" | string;

let current: StageItem = "map";
// Most recent last, no repeats, never the current item.
let history: StageItem[] = [];
let boardKey: string | null = null;
// While this module changes WA's highlight itself, the change is not read back as someone's pick.
let applying = false;
let tellPlatform: (pin: "room" | "board", picture: "screen" | "camera" | null) => void = () => {};

const isPicture = (item: StageItem) => item !== "map" && item !== "board";
const pictureBox = (item: StageItem): VideoBox | undefined => get(streamableCollectionStore).get(item);

function exists(item: StageItem): boolean {
    if (item === "map") return true;
    if (item === "board") return boardKey !== null;
    return pictureBox(item) !== undefined;
}

function apply(): void {
    applying = true;
    try {
        const shown = get(highlightedEmbedScreen)?.uniqueId;
        if (isPicture(current)) {
            const box = pictureBox(current);
            if (box && shown !== current) highlightedEmbedScreen.highlight(box);
        } else if (shown !== undefined) {
            highlightedEmbedScreen.removeHighlight();
        }
    } finally {
        applying = false;
    }
    // What is up when it is not the board, for the phone's top bar (Board · Screen · Class).
    const picture = isPicture(current) ? (current.startsWith("screensharing_") ? "screen" : "camera") : null;
    tellPlatform(current === "board" ? "board" : "room", picture);
}

/** Puts an item on the stage; what was there goes into the history. */
export function showOnStage(item: StageItem): void {
    if (!exists(item)) return;
    if (item === current) {
        apply();
        return;
    }
    history = [...history.filter((entry) => entry !== current && entry !== item), current];
    current = item;
    apply();
}

/** The item on the stage ended or was closed: the most recent one before it that still exists. */
export function stageBack(): void {
    history = history.filter((entry) => entry !== current && exists(entry));
    const previous = history.pop();
    current = previous ?? (boardKey !== null ? "board" : "map");
    apply();
}

/** Which item is on the stage now. */
export function stageItem(): StageItem {
    return current;
}

/**
 * The board the platform presents: its key (a new key is a new presentation, which takes over), or null when there is
 * none (minimised, or no longer presented).
 */
export function setStageBoard(key: string | null): void {
    if (key === boardKey) return;
    const previous = boardKey;
    boardKey = key;
    if (key !== null && previous === null) {
        // Arriving in a class where a teacher already shares their screen and a board is presented: the share stays
        // up (it is what the teacher is talking about), the board waits behind it. They reach this person in either
        // order as the room loads; later a newly presented board takes over as usual.
        if (Date.now() - startedAt < ARRIVING_MS && isPicture(current) && isStaffShare(current)) {
            history = [...history.filter((entry) => entry !== "board"), "board"];
            apply();
            return;
        }
        showOnStage("board");
        return;
    }
    if (key !== null) {
        // Another board while one was up: still the board, now this one.
        if (current !== "board") showOnStage("board");
        return;
    }
    history = history.filter((entry) => entry !== "board");
    if (current === "board") stageBack();
}

/**
 * Someone's screen share reached this person (WA would highlight it at once). A teacher's takes the stage; a
 * student's waits in the strip, and a notice offers to show it.
 */
export function stageShareStarted(box: VideoBox): void {
    const staff = staffTarget(box.spaceUser.uuid, box.spaceUser.tags) === true;
    if (staff) {
        // Once per share: WA announces it again when its stream is re-added (a reconnect, the call moving to the
        // server), and a student who has looked away since keeps their pick.
        if (takenOver.has(box.uniqueId)) return;
        takenOver.set(box.uniqueId, false);
        // The share is announced a moment before its picture joins the room's pictures: it takes the stage then.
        if (exists(box.uniqueId)) showOnStage(box.uniqueId);
        else pendingTakeover = { id: box.uniqueId, at: Date.now() };
        return;
    }
    // Offered once (WA announces a share from more than one place), as long as the share runs (taken down when it
    // ends), not for a few seconds.
    if (offers.has(box.uniqueId)) return;
    offers.add(box.uniqueId);
    notificationPlayingStore.playNotification(
        get(QL).studentSharing({ name: box.spaceUser.name ?? "" }),
        "quanta-share",
        `share-offer-${box.uniqueId}`,
        OFFER_MS,
        { tone: "action", action: { label: get(QL).showShare(), run: () => showOnStage(box.uniqueId) } },
    );
}

/** How long after the room loads what it finds already live counts as arriving, not as new. */
const ARRIVING_MS = 20_000;
let startedAt = 0;

function isStaffShare(item: StageItem): boolean {
    const box = pictureBox(item);
    return !!box && item.startsWith("screensharing_") && staffTarget(box.spaceUser.uuid, box.spaceUser.tags) === true;
}

/** A teacher's share waiting for its picture, to take the stage once it has one (if it comes soon). */
let pendingTakeover: { id: string; at: number } | null = null;
const PENDING_MS = 15_000;
/** Teachers' shares that have taken the stage (true once their picture has been seen): gone with their picture. */
const takenOver = new Map<string, boolean>();
/** Shares offered with a notice: the notice goes when the share does. */
const offers = new Set<string>();
const OFFER_MS = 10 * 60_000;

let started = false;
/** Starts reading WA's highlight and its pictures; `pin` tells the platform whether its board is on the stage. */
export function startStageModel(pin: (what: "room" | "board", picture: "screen" | "camera" | null) => void): void {
    tellPlatform = pin;
    if (started) return;
    started = true;
    startedAt = Date.now();
    // Anything that enlarges or closes a picture without asking here (the enlarge button, the minimise button, Escape,
    // the phone leaving full screen, WA dropping a picture that ended) is read as a pick or a close.
    // Lives as long as the page.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    highlightedEmbedScreen.subscribe((box) => {
        if (applying) return;
        if (box && box.uniqueId !== current) showOnStage(box.uniqueId);
        else if (!box && isPicture(current)) stageBack();
    });
    // A picture on the stage or in the history that no longer exists (its share stopped, its person left).
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    streamableCollectionStore.subscribe(() => {
        history = history.filter(exists);
        if (isPicture(current) && !exists(current)) stageBack();
        if (pendingTakeover && Date.now() - pendingTakeover.at > PENDING_MS) pendingTakeover = null;
        if (pendingTakeover && exists(pendingTakeover.id)) {
            const id = pendingTakeover.id;
            pendingTakeover = null;
            showOnStage(id);
        }
        for (const [id, seen] of takenOver) {
            if (exists(id)) takenOver.set(id, true);
            else if (seen) takenOver.delete(id);
        }
        for (const id of offers) {
            if (exists(id)) continue;
            offers.delete(id);
            notificationPlayingStore.removeNotificationById(`share-offer-${id}`);
        }
    });
}
