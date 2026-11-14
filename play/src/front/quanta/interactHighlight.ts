// quanta: the object a person can act on from where they stand (a board, whose area's prompt is showing) gets a soft
// pulsing outline, as the prompt alone is easy to miss.
import type { AreaData } from "@workadventure/map-editor";
import type * as Phaser from "phaser";

export interface HighlightRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

const BOARD_PREFIX = "quanta:whiteboard:";
/** A board's area also holds the row one stands on to reach it, below the board, and a little air above it. */
const BOARD_AISLE = 32;
const BOARD_TOP = 8;

const COLOR = 0xf5c542;
const LINE = 3;
const RADIUS = 6;
const PULSE_MS = 900;
/** Over the floor, under every character (whose depth is its y). */
const DEPTH = 1;

/** Whether being in this area lets its person act on something: it has a website to open on a key press. */
export function isInteractiveArea(area: Pick<AreaData, "properties">): boolean {
    return (area.properties ?? []).some((property) => property.type === "openWebsite" && property.trigger === "onaction");
}

/** Where the object is drawn in the area. */
export function highlightRect(area: Pick<AreaData, "name" | "x" | "y" | "width" | "height">): HighlightRect {
    if ((area.name ?? "").startsWith(BOARD_PREFIX) && area.height > BOARD_AISLE + BOARD_TOP)
        return {
            x: area.x,
            y: area.y + BOARD_TOP,
            width: area.width,
            height: area.height - BOARD_AISLE - BOARD_TOP,
        };
    return { x: area.x, y: area.y, width: area.width, height: area.height };
}

export class InteractHighlights {
    private readonly shown = new Map<string, { graphics: Phaser.GameObjects.Graphics; tween: Phaser.Tweens.Tween }>();

    constructor(private readonly scene: Phaser.Scene) {}

    enter(area: AreaData): void {
        if (!isInteractiveArea(area) || this.shown.has(area.id)) return;
        const rect = highlightRect(area);
        const graphics = this.scene.add.graphics();
        graphics.setDepth(DEPTH);
        graphics.lineStyle(LINE, COLOR, 1);
        graphics.strokeRoundedRect(rect.x, rect.y, rect.width, rect.height, RADIUS);
        graphics.setAlpha(0.25);
        const tween = this.scene.tweens.add({
            targets: graphics,
            alpha: 0.9,
            duration: PULSE_MS,
            yoyo: true,
            repeat: -1,
            ease: "Sine.easeInOut",
        });
        this.shown.set(area.id, { graphics, tween });
    }

    leave(area: Pick<AreaData, "id">): void {
        const shown = this.shown.get(area.id);
        if (!shown) return;
        shown.tween.remove();
        shown.graphics.destroy();
        this.shown.delete(area.id);
    }
}
