// quanta: seats in a classroom. A map area named "quanta:seat:<facing>:<n>" marks one: whoever stands by it for a
// moment, or presses the sit key, sits there facing that way. An old woka has no sitting frames, so it is shown as its
// standing frame without the legs, lowered onto the seat; a new sheet has its own.
import type { AreaData } from "@workadventure/map-editor";
import { SEATED_BACK_FRAME, SEATED_FRONT_FRAME } from "../Phaser/Player/WokaSheet";

export const SEAT_PREFIX = "quanta:seat:";
/** A public, unpersisted player variable: the seat's name, or null. Other players read it to show this one sitting. */
export const SEAT_VARIABLE = "quanta:seat";
export const SIT_AFTER_MS = 2000;

/** How far from a seat's middle one's feet may be and still be by it, across and along the room. */
const REACH_X = 20;
const REACH_Y = 24;
/** A seated woka's feet are 16 below its position, as for every area. */
const FEET_OFFSET_Y = 16;
const STILL_ON_SEAT_DISTANCE = 2;

export type SeatFacing = "down" | "up" | "left" | "right";

export interface Seat {
    id: string;
    facing: SeatFacing;
    /** Where the woka is placed on it. */
    x: number;
    y: number;
}

export interface SeatPose {
    /** How far the sprite is lowered onto the seat. */
    offsetY: number;
    /** How much is cut off the sprite's bottom: its legs. */
    cropBottom: number;
    /** Instead, on a sheet with seated frames. Without a frame it stands, cropped, as an old woka does. */
    sheet: { offsetX: number; offsetY: number; cropBottom: number; frame?: number };
}

/**
 * Measured on the classroom's chairs and bean bags. Down-facing wokas sit into the seat, in front of the chair's back.
 * Up-facing ones sit behind it (the map draws those chairs above them): raised so the head shows over it, and short
 * enough that nothing shows under it.
 */
export const SEAT_POSES: Record<SeatFacing, SeatPose> = {
    down: { offsetY: 12, cropBottom: 8, sheet: { offsetX: 0, offsetY: 12, cropBottom: 0, frame: SEATED_FRONT_FRAME } },
    up: { offsetY: -2, cropBottom: 8, sheet: { offsetX: 0, offsetY: -6, cropBottom: 0, frame: SEATED_BACK_FRAME } },
    left: { offsetY: 8, cropBottom: 8, sheet: { offsetX: 0, offsetY: 8, cropBottom: 8 } },
    right: { offsetY: 8, cropBottom: 8, sheet: { offsetX: 0, offsetY: 8, cropBottom: 8 } },
};

/** Seats whose chair is turned, by their number in the seat's name: the seated frame moves onto it. */
const TURNED_CHAIRS: ReadonlyMap<string, { x: number; y: number }> = new Map([
    ["28", { x: 3, y: 1 }],
    ["38", { x: 3, y: 1 }],
]);

export function seatPose(seat: Pick<Seat, "id" | "facing">): SeatPose {
    const pose = SEAT_POSES[seat.facing];
    const turned = TURNED_CHAIRS.get(seat.id.split(":").pop() ?? "");
    if (!turned) return pose;
    return {
        ...pose,
        sheet: { ...pose.sheet, offsetX: pose.sheet.offsetX + turned.x, offsetY: pose.sheet.offsetY + turned.y },
    };
}

export function seatOf(area: Pick<AreaData, "name" | "x" | "y" | "width" | "height">): Seat | undefined {
    const name = area.name ?? "";
    if (!name.startsWith(SEAT_PREFIX)) return undefined;
    const facing = name.slice(SEAT_PREFIX.length).split(":")[0];
    if (facing !== "down" && facing !== "up" && facing !== "left" && facing !== "right") return undefined;
    return { id: name, facing, x: area.x + area.width / 2, y: area.y + area.height / 2 - FEET_OFFSET_Y };
}

export function seatsOf(areas: Iterable<Pick<AreaData, "name" | "x" | "y" | "width" | "height">>): Seat[] {
    const seats: Seat[] = [];
    for (const area of areas) {
        const seat = seatOf(area);
        if (seat) seats.push(seat);
    }
    return seats;
}

/** The free seat one standing at `at` is by, the nearest if there are several. */
export function seatBy(at: { x: number; y: number }, seats: Seat[], taken: ReadonlySet<string>): Seat | undefined {
    let nearest: Seat | undefined;
    let nearestDistance = Infinity;
    for (const seat of seats) {
        if (taken.has(seat.id)) continue;
        const dx = Math.abs(at.x - seat.x);
        const dy = Math.abs(at.y - seat.y);
        if (dx > REACH_X || dy > REACH_Y) continue;
        const distance = dx * dx + dy * dy;
        if (distance < nearestDistance) {
            nearest = seat;
            nearestDistance = distance;
        }
    }
    return nearest;
}

export type SeatAction = { type: "sit"; seat: Seat } | { type: "stand" } | undefined;

export interface SeatInput {
    now: number;
    at: { x: number; y: number };
    moving: boolean;
    seats: Seat[];
    taken: ReadonlySet<string>;
}

/** Decides when this player sits and stands. */
export class SeatController {
    private seat: Seat | undefined;
    private stillSince: number | undefined;
    // Stood up by key: staying put keeps them standing, until they have walked off.
    private stayStanding = false;

    get seated(): Seat | undefined {
        return this.seat;
    }

    tick({ now, at, moving, seats, taken }: SeatInput): SeatAction {
        if (this.seat) {
            const away = Math.hypot(at.x - this.seat.x, at.y - this.seat.y) > STILL_ON_SEAT_DISTANCE;
            if (moving || away) return this.stand();
            return undefined;
        }
        if (moving) {
            this.stillSince = undefined;
            this.stayStanding = false;
            return undefined;
        }
        this.stillSince ??= now;
        if (this.stayStanding || now - this.stillSince < SIT_AFTER_MS) return undefined;
        const seat = seatBy(at, seats, taken);
        return seat ? this.sit(seat) : undefined;
    }

    press({ at, seats, taken }: Pick<SeatInput, "at" | "seats" | "taken">): SeatAction {
        if (this.seat) {
            this.stayStanding = true;
            return this.stand();
        }
        const seat = seatBy(at, seats, taken);
        return seat ? this.sit(seat) : undefined;
    }

    private sit(seat: Seat): SeatAction {
        this.seat = seat;
        return { type: "sit", seat };
    }

    private stand(): SeatAction {
        this.seat = undefined;
        this.stillSince = undefined;
        return { type: "stand" };
    }
}
