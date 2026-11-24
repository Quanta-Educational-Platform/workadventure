// quanta: while a board fills the stage, everything the room says above the dock (the on-air line, OnAirStrip.svelte,
// and the notice stack, NoticeStack.svelte) shares one row, so the board gives up the height of one card and no more.
// The most important message holds the row; "+N" beside it opens the rest above it until it is pressed again or the
// mouse moves away. Off the board each keeps its own place, as before.
import { derived, get, writable, type Readable } from "svelte/store";
import { boardOnStageStore } from "./stage";

/** How much a message matters under a board: the highest holds the row, the newest of equals. */
export const LANE_RANK = {
    /** Something is broken for this person or the class: a lost link, a microphone the browser blocks. */
    problem: 100,
    /** This person is on air and must act for the class to hear them. */
    actOnAir: 90,
    /** Staff's message to everyone. */
    staffMessage: 80,
    /** Someone asks this person for something: a student's share to show, a teacher's request. */
    action: 70,
    toast: 60,
    /** Who the class is hearing now (staff). */
    speakers: 40,
    /** A hint this person may ignore. */
    hint: 30,
    information: 25,
    /** The header already shows the recording; its notice yields under a board. */
    recording: 20,
    /** This person on air and heard: the megaphone button and the header say so too. */
    heard: 10,
} as const;

export type LaneOffer = { key: string; rank: number };

const offers = writable<Record<string, readonly LaneOffer[]>>({});
// When each key was first offered: the newest of equal rank wins.
const firstSeen = new Map<string, number>();
let seen = 0;

/** One source's messages now (replacing what it offered before). */
export function offerLane(source: string, list: readonly LaneOffer[]): void {
    offers.update((all) => ({ ...all, [source]: list }));
}

/** Opened to show every message, by "+N". */
export const laneOpen = writable(false);

export interface Lane {
    /** One row only: a board is on the stage. */
    active: boolean;
    /** The message holding the row. */
    winner: string | undefined;
    /** How many wait behind it. */
    others: number;
    open: boolean;
}

export const laneStore: Readable<Lane> = derived(
    [offers, boardOnStageStore, laneOpen],
    ([$offers, $board, $open]) => {
        const all = Object.values($offers).flat();
        const present = new Set(all.map((offer) => offer.key));
        for (const key of [...firstSeen.keys()]) if (!present.has(key)) firstSeen.delete(key);
        for (const offer of all) if (!firstSeen.has(offer.key)) firstSeen.set(offer.key, ++seen);
        let winner: LaneOffer | undefined;
        for (const offer of all) {
            if (
                !winner ||
                offer.rank > winner.rank ||
                (offer.rank === winner.rank && (firstSeen.get(offer.key) ?? 0) > (firstSeen.get(winner.key) ?? 0))
            )
                winner = offer;
        }
        return {
            active: $board,
            winner: winner?.key,
            others: Math.max(0, all.length - 1),
            open: $board && $open && all.length > 1,
        };
    },
);

/** Whether a message shows now. */
export function laneShows(lane: Lane, key: string): boolean {
    return !lane.active || lane.open || lane.winner === key;
}

// Nothing left behind the row, or no board: closed again.
// Lives as long as the page.
// eslint-disable-next-line svelte/no-ignored-unsubscribe
laneStore.subscribe((lane) => {
    if (get(laneOpen) && (!lane.active || lane.others === 0)) laneOpen.set(false);
});

/**
 * While open, closes once the mouse is well away from every message (or leaves the room for the board). Judged on
 * their boxes together: opening moves the cards, so the pointer may rest in a gap between them. A finger lifting is
 * no leaving: on touch the list stays until "+N" is pressed again.
 */
export function closeLaneWhenMouseLeaves(): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
        clearTimeout(timer);
        timer = setTimeout(() => laneOpen.set(false), 600);
    };
    const onMove = (event: PointerEvent) => {
        if (event.pointerType !== "mouse") return;
        const near = [
            ...document.querySelectorAll<HTMLElement>("[data-quanta-notices] > *, [data-testid='quanta-on-air-strip'] > *"),
        ].some((element) => {
            const box = element.getBoundingClientRect();
            return (
                box.height > 0 &&
                event.clientX >= box.left - 16 &&
                event.clientX <= box.right + 16 &&
                event.clientY >= box.top - 16 &&
                event.clientY <= box.bottom + 16
            );
        });
        if (near) clearTimeout(timer);
        else later();
    };
    const onLeave = (event: PointerEvent) => {
        if (event.pointerType === "mouse") later();
    };
    const root = document.documentElement;
    document.addEventListener("pointermove", onMove);
    root.addEventListener("pointerleave", onLeave);
    return () => {
        clearTimeout(timer);
        document.removeEventListener("pointermove", onMove);
        root.removeEventListener("pointerleave", onLeave);
    };
}
