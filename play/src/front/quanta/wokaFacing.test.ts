import { describe, expect, it } from "vitest";
import { PositionMessage_Direction } from "@workadventure/messages";
import { facingOfVector, FACINGS, FacingTracker, KEYS_SMOOTHING_MS, type Facing } from "./wokaFacing";

const { DOWN, UP, LEFT, RIGHT } = PositionMessage_Direction;
const STEP_MS = 16;

/** Walks along straight segments at 180 px/s and lists each change of facing. */
function walk(tracker: FacingTracker, segments: Array<[number, number, number]>, start = 1000): Facing[] {
    const seen: Facing[] = [];
    let now = start;
    for (const [dx, dy, ms] of segments) {
        const length = Math.hypot(dx, dy);
        for (let t = 0; t < ms; t += STEP_MS) {
            now += STEP_MS;
            const facing = tracker.move((dx / length) * 2.9, (dy / length) * 2.9, now);
            if (seen[seen.length - 1] !== facing) seen.push(facing);
        }
    }
    return seen;
}

describe("facingOfVector", () => {
    it("names all eight ways in screen coordinates", () => {
        const vectors: Array<[Facing, number, number]> = [
            ["down", 0, 1],
            ["down-left", -1, 1],
            ["left", -1, 0],
            ["up-left", -1, -1],
            ["up", 0, -1],
            ["up-right", 1, -1],
            ["right", 1, 0],
            ["down-right", 1, 1],
        ];
        expect(vectors.map(([facing]) => facing)).toEqual([...FACINGS]);
        for (const [facing, dx, dy] of vectors) expect(facingOfVector(dx, dy)).toBe(facing);
    });
});

describe("FacingTracker", () => {
    it("shows the first step at once, diagonal too", () => {
        const tracker = new FacingTracker(DOWN);
        expect(tracker.move(3, -3, 1000)).toBe("up-right");
    });

    it("follows a held diagonal, then a real turn", () => {
        const tracker = new FacingTracker(DOWN);
        expect(
            walk(tracker, [
                [1, 1, 500],
                [1, 0, 600],
            ]),
        ).toEqual(["down-right", "right"]);
    });

    it("turns sooner on one's own keys than on a path", () => {
        const after = (smoothing?: number) => {
            const tracker = new FacingTracker(DOWN);
            let now = 1000;
            tracker.move(3, 0, now, smoothing);
            let ms = 0;
            while (tracker.facing === "right" && ms < 2000) {
                now += STEP_MS;
                ms += STEP_MS;
                tracker.move(3, 3, now, smoothing);
            }
            return ms;
        };
        expect(after(KEYS_SMOOTHING_MS)).toBeLessThan(250);
        expect(after()).toBeLessThan(500);
    });

    it("turns round at once", () => {
        const tracker = new FacingTracker(DOWN);
        walk(tracker, [[1, 0, 400]]);
        expect(tracker.move(-3, 0, 1420)).toBe("left");
    });

    it("doesn't flicker on a click-to-walk path zigzagging one tile straight, one tile diagonal", () => {
        const tile = 178; // one 32 px tile at 180 px/s
        const zigzag: Array<[number, number, number]> = [];
        for (let i = 0; i < 8; i++) zigzag.push([1, 0, tile], [1, 1, tile * 1.41]);
        expect(walk(new FacingTracker(DOWN), zigzag).length).toBeLessThanOrEqual(2);
    });

    it("doesn't flicker when pixel rounding makes steps alternate around a sector's edge", () => {
        const tracker = new FacingTracker(DOWN);
        const seen = new Set<Facing>();
        let now = 1000;
        for (let i = 0; i < 200; i++) {
            now += STEP_MS;
            seen.add(i % 2 ? tracker.move(3, 2, now) : tracker.move(3, 1, now));
        }
        expect(seen.size).toBeLessThanOrEqual(2);
    });

    it("keeps the way it stopped in, unless the wire says it turned", () => {
        const tracker = new FacingTracker(DOWN);
        tracker.move(3, 3, 1000);
        expect(tracker.shown(DOWN, true, 1000)).toBe("down-right");
        expect(tracker.shown(DOWN, false, 1016)).toBe("down-right");
        expect(tracker.shown(LEFT, false, 2000)).toBe("left");
    });

    it("trusts the movement over the wire's direction while moving", () => {
        const tracker = new FacingTracker(UP);
        tracker.move(3, 0, 1000);
        expect(tracker.shown(UP, true, 1016)).toBe("right");
    });

    it("goes by the wire's direction with no movement seen", () => {
        const tracker = new FacingTracker(DOWN);
        expect(tracker.shown(RIGHT, true, 5000)).toBe("right");
    });

    it("walking into a wall faces the way it is trying, after a moment", () => {
        const tracker = new FacingTracker(DOWN);
        expect(tracker.blocked(UP, 1000)).toBe("down");
        expect(tracker.blocked(UP, 1200)).toBe("up");
    });

    it("resets to a seat's way", () => {
        const tracker = new FacingTracker(DOWN);
        tracker.move(3, -3, 1000);
        tracker.reset(UP);
        expect(tracker.facing).toBe("up");
    });
});
