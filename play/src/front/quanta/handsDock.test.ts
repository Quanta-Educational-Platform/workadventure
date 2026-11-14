import { expect, it, vi } from "vitest";

vi.mock("./sidePanel", async () => {
    const { writable } = await import("svelte/store");
    return {
        sidePanelReservedStore: writable(false),
        sidePanelLayoutStore: writable({ width: 360, margin: 12 }),
    };
});
vi.mock("../Stores/CoWebsiteStore", async () => {
    const { writable } = await import("svelte/store");
    return {
        canvasSize: writable({ width: 1200, height: 800 }),
        coWebsites: writable([]),
        windowSize: writable({ width: 1200, height: 800 }),
    };
});

import { get, type Writable } from "svelte/store";
import { sidePanelReservedStore } from "./sidePanel";
import { handsDockOpen, mapAreaWidthStore } from "./handsDock";

it("shows only the header on a map narrower than 880px, until the person opens it", () => {
    expect(handsDockOpen(undefined, 1000, true)).toBe(true);
    expect(handsDockOpen(undefined, 879, true)).toBe(false);
    expect(handsDockOpen(true, 600, true)).toBe(true);
    expect(handsDockOpen(false, 1400, true)).toBe(false);
    expect(handsDockOpen(undefined, 600, false)).toBe(true);
});

it("measures the map beside the side column", () => {
    expect(get(mapAreaWidthStore)).toBe(1200);
    (sidePanelReservedStore as Writable<boolean>).set(true);
    expect(get(mapAreaWidthStore)).toBe(828);
});
