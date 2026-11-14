// quanta: short first-time hints over the dock, each shown a couple of times at most, and never again once the person
// has used what it points at: the megaphone spots at the tables, and the reactions.
import { get, writable } from "svelte/store";
import type { AreaData } from "@workadventure/map-editor";
import { userIsAdminStore } from "../Stores/GameStore";
import { isMegaphoneSpot } from "./megaphoneSpots";
import { selfOnAirStore } from "./speakingToClass";

export type DockHint = "megaphone" | "reactions";

export const MAX_HINT_SHOWS = 2;
export const HINT_MS = 8000;
const STORAGE_KEY = "quanta.dockHints";

type HintStorage = Pick<Storage, "getItem" | "setItem">;

/** How often each hint was shown, kept in the browser; once a page load at most. */
export class HintBudget {
    private readonly shownThisPage = new Set<DockHint>();

    constructor(
        private readonly storage: HintStorage | undefined,
        private readonly max = MAX_HINT_SHOWS,
    ) {}

    private read(): Partial<Record<DockHint, number>> {
        try {
            const parsed: unknown = JSON.parse(this.storage?.getItem(STORAGE_KEY) ?? "{}");
            if (!parsed || typeof parsed !== "object") return {};
            return parsed;
        } catch {
            return {};
        }
    }

    private write(hint: DockHint, count: number): void {
        try {
            this.storage?.setItem(STORAGE_KEY, JSON.stringify({ ...this.read(), [hint]: count }));
        } catch {
            // Storage full or blocked: the hint may show again on the next visit.
        }
    }

    public canShow(hint: DockHint): boolean {
        if (this.shownThisPage.has(hint)) return false;
        const count = this.read()[hint];
        return (typeof count === "number" ? count : 0) < this.max;
    }

    public shown(hint: DockHint): void {
        this.shownThisPage.add(hint);
        const count = this.read()[hint];
        this.write(hint, (typeof count === "number" ? count : 0) + 1);
    }

    public done(hint: DockHint): void {
        this.write(hint, this.max);
    }
}

function browserStorage(): HintStorage | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

let budget = new HintBudget(browserStorage());

export function resetDockHintsForTests(storage?: HintStorage): void {
    budget = new HintBudget(storage);
    dismissHint();
}

export const dockHintStore = writable<DockHint | undefined>(undefined);
let hideTimer: ReturnType<typeof setTimeout> | undefined;

/** Shows `hint` for a few seconds, unless another one is up or this one was shown enough. */
export function offerHint(hint: DockHint): boolean {
    if (get(dockHintStore) !== undefined || !budget.canShow(hint)) return false;
    budget.shown(hint);
    dockHintStore.set(hint);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => dismissHint(hint), HINT_MS);
    return true;
}

/** Hides `hint` (any hint without one); it may still show on a later visit. */
export function dismissHint(hint?: DockHint): void {
    if (hint !== undefined && get(dockHintStore) !== hint) return;
    clearTimeout(hideTimer);
    hideTimer = undefined;
    dockHintStore.set(undefined);
}

/** The person used what the hint points at: it never shows again. */
export function hintDone(hint: DockHint): void {
    budget.done(hint);
    dismissHint(hint);
}

// Two tiles: beside a table's spot, not across the room from it.
export const MEGAPHONE_HINT_RADIUS = 64;

/** Within `radius` of one of `spots`, and on none of them. */
export function nearSpot(
    at: { x: number; y: number },
    spots: Iterable<Pick<AreaData, "x" | "y" | "width" | "height">>,
    radius = MEGAPHONE_HINT_RADIUS,
): boolean {
    let near = false;
    for (const spot of spots) {
        const dx = Math.max(spot.x - at.x, 0, at.x - (spot.x + spot.width));
        const dy = Math.max(spot.y - at.y, 0, at.y - (spot.y + spot.height));
        if (dx === 0 && dy === 0) return false;
        if (Math.hypot(dx, dy) <= radius) near = true;
    }
    return near;
}

/** A student stopped walking at `at`: beside a megaphone spot, they are told what it is for. */
export function considerMegaphoneHint(at: { x: number; y: number }, areas: Iterable<AreaData>): void {
    if (get(userIsAdminStore) || get(selfOnAirStore)) return;
    if (nearSpot(at, [...areas].filter(isMegaphoneSpot))) offerHint("megaphone");
}
