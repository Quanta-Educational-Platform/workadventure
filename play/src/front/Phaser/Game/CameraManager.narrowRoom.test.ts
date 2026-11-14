import * as Phaser from "phaser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { coWebsiteManager } from "../../Stores/CoWebsiteStore";
import { WaScaleManager } from "../Services/WaScaleManager";
import type { Game } from "./Game";
import type { GameScene } from "./GameScene";
import { CameraManager } from "./CameraManager";

// The classroom: 31 × 30 tiles of 32 pixels.
const TILE = 32;
const CLASSROOM = { width: 31 * TILE, height: 30 * TILE };

/** A CameraManager on a real Phaser camera and WaScaleManager; `resize` changes the room's frame and tells it. */
function room(first: { width: number; height: number }, dpr: number) {
    let screen = { ...first };
    vi.spyOn(coWebsiteManager, "getGameSize").mockImplementation(() => screen);
    vi.stubGlobal("devicePixelRatio", dpr);
    vi.stubGlobal("innerWidth", first.width);
    vi.stubGlobal("innerHeight", first.height);
    const events = new Phaser.Events.EventEmitter();
    const camera = new Phaser.Cameras.Scene2D.Camera(0, 0, 100, 100);
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
        events,
        scene: { getScenes: () => [] },
        markDirty: vi.fn(),
    } as unknown as Game;
    const scaleManager = new WaScaleManager(640 * 480, 196 * 196);
    scaleManager.setGame(game);
    const scene = {
        cameras: { main: camera },
        game,
        // Glides finish at once.
        tweens: {
            addCounter(config: { onUpdate?: (t: { getValue(): number }) => void; onComplete?: () => void }) {
                config.onUpdate?.({ getValue: () => 1 });
                config.onComplete?.();
                return { stop() {}, destroy() {} };
            },
        },
        markDirty: vi.fn(),
    } as unknown as GameScene;
    const manager = new CameraManager(scene, CLASSROOM, scaleManager);
    manager.fitRoom(TILE);
    return {
        manager,
        scaleManager,
        // CSS pixels per map pixel on screen.
        shown: () => camera.zoom * scale.zoom,
        resize(next: { width: number; height: number }, frame = next) {
            screen = { ...next };
            vi.stubGlobal("innerWidth", frame.width);
            vi.stubGlobal("innerHeight", frame.height);
            scaleManager.applyNewSize();
            manager.onScreenResized();
        },
    };
}

const root = document.documentElement;

describe("the room's zoom in a narrow frame", () => {
    afterEach(() => {
        root.style.removeProperty("--quanta-side-widens");
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    /** The platform widens the frame by `widens` for the open column, the room told how much (sidePanel.ts). */
    function openColumn(r: ReturnType<typeof room>, frame: { width: number; height: number }, widens: number) {
        root.style.setProperty("--quanta-side-widens", `${widens}px`);
        r.manager.onScreenResized();
        // The frame grows over the platform's slide, a step per frame.
        for (let grown = 0; grown < widens; grown = Math.min(widens, grown + 40)) {
            const width = frame.width + grown;
            r.resize({ width, height: frame.height });
            vi.advanceTimersByTime(16);
        }
        r.resize({ width: frame.width + widens, height: frame.height });
        vi.advanceTimersByTime(500);
    }

    function closeColumn(r: ReturnType<typeof room>, frame: { width: number; height: number }) {
        root.style.setProperty("--quanta-side-widens", "0px");
        r.resize(frame);
        vi.advanceTimersByTime(500);
    }

    it.each([
        { name: "the whole column", widens: 332 },
        { name: "what the page can spare", widens: 208 },
    ])("keeps the map's zoom as the column opens and closes, widening the frame by $name", ({ widens }) => {
        vi.useFakeTimers();
        const frame = { width: 512, height: 760 };
        const r = room(frame, 2);
        const fitted = r.shown();
        openColumn(r, frame, widens);
        expect(r.shown()).toBeCloseTo(fitted, 2);
        closeColumn(r, frame);
        expect(r.shown()).toBeCloseTo(fitted, 2);
    });

    it.each([
        { width: 512, height: 760, dpr: 2 },
        { width: 640, height: 760, dpr: 2 },
        { width: 900, height: 800, dpr: 2 },
        { width: 760, height: 850, dpr: 1 },
    ])("keeps the zoom as a board opens and closes in a $width × $height frame at $dpr×", ({ width, height, dpr }) => {
        vi.useFakeTimers();
        const frame = { width, height };
        const r = room(frame, dpr);
        const fitted = r.shown();
        // Half the canvas: on a 2× screen its pixel count drops a step of HdpiManager's optimal zoom level.
        r.resize({ width: width / 2, height }, frame);
        vi.advanceTimersByTime(500);
        expect(r.shown()).toBeCloseTo(fitted, 2);
        r.resize(frame);
        vi.advanceTimersByTime(500);
        expect(r.shown()).toBeCloseTo(fitted, 2);
    });

    it("keeps the zoom when the column widens a frame shared with a board", () => {
        vi.useFakeTimers();
        const frame = { width: 512, height: 760 };
        const r = room(frame, 2);
        r.resize({ width: 256, height: 760 }, frame);
        const kept = r.shown();
        root.style.setProperty("--quanta-side-widens", "332px");
        r.resize({ width: 422, height: 760 }, { width: 844, height: 760 });
        vi.advanceTimersByTime(500);
        expect(r.shown()).toBeCloseTo(kept, 2);
    });

    it("keeps the zoom through a frame that wavers by a few pixels, and fits a real resize", () => {
        vi.useFakeTimers();
        const frame = { width: 760, height: 850 };
        const r = room(frame, 1);
        const fitted = r.shown();
        for (const width of [762, 758, 761, 760]) {
            r.resize({ width, height: 850 });
            vi.advanceTimersByTime(500);
            expect(r.shown()).toBe(fitted);
        }
        r.resize({ width: 600, height: 850 });
        vi.advanceTimersByTime(500);
        expect(r.shown()).toBeLessThan(fitted * 0.85);
    });
});
