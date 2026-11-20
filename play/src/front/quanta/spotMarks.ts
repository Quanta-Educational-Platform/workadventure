// quanta: every megaphone spot is marked on the floor the same way on every map, as a dashed square on the one tile a
// person stands on to speak from it (as Gather marks its spotlight tiles), not as an object one might take for
// furniture. The square darkens whatever floor it sits on, so it reads as a shade of that rug rather than a sticker;
// the spot the player speaks from turns green, the dock's on-air colour.
import type { AreaData } from "@workadventure/map-editor";
import type * as Phaser from "phaser";
import { standTilesOf } from "./goToTile";
import { isMegaphoneSpot } from "./megaphoneSpots";

const DASH = 4;
const GAP = 3;
const LINE = 1.5;
/** Inside the tile, so the square stays clear of the desk and chairs beside it. */
const INSET = 4;
const RADIUS = 3;
const IDLE = { line: 0x000000, lineAlpha: 0.3, fill: 0x000000, fillAlpha: 0.07 };
const LIVE = { line: 0x80da88, lineAlpha: 1, fill: 0x80da88, fillAlpha: 0.18 };
/** Over the floor and rugs, under every character (whose depth is its y). */
const DEPTH = 1;

/** The dashes along each side of a rounded rectangle, between its corner arcs. */
function sideDashes(x: number, y: number, w: number, h: number, r: number): [number, number, number, number][] {
    const out: [number, number, number, number][] = [];
    const sides: [number, number, number, number][] = [
        [x + r, y, x + w - r, y],
        [x + w, y + r, x + w, y + h - r],
        [x + w - r, y + h, x + r, y + h],
        [x, y + h - r, x, y + r],
    ];
    for (const [ax, ay, bx, by] of sides) {
        const length = Math.hypot(bx - ax, by - ay);
        // A gap next to each corner, dashes evenly between.
        const count = Math.max(1, Math.floor((length - GAP) / (DASH + GAP)));
        const used = count * DASH + (count - 1) * GAP;
        const start = (length - used) / 2;
        for (let k = 0; k < count; k++) {
            const from = start + k * (DASH + GAP);
            const to = from + DASH;
            out.push([
                ax + ((bx - ax) * from) / length,
                ay + ((by - ay) * from) / length,
                ax + ((bx - ax) * to) / length,
                ay + ((by - ay) * to) / length,
            ]);
        }
    }
    return out;
}

export class SpotMarks {
    private readonly marks = new Map<string, { graphics: Phaser.GameObjects.Graphics; area: AreaData }>();

    constructor(
        private readonly scene: Phaser.Scene,
        private readonly tileSize: () => { width: number; height: number },
    ) {}

    /** Draws a mark for each spot in `areas` and drops the marks of spots that are gone. */
    sync(areas: Iterable<AreaData>): void {
        const seen = new Set<string>();
        for (const area of areas) {
            if (!isMegaphoneSpot(area)) continue;
            seen.add(area.id);
            const known = this.marks.get(area.id);
            if (
                known &&
                known.area.x === area.x &&
                known.area.y === area.y &&
                known.area.width === area.width &&
                known.area.height === area.height
            )
                continue;
            known?.graphics.destroy();
            const graphics = this.scene.add.graphics();
            graphics.setDepth(DEPTH);
            this.marks.set(area.id, { graphics, area });
            this.draw(area.id, false);
        }
        for (const [id, mark] of this.marks)
            if (!seen.has(id)) {
                mark.graphics.destroy();
                this.marks.delete(id);
            }
    }

    /** Whether the player speaks from this spot. */
    setLive(areaId: string, live: boolean): void {
        if (this.marks.has(areaId)) this.draw(areaId, live);
    }

    destroy(): void {
        for (const mark of this.marks.values()) mark.graphics.destroy();
        this.marks.clear();
    }

    private draw(areaId: string, live: boolean): void {
        const mark = this.marks.get(areaId);
        if (!mark) return;
        const { graphics, area } = mark;
        const { width, height } = this.tileSize();
        const tile = standTilesOf(area, width, height)[0];
        graphics.clear();
        if (!tile) return;
        const x = tile.x * width + INSET;
        const y = tile.y * height + INSET;
        const w = width - 2 * INSET;
        const h = height - 2 * INSET;
        const look = live ? LIVE : IDLE;
        graphics.fillStyle(look.fill, look.fillAlpha);
        graphics.fillRoundedRect(x, y, w, h, RADIUS);
        graphics.lineStyle(LINE, look.line, look.lineAlpha);
        // Solid rounded corners, dashed sides between them.
        const r = RADIUS;
        graphics.beginPath();
        graphics.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
        graphics.strokePath();
        graphics.beginPath();
        graphics.arc(x + w - r, y + r, r, Math.PI * 1.5, Math.PI * 2);
        graphics.strokePath();
        graphics.beginPath();
        graphics.arc(x + w - r, y + h - r, r, 0, Math.PI * 0.5);
        graphics.strokePath();
        graphics.beginPath();
        graphics.arc(x + r, y + h - r, r, Math.PI * 0.5, Math.PI);
        graphics.strokePath();
        for (const [x1, y1, x2, y2] of sideDashes(x, y, w, h, r)) graphics.lineBetween(x1, y1, x2, y2);
    }
}
