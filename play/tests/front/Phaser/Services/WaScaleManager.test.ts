import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/front/Stores/CoWebsiteStore", () => ({
    coWebsiteManager: { getGameSize: () => ({ width: 1800, height: 1060 }) },
}));
vi.mock("../../../../src/front/Phaser/Login/ResizableScene", () => ({ ResizableScene: class {} }));

import { WaScaleManager } from "../../../../src/front/Phaser/Services/WaScaleManager";
import type { Game } from "../../../../src/front/Phaser/Game/Game";

// Whatever listens to the canvas resizing (Game.ts calls the scenes' onResize, which sets the camera's bounds from
// its width and zoom) must see the camera zoom that goes with the new size.
function setUp() {
    const camera = { zoom: 1, width: 0, setZoom: vi.fn((zoom: number) => (camera.zoom = zoom)) };
    const seen: { width: number; zoom: number }[] = [];
    const scale = {
        width: 0,
        height: 0,
        resize: vi.fn((width: number, height: number) => {
            scale.width = width;
            scale.height = height;
            camera.width = width;
            seen.push({ width: camera.width, zoom: camera.zoom });
        }),
        setZoom: vi.fn(() => seen.push({ width: camera.width, zoom: camera.zoom })),
    };
    const game = {
        scale,
        canvas: { style: {} },
        scene: { getScenes: () => [] },
        events: { emit: vi.fn() },
        markDirty: vi.fn(),
    } as unknown as Game;
    const manager = new WaScaleManager(640 * 480, 196 * 196);
    vi.stubGlobal("devicePixelRatio", 2);
    manager.setGame(game);
    return { manager, camera, seen };
}

describe("WaScaleManager", () => {
    it("sets the camera's zoom before the canvas resize is announced, when a zoom animation ends", () => {
        const { manager, camera, seen } = setUp();
        manager.setZoomModifier(1.3, camera as never, true);
        seen.length = 0;

        manager.setZoomModifier(1.3, camera as never, false);

        expect(seen.length).toBeGreaterThan(0);
        for (const moment of seen) expect(moment.zoom).toBe(camera.zoom);
        expect(Number.isInteger(camera.zoom)).toBe(true);
    });

    it("does the same as a zoom animation starts", () => {
        const { manager, camera, seen } = setUp();
        manager.setZoomModifier(1, camera as never, false);
        seen.length = 0;

        manager.setZoomModifier(1.3, camera as never, true);

        expect(seen.length).toBeGreaterThan(0);
        for (const moment of seen) expect(moment.zoom).toBe(camera.zoom);
    });
});
