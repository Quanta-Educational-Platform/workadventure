import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { get, type writable } from "svelte/store";
import type { AreaData } from "@workadventure/map-editor";

vi.mock("../Stores/GameStore", async () => {
    const { writable } = await import("svelte/store");
    return { userIsAdminStore: writable(false) };
});
vi.mock("./speakingToClass", async () => {
    const { writable } = await import("svelte/store");
    return { selfOnAirStore: writable(false) };
});
import { userIsAdminStore } from "../Stores/GameStore";
import { selfOnAirStore } from "./speakingToClass";
import {
    considerMegaphoneHint,
    dismissHint,
    dockHintStore,
    HINT_MS,
    HintBudget,
    hintDone,
    nearSpot,
    offerHint,
    resetDockHintsForTests,
} from "./dockHints";

function memoryStorage() {
    const items = new Map<string, string>();
    return {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => {
            items.set(key, value);
        },
    };
}

let storage = memoryStorage();

beforeEach(() => {
    storage = memoryStorage();
    resetDockHintsForTests(storage);
});

afterEach(() => {
    vi.useRealTimers();
    userIsAdminStore.set(false);
    (selfOnAirStore as unknown as ReturnType<typeof writable<boolean>>).set(false);
});

it("shows a hint twice at most, once a page load, and never once its feature was used", () => {
    const budget = new HintBudget(storage);
    expect(budget.canShow("megaphone")).toBe(true);
    budget.shown("megaphone");
    expect(budget.canShow("megaphone")).toBe(false);
    // The next visit.
    const next = new HintBudget(storage);
    expect(next.canShow("megaphone")).toBe(true);
    next.shown("megaphone");
    expect(new HintBudget(storage).canShow("megaphone")).toBe(false);

    const used = new HintBudget(storage);
    expect(used.canShow("reactions")).toBe(true);
    used.done("reactions");
    expect(new HintBudget(storage).canShow("reactions")).toBe(false);
    // Unreadable storage is a first visit; no storage at all still works.
    storage.setItem("quanta.dockHints", "{");
    expect(new HintBudget(storage).canShow("reactions")).toBe(true);
    expect(new HintBudget(undefined).canShow("reactions")).toBe(true);
});

it("shows one hint at a time for a few seconds, and closes it on request or once used", () => {
    vi.useFakeTimers();
    expect(offerHint("megaphone")).toBe(true);
    expect(get(dockHintStore)).toBe("megaphone");
    expect(offerHint("reactions")).toBe(false);
    vi.advanceTimersByTime(HINT_MS);
    expect(get(dockHintStore)).toBeUndefined();

    expect(offerHint("reactions")).toBe(true);
    dismissHint("megaphone");
    expect(get(dockHintStore)).toBe("reactions");
    hintDone("reactions");
    expect(get(dockHintStore)).toBeUndefined();
    resetDockHintsForTests(storage);
    expect(offerHint("reactions")).toBe(false);
});

const spot = (x: number, y: number) =>
    ({
        id: `spot-${x}`,
        name: "quanta:megaphone:1",
        x,
        y,
        width: 32,
        height: 32,
        properties: [],
    }) as unknown as AreaData;

it("is beside a spot within two tiles, not on it and not across the room", () => {
    const spots = [spot(100, 100)];
    expect(nearSpot({ x: 150, y: 116 }, spots)).toBe(true);
    expect(nearSpot({ x: 116, y: 116 }, spots)).toBe(false);
    expect(nearSpot({ x: 300, y: 116 }, spots)).toBe(false);
    // On one spot and beside another: already on air.
    expect(nearSpot({ x: 116, y: 116 }, [spot(160, 100), spot(100, 100)])).toBe(false);
});

it("tells a student beside a spot, not staff, not someone on air, and not beside other areas", () => {
    const board: AreaData = { ...spot(100, 100), name: "quanta:whiteboard:main" };
    considerMegaphoneHint({ x: 150, y: 116 }, [board]);
    expect(get(dockHintStore)).toBeUndefined();

    userIsAdminStore.set(true);
    considerMegaphoneHint({ x: 150, y: 116 }, [spot(100, 100)]);
    expect(get(dockHintStore)).toBeUndefined();
    userIsAdminStore.set(false);
    (selfOnAirStore as unknown as ReturnType<typeof writable<boolean>>).set(true);
    considerMegaphoneHint({ x: 150, y: 116 }, [spot(100, 100)]);
    expect(get(dockHintStore)).toBeUndefined();
    (selfOnAirStore as unknown as ReturnType<typeof writable<boolean>>).set(false);

    considerMegaphoneHint({ x: 150, y: 116 }, [spot(100, 100)]);
    expect(get(dockHintStore)).toBe("megaphone");
});
