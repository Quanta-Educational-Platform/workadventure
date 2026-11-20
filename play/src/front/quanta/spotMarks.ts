// quanta: every megaphone spot is marked on the floor the same way on every map, as a dashed square on the one tile a
// person stands on to speak from it (as Gather marks its spotlight tiles), not as an object one might take for
// furniture. The spot the player speaks from turns green, the dock's on-air colour.
import type { AreaData } from "@workadventure/map-editor";
import type * as Phaser from "phaser";
import { standTilesOf } from "./goToTile";
import { isMegaphoneSpot } from "./megaphoneSpots";

const DASH = 6;
const GAP = 4;
const LINE = 2;
/** Inside the tile, so the square stays on the rug a table's spot sits on. */
const INSET = 3;
const IDLE = { color: 0xffffff, alpha: 0.95 };
const LIVE = { color: 0x80da88, alpha: 1 };
const SHADOW = { color: 0x1f2937, alpha: 0.45 };
/** Over the floor and rugs, under every character (whose depth is its y). */
const DEPTH = 1;

/** The dashes of a rectangle's outline, walked clockwise from the top-left corner so the corners stay drawn. */
export function dashSegments(
    x: number,
    y: number,
    width: number,
    height: number,
    dash = DASH,
    gap = GAP,
): [number, number, number, number][] {
    const corners = [
        [x, y],
        [x + width, y],
        [x + width, y + height],
        [x, y + height],
        [x, y],
    ];
    const segments: [number, number, number, number][] = [];
    for (let i = 0; i < 4; i++) {
        const [ax, ay] = corners[i];
        const [bx, by] = corners[i + 1];
        const length = Math.hypot(bx - ax, by - ay);
        // Spread the gaps so each side starts and ends on a dash.
        const count = Math.max(1, Math.round((length + gap) / (dash + gap)));
        const step = count > 1 ? (length - dash) / (count - 1) : 0;
        for (let k = 0; k < count; k++) {
            const from = k * step;
            const to = Math.min(length, from + (count > 1 ? dash : length));
            segments.push([
                ax + ((bx - ax) * from) / length,
                ay + ((by - ay) * from) / length,
                ax + ((bx - ax) * to) / length,
                ay + ((by - ay) * to) / length,
            ]);
        }
    }
    return segments;
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
        const segments = dashSegments(
            tile.x * width + INSET,
            tile.y * height + INSET,
            width - 2 * INSET,
            height - 2 * INSET,
        );
        const line = live ? LIVE : IDLE;
        // A dark edge under each dash keeps it readable on light floors as well as on rugs.
        graphics.lineStyle(LINE, SHADOW.color, SHADOW.alpha);
        for (const [x1, y1, x2, y2] of segments) graphics.lineBetween(x1 + 1, y1 + 1, x2 + 1, y2 + 1);
        graphics.lineStyle(LINE, line.color, line.alpha);
        for (const [x1, y1, x2, y2] of segments) graphics.lineBetween(x1, y1, x2, y2);
    }
}
