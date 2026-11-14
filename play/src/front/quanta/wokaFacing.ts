// quanta: which of its eight ways a woka on a new sheet faces. The wire still carries four directions, so each client
// works the rest out from how the woka actually moves.
import { PositionMessage_Direction } from "@workadventure/messages";

/** In the order of the sheet's rows. */
export const FACINGS = ["down", "down-left", "left", "up-left", "up", "up-right", "right", "down-right"] as const;
export type Facing = (typeof FACINGS)[number];

/** How long a turn takes to count, so a path zigzagging across tiles reads as one heading. */
const SMOOTHING_MS = 400;
/** One's own keys are no zigzag: they turn sooner. */
export const KEYS_SMOOTHING_MS = 90;
/** Past a sector's edge by this much before the facing changes. */
const MARGIN_DEGREES = 9;
const MIN_HOLD_MS = 200;
/** A turn this sharp is a real one: it shows at once. */
const SHARP_TURN_DEGREES = 100;
const MIN_SAMPLE = 0.01;
const BLOCKED_AFTER_MS = 120;
/**
 * With no movement seen for this long, a moving woka goes by the direction it was sent with, and its next step counts as
 * setting off. Long enough that a slow device's frame gaps are not mistaken for stops.
 */
const MOVEMENT_FRESH_MS = 1000;
/**
 * Smoothing runs over the distance walked, so a slow device (few, long steps) holds a heading as a fast one does. The
 * smoothing times are at the default walking speed (WOKA_SPEED 9 = 180 px a second): 400 ms is about two tiles.
 */
const PX_PER_MS = 0.18;

const SECTOR_DEGREES = 360 / FACINGS.length;

export function facingOfDirection(direction: PositionMessage_Direction): Facing {
    switch (direction) {
        case PositionMessage_Direction.UP:
            return "up";
        case PositionMessage_Direction.LEFT:
            return "left";
        case PositionMessage_Direction.RIGHT:
            return "right";
        default:
            return "down";
    }
}

/**
 * The four-way direction for a facing: diagonals keep the up or down view, as walking diagonally by keys does. Taken
 * from the smoothed facing, a path that steps diagonal, straight, diagonal holds one view instead of flipping per tile.
 */
export function directionOfFacing(facing: Facing): PositionMessage_Direction {
    switch (facing) {
        case "left":
            return PositionMessage_Direction.LEFT;
        case "right":
            return PositionMessage_Direction.RIGHT;
        case "up":
        case "up-left":
        case "up-right":
            return PositionMessage_Direction.UP;
        default:
            return PositionMessage_Direction.DOWN;
    }
}

/** Degrees clockwise from facing down, on screen: right is 270, up is 180, left is 90. */
function degreesOf(dx: number, dy: number): number {
    return ((((Math.atan2(-dx, dy) * 180) / Math.PI) % 360) + 360) % 360;
}

function angleBetween(a: number, b: number): number {
    const difference = Math.abs(a - b) % 360;
    return difference > 180 ? 360 - difference : difference;
}

function sectorCentre(facing: Facing): number {
    return FACINGS.indexOf(facing) * SECTOR_DEGREES;
}

export function facingOfVector(dx: number, dy: number): Facing {
    return FACINGS[Math.round(degreesOf(dx, dy) / SECTOR_DEGREES) % FACINGS.length];
}

export class FacingTracker {
    private smoothX = 0;
    private smoothY = 0;
    private lastSampleAt = -Infinity;
    private changedAt = -Infinity;
    private blockedSince: number | undefined;
    private lastDirection: PositionMessage_Direction;
    private current: Facing;

    constructor(direction: PositionMessage_Direction) {
        this.lastDirection = direction;
        this.current = facingOfDirection(direction);
    }

    get facing(): Facing {
        return this.current;
    }

    /** One step of real movement, in pixels. */
    move(dx: number, dy: number, now: number, smoothingMs = SMOOTHING_MS): Facing {
        const length = Math.hypot(dx, dy);
        if (length < MIN_SAMPLE) return this.current;
        this.blockedSince = undefined;
        const ux = dx / length;
        const uy = dy / length;
        const elapsed = now - this.lastSampleAt;
        if (elapsed > MOVEMENT_FRESH_MS) {
            // Setting off: nothing to smooth against, and the first step shows at once.
            this.smoothX = ux;
            this.smoothY = uy;
            this.set(facingOfVector(ux, uy), now);
        } else {
            const weight = 1 - Math.exp(-length / (smoothingMs * PX_PER_MS));
            this.smoothX += (ux - this.smoothX) * weight;
            this.smoothY += (uy - this.smoothY) * weight;
            this.follow(ux, uy, now);
        }
        this.lastSampleAt = now;
        return this.current;
    }

    /** Trying to walk but not getting anywhere, as into a wall: it faces the way it is trying. */
    blocked(direction: PositionMessage_Direction, now: number): Facing {
        this.blockedSince ??= now;
        if (now - this.blockedSince >= BLOCKED_AFTER_MS) this.current = facingOfDirection(direction);
        return this.current;
    }

    /** What to show for a direction and moving state from the wire or the input. */
    shown(direction: PositionMessage_Direction, moving: boolean, now: number): Facing {
        const changed = direction !== this.lastDirection;
        this.lastDirection = direction;
        if (moving) {
            if (now - this.lastSampleAt > MOVEMENT_FRESH_MS && this.blockedSince === undefined) {
                this.current = facingOfDirection(direction);
            }
        } else if (changed && now - this.lastSampleAt > MOVEMENT_FRESH_MS) {
            // Turned on the spot. Just after walking it is no turn: two keys let go one after the other change the
            // direction on the wire as it stops, and it keeps the way it stopped in.
            this.current = facingOfDirection(direction);
        }
        return this.current;
    }

    /** Placed facing a given way, as on a seat. */
    reset(direction: PositionMessage_Direction): void {
        this.lastDirection = direction;
        this.current = facingOfDirection(direction);
        this.lastSampleAt = -Infinity;
        this.blockedSince = undefined;
    }

    private follow(ux: number, uy: number, now: number): void {
        const sharp = angleBetween(degreesOf(ux, uy), sectorCentre(this.current)) >= SHARP_TURN_DEGREES;
        if (sharp) {
            this.smoothX = ux;
            this.smoothY = uy;
            this.set(facingOfVector(ux, uy), now);
            return;
        }
        if (Math.hypot(this.smoothX, this.smoothY) < MIN_SAMPLE) return;
        const heading = degreesOf(this.smoothX, this.smoothY);
        const within = angleBetween(heading, sectorCentre(this.current)) <= SECTOR_DEGREES / 2 + MARGIN_DEGREES;
        if (within || now - this.changedAt < MIN_HOLD_MS) return;
        this.set(facingOfVector(this.smoothX, this.smoothY), now);
    }

    private set(facing: Facing, now: number): void {
        if (facing !== this.current) this.changedAt = now;
        this.current = facing;
    }
}
