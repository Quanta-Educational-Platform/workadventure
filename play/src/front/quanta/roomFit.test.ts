import * as Phaser from "phaser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { coWebsiteManager } from "../Stores/CoWebsiteStore";
import { WaScaleManager } from "../Phaser/Services/WaScaleManager";
import type { Game } from "../Phaser/Game/Game";
import {
    MIN_FITTED_TILE_PX,
    NO_INSETS,
    roomBounds,
    roomFit,
    roomFitScale,
    roomFitTarget,
    roomFitView,
    type Size,
    windowView,
} from "./roomFit";

// The classroom: 31 × 30 tiles of 32 pixels.
const TILE = 32;
const CLASSROOM = { width: 31 * TILE, height: 30 * TILE };

describe("roomFit", () => {
    it("shows the whole room while a tile stays at least MIN_FITTED_TILE_PX wide", () => {
        expect(roomFit({ width: 1920, height: 1080 }, CLASSROOM, TILE)).toBe("whole");
        expect(roomFit({ width: 1280, height: 720 }, CLASSROOM, TILE)).toBe("whole");
        // A wide, short window: the height decides, 480 / 960 = half size, a 16 pixel tile.
        expect(roomFit({ width: 1400, height: 480 }, CLASSROOM, TILE)).toBe("whole");
        expect(roomFit({ width: 1400, height: 479 }, CLASSROOM, TILE)).toBe("width");
        // A phone on its side.
        expect(roomFit({ width: 800, height: 360 }, CLASSROOM, TILE)).toBe("width");
        expect(MIN_FITTED_TILE_PX).toBe(16);
    });

    it("never shows the whole room on a screen that isn't laid out yet", () => {
        expect(roomFit({ width: 0, height: 0 }, CLASSROOM, TILE)).toBe("width");
    });

    it("contains the whole room, or the width alone", () => {
        expect(roomFitView("whole", CLASSROOM)).toEqual(CLASSROOM);
        expect(roomFitView("width", CLASSROOM)).toEqual({ width: CLASSROOM.width, height: 0 });
    });
});

describe("roomBounds", () => {
    it("is the room itself when the view is no larger", () => {
        expect(roomBounds(CLASSROOM, { width: 500, height: 400 })).toEqual({ x: 0, y: 0, ...CLASSROOM });
        expect(roomBounds(CLASSROOM, CLASSROOM)).toEqual({ x: 0, y: 0, ...CLASSROOM });
    });

    it("widens symmetrically along each axis where the view is larger", () => {
        expect(roomBounds(CLASSROOM, { width: 1700, height: 960 })).toEqual({
            x: -(1700 - 992) / 2,
            y: 0,
            width: 1700,
            height: 960,
        });
        expect(roomBounds(CLASSROOM, { width: 992, height: 1500 })).toEqual({
            x: 0,
            y: -(1500 - 960) / 2,
            width: 992,
            height: 1500,
        });
    });
});

/**
 * Runs the fit the way CameraManager.refitRoom does, through the real WaScaleManager and a real Phaser camera, and
 * returns what the screen shows: the camera's zoom and the map rectangle it sees with the avatar at `avatar`.
 */
function fitOnScreen(screen: Size, devicePixelRatio: number, avatar: { x: number; y: number }) {
    vi.spyOn(coWebsiteManager, "getGameSize").mockReturnValue(screen);
    vi.stubGlobal("devicePixelRatio", devicePixelRatio);
    const scale = {
        width: 0,
        height: 0,
        zoom: 1,
        resize(width: number, height: number) {
            this.width = width;
            this.height = height;
            camera.setSize(width, height);
        },
        setZoom(zoom: number) {
            this.zoom = zoom;
        },
    };
    const canvas = { style: { imageRendering: "" } };
    const game = {
        scale,
        canvas,
        events: { emit: vi.fn() },
        scene: { getScenes: () => [] },
        markDirty: vi.fn(),
    } as unknown as Game;
    const camera = new Phaser.Cameras.Scene2D.Camera(0, 0, 100, 100);
    const scaleManager = new WaScaleManager(640 * 480, 196 * 196);
    scaleManager.setGame(game);

    const fit = roomFit(screen, CLASSROOM, TILE);
    const view = roomFitView(fit, CLASSROOM);
    scaleManager.maxZoomOut = scaleManager.getTargetZoomModifierFor(CLASSROOM.width, CLASSROOM.height);
    scaleManager.setZoomModifier(scaleManager.getTargetZoomModifierFor(view.width, view.height), camera);

    const seen = { width: camera.width / camera.zoom, height: camera.height / camera.zoom };
    const bounds = roomBounds(CLASSROOM, seen);
    camera.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
    // What Phaser's follow does each frame: centre on the avatar, then clamp to the bounds.
    const scrollX = camera.clampX(avatar.x - camera.width / 2);
    const scrollY = camera.clampY(avatar.y - camera.height / 2);
    const left = scrollX + (camera.width - seen.width) / 2;
    const top = scrollY + (camera.height - seen.height) / 2;
    return {
        fit,
        drawnZoom: camera.zoom,
        cssPixelsPerMapPixel: camera.zoom * scale.zoom * devicePixelRatio,
        cssZoom: scaleManager.getActualZoom(),
        seen: { x: left, y: top, ...seen },
        imageRendering: canvas.style.imageRendering,
    };
}

describe("a fitted classroom on screen", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    const corners = [
        { x: 0, y: 0 },
        { x: CLASSROOM.width, y: CLASSROOM.height },
        { x: 200, y: 900 },
    ];

    it.each([
        { screen: { width: 1920, height: 1080 }, dpr: 1 },
        { screen: { width: 1440, height: 900 }, dpr: 2 },
        { screen: { width: 1366, height: 768 }, dpr: 1 },
        { screen: { width: 1180, height: 820 }, dpr: 2 },
        { screen: { width: 1024, height: 1366 }, dpr: 2 },
    ])("shows all of it, centred, wherever the avatar is ($screen.width×$screen.height @$dpr)", ({ screen, dpr }) => {
        for (const avatar of corners) {
            const shown = fitOnScreen(screen, dpr, avatar);
            expect(shown.fit).toBe("whole");
            const contain = Math.min(screen.width / CLASSROOM.width, screen.height / CLASSROOM.height);
            expect(shown.cssZoom).toBeCloseTo(contain, 2);
            // Drawn at a whole zoom, then scaled smoothly to the exact fit (sharp bilinear).
            expect(Number.isInteger(shown.drawnZoom)).toBe(true);
            expect(shown.drawnZoom).toBeGreaterThanOrEqual(1);
            // The whole room is in view, with as much ground on one side as on the other.
            expect(shown.seen.x).toBeLessThanOrEqual(0.01);
            expect(shown.seen.y).toBeLessThanOrEqual(0.01);
            expect(shown.seen.x + shown.seen.width).toBeGreaterThanOrEqual(CLASSROOM.width - 0.01);
            expect(shown.seen.y + shown.seen.height).toBeGreaterThanOrEqual(CLASSROOM.height - 0.01);
            expect(shown.seen.x + shown.seen.width / 2).toBeCloseTo(CLASSROOM.width / 2, 3);
            expect(shown.seen.y + shown.seen.height / 2).toBeCloseTo(CLASSROOM.height / 2, 3);
            // One axis fits exactly: no more ground than the screen's shape needs.
            const spare = Math.min(shown.seen.width - CLASSROOM.width, shown.seen.height - CLASSROOM.height);
            expect(spare).toBeLessThan(CLASSROOM.width * 0.01);
        }
    });

    it("on a screen too small for that, fills the width and follows the avatar up and down", () => {
        const screen = { width: 800, height: 360 };
        const top = fitOnScreen(screen, 3, { x: 500, y: 0 });
        const bottom = fitOnScreen(screen, 3, { x: 500, y: CLASSROOM.height });
        const middle = fitOnScreen(screen, 3, { x: 0, y: 480 });
        for (const shown of [top, bottom, middle]) {
            expect(shown.fit).toBe("width");
            expect(shown.cssZoom).toBeCloseTo(screen.width / CLASSROOM.width, 2);
            expect(shown.cssZoom * TILE).toBeGreaterThanOrEqual(MIN_FITTED_TILE_PX);
            expect(Number.isInteger(shown.drawnZoom)).toBe(true);
            expect(shown.seen.x).toBeCloseTo(0, 2);
            expect(shown.seen.width).toBeCloseTo(CLASSROOM.width, 0);
            expect(shown.seen.height).toBeLessThan(CLASSROOM.height);
        }
        expect(top.seen.y).toBeCloseTo(0, 2);
        expect(bottom.seen.y + bottom.seen.height).toBeCloseTo(CLASSROOM.height, 2);
        expect(middle.seen.y + middle.seen.height / 2).toBeCloseTo(480, 2);
    });
});

describe("a refit from inside Phaser's resize", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    // Phaser emits RESIZE synchronously from scale.resize, and GameScene.onResize refits the room from there.
    it("leaves the canvas displayed at the screen's size", () => {
        let screen = { width: 576, height: 856 };
        vi.spyOn(coWebsiteManager, "getGameSize").mockImplementation(() => screen);
        vi.stubGlobal("devicePixelRatio", 2);
        const canvas = { style: { imageRendering: "", width: 0 } };
        let onResize = (): void => {};
        const scale = {
            width: 0,
            height: 0,
            zoom: 1,
            // Phaser's NONE scale mode: the CSS width is the canvas width times the zoom current at each call.
            resize(width: number, height: number) {
                this.width = Math.floor(width);
                this.height = Math.floor(height);
                canvas.style.width = Math.floor(this.width * this.zoom);
                onResize();
            },
            setZoom(zoom: number) {
                this.zoom = zoom;
                canvas.style.width = Math.floor(this.width * this.zoom);
            },
        };
        const game = {
            scale,
            canvas,
            events: { emit: vi.fn() },
            scene: { getScenes: () => [] },
            markDirty: vi.fn(),
        } as unknown as Game;
        const camera = new Phaser.Cameras.Scene2D.Camera(0, 0, 100, 100);
        const scaleManager = new WaScaleManager(640 * 480, 196 * 196);
        scaleManager.setGame(game);
        const fit = () => scaleManager.getTargetZoomModifierFor(CLASSROOM.width, CLASSROOM.height);
        scaleManager.setZoomModifier(fit(), camera);

        let fitted = { ...screen };
        onResize = () => {
            const now = coWebsiteManager.getGameSize();
            if (now.width === fitted.width && now.height === fitted.height) return;
            fitted = { ...now };
            scaleManager.setZoomModifier(fit(), camera);
        };
        for (const next of [
            { width: 1440, height: 856 },
            { width: 576, height: 856 },
            { width: 1440, height: 856 },
        ]) {
            screen = next;
            scaleManager.applyNewSize();
            expect(canvas.style.width).toBeGreaterThanOrEqual(next.width - 1);
            expect(canvas.style.width).toBeLessThanOrEqual(next.width + 1);
            expect(scaleManager.getActualZoom()).toBeCloseTo(
                Math.min(next.width / CLASSROOM.width, next.height / CLASSROOM.height),
                2,
            );
        }
    });
});

describe("the room's window", () => {
    const WINDOW_INSETS = { top: 12, right: 12, bottom: 96, left: 12 };

    it("fits the whole room inside the window, not the canvas", () => {
        const screen = { width: 1440, height: 856 };
        const target = roomFitTarget(screen, WINDOW_INSETS, CLASSROOM, TILE);
        // The camera fills the canvas with `target`; the room then takes this much of the window.
        const cssPerMapPixel = Math.min(screen.width / target.width, screen.height / target.height);
        expect(CLASSROOM.height * cssPerMapPixel).toBeCloseTo(856 - 12 - 96, 3);
        expect(CLASSROOM.width * cssPerMapPixel).toBeLessThanOrEqual(1440 - 24);
    });

    it("fits the narrower window when the chat column opens", () => {
        const screen = { width: 1000, height: 856 };
        const target = roomFitTarget(screen, { ...WINDOW_INSETS, right: 12 + 332 }, CLASSROOM, TILE);
        const cssPerMapPixel = Math.min(screen.width / target.width, screen.height / target.height);
        expect(CLASSROOM.width * cssPerMapPixel).toBeCloseTo(1000 - 12 - 344, 3);
    });

    it("is the whole canvas without insets", () => {
        expect(windowView(CLASSROOM, { width: 1440, height: 856 }, NO_INSETS)).toEqual(CLASSROOM);
    });

    it("keeps the room in the window's middle, or lets each edge reach the window's edge", () => {
        // Window 1700 - 10 - 90 = 1600 wide: 304 spare, 152 each side of the room past the left inset.
        expect(
            roomBounds(CLASSROOM, { width: 1700, height: 900 }, { top: 20, right: 90, bottom: 80, left: 10 }),
        ).toEqual({
            x: -(10 + (1600 - 992) / 2),
            y: -20,
            width: 1700,
            height: 960 + 20 + 80,
        });
    });
});

describe("a board or the chat beside the map", () => {
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    const WINDOW_INSETS = { top: 12, right: 12, bottom: 96, left: 12 };

    it("is the scale of the fit in the room's own window", () => {
        const screen = { width: 1440, height: 856 };
        expect(roomFitScale(screen, WINDOW_INSETS, CLASSROOM, TILE)).toBeCloseTo((856 - 12 - 96) / CLASSROOM.height, 6);
        // A phone fills the width.
        expect(roomFitScale({ width: 800, height: 360 }, NO_INSETS, CLASSROOM, TILE)).toBeCloseTo(
            800 / CLASSROOM.width,
        );
    });

    // CameraManager keeps the scale with getTargetZoomModifierFor(canvas / scale) on the map's new canvas.
    it.each([
        { name: "landscape, board beside the map", dpr: 2, canvas: { width: 720, height: 856 } },
        { name: "landscape 1x, board beside the map", dpr: 1, canvas: { width: 432, height: 856 } },
        // The room beside the course page is portrait: the board takes the top half of a 576 px frame.
        { name: "portrait 1x, board above the map", dpr: 1, canvas: { width: 576, height: 428 } },
        { name: "portrait 2x, board above the map", dpr: 2, canvas: { width: 576, height: 428 } },
    ])("keeps the room's on-screen scale ($name), also while gliding", ({ dpr, canvas }) => {
        let screen = { width: 1440, height: 856 };
        vi.spyOn(coWebsiteManager, "getGameSize").mockImplementation(() => screen);
        vi.stubGlobal("devicePixelRatio", dpr);
        const scale = {
            width: 0,
            height: 0,
            zoom: 1,
            resize(width: number, height: number) {
                this.width = width;
                this.height = height;
                camera.setSize(width, height);
            },
            setZoom(zoom: number) {
                this.zoom = zoom;
            },
        };
        const game = {
            scale,
            canvas: { style: { imageRendering: "" } },
            events: { emit: vi.fn() },
            scene: { getScenes: () => [] },
            markDirty: vi.fn(),
        } as unknown as Game;
        const camera = new Phaser.Cameras.Scene2D.Camera(0, 0, 100, 100);
        const scaleManager = new WaScaleManager(640 * 480, 196 * 196);
        scaleManager.setGame(game);
        // Canvas pixels per map pixel times CSS pixels per canvas pixel.
        const shown = () => camera.zoom * scale.zoom;
        const keep = (s: number) => scaleManager.getTargetZoomModifierFor(screen.width / s, screen.height / s);
        // CameraManager's limit is the whole room in the window, further out than anything here.
        scaleManager.maxZoomOut = 0.05;

        const fitted = roomFitScale(screen, WINDOW_INSETS, CLASSROOM, TILE);
        scaleManager.setZoomModifier(keep(fitted), camera);
        expect(shown()).toBeCloseTo(fitted, 3);

        screen = canvas;
        scaleManager.setZoomModifier(keep(fitted), camera, true);
        expect(shown()).toBeCloseTo(fitted, 2);
        scaleManager.setZoomModifier(keep(fitted), camera);
        expect(shown()).toBeCloseTo(fitted, 2);
        expect(scaleManager.getActualZoom()).toBeCloseTo(fitted, 2);
        // Zooming still works on the small canvas.
        scaleManager.setZoomModifier(keep(fitted * 1.5), camera);
        expect(shown()).toBeCloseTo(fitted * 1.5, 2);

        screen = { width: 1440, height: 856 };
        scaleManager.setZoomModifier(keep(fitted), camera);
        expect(shown()).toBeCloseTo(fitted, 3);
    });
});
