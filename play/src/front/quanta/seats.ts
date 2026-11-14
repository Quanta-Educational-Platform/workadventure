// quanta: seats. A map area named "quanta:seat:<facing>:<n>" marks one, facing one of the woka's eight ways (down, up,
// left, right, or a chair turned 45°: down-right, down-left, up-right, up-left). Walking into a seat sits there at
// once; stopping on one (keys let go, a click's walk ending there, pushing against the desk in front) sits too; the
// sit key sits or stands. A new key, the joystick or a click stands up again.
import type { AreaData } from "@workadventure/map-editor";
import { PositionMessage_Direction } from "@workadventure/messages";
import { FACINGS, type Facing } from "./wokaFacing";

export const SEAT_PREFIX = "quanta:seat:";
/** A public, unpersisted player variable: the seat's name, or null. Other players read it to show this one sitting. */
export const SEAT_VARIABLE = "quanta:seat";

export type SeatFacing = Facing;

export interface Seat {
    id: string;
    facing: SeatFacing;
    /** Where the woka stands on it: its feet in the middle of the area, as every area counts feet. */
    x: number;
    y: number;
}

/** Half sizes, in pixels from a seat's spot. */
interface Zone {
    x: number;
    y: number;
}
/** Walking into a seat sits at once when the feet are this near its middle; a step beside it (an aisle) stays out. */
const WALK_IN: Zone = { x: 9, y: 10 };
/** Stopping anywhere on its tile, near its middle across, sits too. */
const STOP_ON: Zone = { x: 14, y: 16 };
/** The sit key reaches a little further. */
const KEY_REACH: Zone = { x: 20, y: 24 };
/** A seat just stood up from is not sat on again until the feet are off it. */
const LEFT_BEYOND: Zone = { x: 18, y: 20 };
/**
 * Stood up by walking off, a woka walks past seats (along a row of them) until it stops, or has been off every seat
 * this long: then walking into one sits again.
 */
const REARM_MS = 300;
/** Pushing against something (the desk in front of a seat) this long counts as stopping. */
const STUCK_MS = 80;
/** Sitting down: one short ease, sliding onto the spot and settling into the pose. Standing up is shorter. */
export const SIT_MS = 160;
export const STAND_MS = 120;
/** The feet are 16 below a woka's position. */
const FEET_OFFSET_Y = 16;
/** A seat's tile is 32 wide: anything on the seat's own spot is that seat's sitter. */
const ON_SPOT = 2;
/** A frame's step at walking speed on a slow device (4 frames a second); a longer jump is a teleport, not a walk. */
const MAX_STEP = 48;

/** The seated row's columns (Phaser/Player/WokaSheet.ts): front, back, then the turned views, drawn facing right. */
export const SEATED_COLUMN = { front: 1, back: 3, frontRight: 4, right: 5, backRight: 6 } as const;

/** How a woka is drawn on a seat. Offsets move the sprite from the seat's spot; the spot itself stays the position. */
export interface SeatPose {
    /** A new sheet with its own seated frame for the view: the seated row's column, mirrored for the left-hand ways. */
    frame: { column: number; flip: boolean; x: number; y: number };
    /**
     * Without one: its standing still, cut at the legs and lowered onto the seat; the woka's own eight-way view on a new
     * sheet that lacks the frame, the four-way `direction` on an old sheet.
     */
    standing: { x: number; y: number; cropBottom: number; direction: PositionMessage_Direction };
}

const { DOWN, UP, LEFT, RIGHT } = PositionMessage_Direction;

/** The right-hand ways, measured on the maps' chairs; the left-hand ones are their mirrors. */
const RIGHT_HAND: Record<"down" | "up" | "right" | "down-right" | "up-right", SeatPose> = {
    // Into the seat, in front of the chair's back.
    down: {
        frame: { column: SEATED_COLUMN.front, flip: false, x: 0, y: 12 },
        standing: { x: 0, y: 12, cropBottom: 5, direction: DOWN },
    },
    // Behind the chair's back (the map draws those chairs above the sitter): raised so the head shows over it.
    up: {
        frame: { column: SEATED_COLUMN.back, flip: false, x: 0, y: -6 },
        standing: { x: 0, y: -5, cropBottom: 6, direction: UP },
    },
    right: {
        frame: { column: SEATED_COLUMN.right, flip: false, x: 0, y: 8 },
        standing: { x: 0, y: 8, cropBottom: 8, direction: RIGHT },
    },
    "down-right": {
        frame: { column: SEATED_COLUMN.frontRight, flip: false, x: 0, y: 10 },
        standing: { x: 0, y: 12, cropBottom: 5, direction: DOWN },
    },
    // A chair turned away and to the right: its back too is drawn above the sitter.
    "up-right": {
        frame: { column: SEATED_COLUMN.backRight, flip: false, x: 3, y: -5 },
        standing: { x: 3, y: -4, cropBottom: 6, direction: UP },
    },
};

function mirrored(pose: SeatPose): SeatPose {
    const { frame, standing } = pose;
    const direction = standing.direction === RIGHT ? LEFT : standing.direction === LEFT ? RIGHT : standing.direction;
    return {
        frame: { ...frame, flip: !frame.flip, x: -frame.x },
        standing: { ...standing, x: -standing.x, direction },
    };
}

export const SEAT_POSES: Record<SeatFacing, SeatPose> = {
    down: RIGHT_HAND.down,
    up: RIGHT_HAND.up,
    right: RIGHT_HAND.right,
    left: mirrored(RIGHT_HAND.right),
    "down-right": RIGHT_HAND["down-right"],
    "down-left": mirrored(RIGHT_HAND["down-right"]),
    "up-right": RIGHT_HAND["up-right"],
    "up-left": mirrored(RIGHT_HAND["up-right"]),
};

/** What a woka sitting on a seat is given: where, which way, how. */
export interface SeatPlacement extends Seat {
    pose: SeatPose;
}

/**
 * The older classroom's two turned chairs, marked "up" before seats had turned ways (seats 28 and 38, at its tables'
 * column 21): they face up and to the right. Known by number and place, so other maps' seats 28 and 38 stay as marked;
 * newer maps name their turned chairs.
 */
const TURNED_CHAIRS = new Set(["28@672,608", "38@672,736"]);

function isFacing(value: string): value is SeatFacing {
    return (FACINGS as readonly string[]).includes(value);
}

export function seatOf(area: Pick<AreaData, "name" | "x" | "y" | "width" | "height">): Seat | undefined {
    const name = area.name ?? "";
    if (!name.startsWith(SEAT_PREFIX)) return undefined;
    const [way, number] = name.slice(SEAT_PREFIX.length).split(":");
    if (!isFacing(way)) return undefined;
    const facing = way === "up" && TURNED_CHAIRS.has(`${number}@${area.x},${area.y}`) ? "up-right" : way;
    return { id: name, facing, x: area.x + area.width / 2, y: area.y + area.height / 2 - FEET_OFFSET_Y };
}

export function placement(seat: Seat): SeatPlacement {
    return { ...seat, pose: SEAT_POSES[seat.facing] };
}

const CELL = 32;
const NONE: readonly Seat[] = [];
const cellKey = (cx: number, cy: number) => (cx + 4096) * 16384 + (cy + 4096);

/** A map's seats by name, and by the 32-pixel cells their reach covers: finding the seats by a point is one lookup. */
export class SeatIndex {
    private readonly byId = new Map<string, Seat>();
    private readonly cells = new Map<number, Seat[]>();

    constructor(areas: Iterable<Pick<AreaData, "name" | "x" | "y" | "width" | "height">>) {
        for (const area of areas) {
            const seat = seatOf(area);
            if (!seat) continue;
            this.byId.set(seat.id, seat);
            for (
                let cy = Math.floor((seat.y - KEY_REACH.y) / CELL);
                cy <= Math.floor((seat.y + KEY_REACH.y) / CELL);
                cy++
            )
                for (
                    let cx = Math.floor((seat.x - KEY_REACH.x) / CELL);
                    cx <= Math.floor((seat.x + KEY_REACH.x) / CELL);
                    cx++
                ) {
                    const key = cellKey(cx, cy);
                    const list = this.cells.get(key);
                    if (list) list.push(seat);
                    else this.cells.set(key, [seat]);
                }
        }
    }

    get size(): number {
        return this.byId.size;
    }

    get(id: string): Seat | undefined {
        return this.byId.get(id);
    }

    /** The seats whose reach may cover a point. */
    near(at: { x: number; y: number }): readonly Seat[] {
        return this.cells.get(cellKey(Math.floor(at.x / CELL), Math.floor(at.y / CELL))) ?? NONE;
    }

    /**
     * The seats whose reach may cover any point of a step. Points 16 px apart are close enough: a seat's reach is
     * wider than its walk-in middle by more than half that on each side.
     */
    along(from: { x: number; y: number }, to: { x: number; y: number }): readonly Seat[] {
        const parts = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 16);
        let first: readonly Seat[] = this.near(to);
        let all: Set<Seat> | undefined;
        for (let i = 0; i < parts; i++) {
            const cell = this.near({
                x: from.x + ((to.x - from.x) * i) / parts,
                y: from.y + ((to.y - from.y) * i) / parts,
            });
            if (cell === first || cell.length === 0) continue;
            if (first.length === 0) {
                first = cell;
                continue;
            }
            all ??= new Set(first);
            for (const seat of cell) all.add(seat);
        }
        return all ? [...all] : first;
    }
}

function within(seat: Seat, at: { x: number; y: number }, zone: Zone): boolean {
    return Math.abs(at.x - seat.x) <= zone.x && Math.abs(at.y - seat.y) <= zone.y;
}

function nearest(
    seats: readonly Seat[],
    at: { x: number; y: number },
    zone: Zone,
    free: (seat: Seat) => boolean,
): Seat | undefined {
    let best: Seat | undefined;
    let bestDistance = Infinity;
    for (const seat of seats) {
        if (!within(seat, at, zone)) continue;
        const distance = (at.x - seat.x) ** 2 + (at.y - seat.y) ** 2;
        if (distance < bestDistance && free(seat)) {
            best = seat;
            bestDistance = distance;
        }
    }
    return best;
}

/**
 * Walking into a seat over a frame's step from `from` to `to`: the step's point nearest each seat's middle is tested,
 * so a slow device's long steps cannot carry the feet across a seat between two frames.
 */
function walkedInto(
    seats: readonly Seat[],
    from: { x: number; y: number },
    to: { x: number; y: number },
    free: (seat: Seat) => boolean,
): Seat | undefined {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length2 = dx * dx + dy * dy;
    let best: Seat | undefined;
    let bestDistance = Infinity;
    for (const seat of seats) {
        const t = length2 ? Math.max(0, Math.min(1, ((seat.x - from.x) * dx + (seat.y - from.y) * dy) / length2)) : 1;
        const point = { x: from.x + dx * t, y: from.y + dy * t };
        if (!within(seat, point, WALK_IN)) continue;
        const distance = (point.x - seat.x) ** 2 + (point.y - seat.y) ** 2;
        if (distance < bestDistance && free(seat)) {
            best = seat;
            bestDistance = distance;
        }
    }
    return best;
}

export type SeatAction = { type: "sit"; seat: Seat } | { type: "stand" } | undefined;

export interface SeatTick {
    now: number;
    at: { x: number; y: number };
    /** Walking: by keys, the joystick, or along a path. A seated woka walks only on a new key or click. */
    walking: boolean;
    /** Along a path (a click, a go-to): it sits only where the path ends, never on a seat it passes. */
    byPath: boolean;
    /** Still sliding onto its seat: not yet on the spot. */
    settling: boolean;
    seats: SeatIndex;
    isTaken: (seatId: string) => boolean;
}

/** Decides when this player sits and stands. */
export class SeatController {
    private seat: Seat | undefined;
    // The seat last stood up from: not sat on again while the feet are still on it.
    private left: Seat | undefined;
    // Walking into a seat sits. Off after standing up by walking, so a walk along a row of seats passes them.
    private armed = true;
    private offSeatsSince: number | undefined;
    private wasWalking = false;
    private still: { x: number; y: number; since: number } | undefined;
    // Where it was on the last check: the step since is what it walked through.
    private lastAt: { x: number; y: number } | undefined;

    get seated(): Seat | undefined {
        return this.seat;
    }

    tick(input: SeatTick): SeatAction {
        const { now, at, walking } = input;
        const stopped = this.wasWalking && !walking;
        this.wasWalking = walking;
        const last = this.lastAt;
        this.lastAt = { x: at.x, y: at.y };
        const from = last && Math.hypot(at.x - last.x, at.y - last.y) <= MAX_STEP ? last : at;
        if (this.seat) {
            const moved = Math.abs(at.x - this.seat.x) > ON_SPOT || Math.abs(at.y - this.seat.y) > ON_SPOT;
            if (walking) return this.stand(true);
            if (moved && !input.settling) return this.stand(false);
            return undefined;
        }
        if (this.left && !within(this.left, at, LEFT_BEYOND)) this.left = undefined;
        // No headway while walking by keys: pushing against something (physics may still nudge it a fraction).
        let stuck = false;
        if (walking && !input.byPath) {
            const still = this.still && Math.abs(this.still.x - at.x) < 1 && Math.abs(this.still.y - at.y) < 1;
            if (still && this.still) stuck = now - this.still.since >= STUCK_MS;
            else this.still = { x: at.x, y: at.y, since: now };
        } else this.still = undefined;
        const near = input.seats.near(at);
        if (!this.armed) {
            if (stopped || stuck) this.armed = true;
            else if (near.some((seat) => within(seat, at, STOP_ON))) this.offSeatsSince = undefined;
            else if (now - (this.offSeatsSince ??= now) >= REARM_MS) this.armed = true;
        }
        const walkingIn = walking && !input.byPath && this.armed && !stuck;
        const passed = walkingIn && from !== at ? input.seats.along(from, at) : near;
        if (passed.length === 0) return undefined;
        // By name: the map's seats are read again now and then.
        const free = (seat: Seat) => seat.id !== this.left?.id && !input.isTaken(seat.id);
        if (walkingIn) {
            const seat = walkedInto(passed, from, at, free);
            if (seat) return this.sit(seat);
        }
        if (stopped || stuck) {
            const seat = nearest(near, at, STOP_ON, free);
            if (seat) return this.sit(seat);
        }
        return undefined;
    }

    /** The sit key: sits on the nearest free seat in reach, or stands up. */
    press(at: { x: number; y: number }, seats: SeatIndex, isTaken: (seatId: string) => boolean): SeatAction {
        if (this.seat) return this.stand(false);
        const seat = nearest(seats.near(at), at, KEY_REACH, (s) => !isTaken(s.id));
        return seat ? this.sit(seat) : undefined;
    }

    /** Stood up by something else (the seat went away). */
    forget(): void {
        this.seat = undefined;
    }

    private sit(seat: Seat): SeatAction {
        this.seat = seat;
        this.left = undefined;
        this.still = undefined;
        return { type: "sit", seat };
    }

    private stand(walkingOff: boolean): SeatAction {
        this.left = this.seat;
        this.seat = undefined;
        this.still = undefined;
        if (walkingOff) {
            this.armed = false;
            this.offSeatsSince = undefined;
        }
        return { type: "stand" };
    }
}
