import { describe, expect, it } from "vitest";
import { SEAT_POSES, seatBy, SeatController, seatOf, seatPose, seatsOf, SIT_AFTER_MS, type Seat } from "./seats";

const tile = (name: string, col: number, row: number) => ({ name, x: col * 32, y: row * 32, width: 32, height: 32 });
const down = seatOf(tile("quanta:seat:down:1", 5, 5)) as Seat;
const next = seatOf(tile("quanta:seat:down:2", 6, 5)) as Seat;
const nothingTaken = new Set<string>();
const input = (
    now: number,
    at: { x: number; y: number },
    moving = false,
    seats = [down, next],
    taken = nothingTaken,
) => ({
    now,
    at,
    moving,
    seats,
    taken,
});

describe("seatOf", () => {
    it("reads the facing, and places the woka with its feet in the middle of the area", () => {
        expect(down).toEqual({ id: "quanta:seat:down:1", facing: "down", x: 176, y: 160 });
        expect(seatOf(tile("quanta:seat:up:3", 5, 19))?.facing).toBe("up");
    });
    it("ignores other areas and unknown facings", () => {
        expect(seatOf(tile("quanta:megaphone:1", 5, 5))).toBeUndefined();
        expect(seatOf(tile("quanta:seat:diagonal:1", 5, 5))).toBeUndefined();
        expect(seatOf({ ...tile("", 5, 5), name: undefined as unknown as string })).toBeUndefined();
    });
    it("lists only the seats among a map's areas", () => {
        expect(seatsOf([tile("Podium", 1, 1), tile("quanta:seat:up:1", 2, 2)]).map((s) => s.id)).toEqual([
            "quanta:seat:up:1",
        ]);
    });
    it("has a pose for every facing", () => {
        for (const facing of ["down", "up", "left", "right"] as const)
            expect(SEAT_POSES[facing].cropBottom).toBeGreaterThan(0);
    });
    it("moves only a new sheet's frame onto a turned chair", () => {
        expect(seatPose({ id: "quanta:seat:up:27", facing: "up" })).toBe(SEAT_POSES.up);
        const turned = seatPose({ id: "quanta:seat:up:28", facing: "up" });
        expect(turned.offsetY).toBe(SEAT_POSES.up.offsetY);
        expect(turned.cropBottom).toBe(SEAT_POSES.up.cropBottom);
        expect(turned.sheet.offsetX).toBe(3);
        expect(turned.sheet.offsetY).toBe(SEAT_POSES.up.sheet.offsetY + 1);
    });
});

describe("seatBy", () => {
    it("picks the nearest seat in reach", () => {
        expect(seatBy({ x: 180, y: 165 }, [down, next], nothingTaken)?.id).toBe(down.id);
        expect(seatBy({ x: 200, y: 165 }, [down, next], nothingTaken)?.id).toBe(next.id);
    });
    it("is nothing out of reach", () => {
        expect(seatBy({ x: 176, y: 200 }, [down], nothingTaken)).toBeUndefined();
        expect(seatBy({ x: 140, y: 160 }, [down], nothingTaken)).toBeUndefined();
    });
    it("skips a taken seat", () => {
        expect(seatBy({ x: 190, y: 160 }, [down, next], new Set([down.id]))?.id).toBe(next.id);
        expect(seatBy({ x: 170, y: 160 }, [down], new Set([down.id]))).toBeUndefined();
    });
});

describe("SeatController", () => {
    const by = { x: 180, y: 165 };

    it("sits after standing by a seat long enough, not sooner", () => {
        const seats = new SeatController();
        expect(seats.tick(input(1000, by))).toBeUndefined();
        expect(seats.tick(input(1000 + SIT_AFTER_MS - 1, by))).toBeUndefined();
        expect(seats.tick(input(1000 + SIT_AFTER_MS, by))).toEqual({ type: "sit", seat: down });
        expect(seats.seated).toBe(down);
    });
    it("starts the wait again after walking", () => {
        const seats = new SeatController();
        seats.tick(input(0, by));
        seats.tick(input(SIT_AFTER_MS - 1, by, true));
        expect(seats.tick(input(SIT_AFTER_MS, by))).toBeUndefined();
        expect(seats.tick(input(SIT_AFTER_MS * 2, by))?.type).toBe("sit");
    });
    it("doesn't sit far from a seat, or on a taken one", () => {
        const seats = new SeatController();
        seats.tick(input(0, { x: 400, y: 400 }));
        expect(seats.tick(input(SIT_AFTER_MS, { x: 400, y: 400 }))).toBeUndefined();
        const other = new SeatController();
        other.tick(input(0, down, false, [down], new Set([down.id])));
        expect(other.tick(input(SIT_AFTER_MS, down, false, [down], new Set([down.id])))).toBeUndefined();
    });
    it("sits at once on the key, and nothing happens away from a seat", () => {
        const seats = new SeatController();
        expect(seats.press({ at: by, seats: [down], taken: nothingTaken })).toEqual({ type: "sit", seat: down });
        const away = new SeatController();
        expect(away.press({ at: { x: 400, y: 400 }, seats: [down], taken: nothingTaken })).toBeUndefined();
    });
    it("stands on walking, and on having left the seat without walking", () => {
        const seats = new SeatController();
        seats.press({ at: by, seats: [down], taken: nothingTaken });
        expect(seats.tick(input(0, down))).toBeUndefined();
        expect(seats.tick(input(1, down, true))).toEqual({ type: "stand" });
        seats.press({ at: by, seats: [down], taken: nothingTaken });
        expect(seats.tick(input(2, { x: 400, y: 400 }))).toEqual({ type: "stand" });
    });
    it("stays standing after the key stands them up, until they have walked", () => {
        const seats = new SeatController();
        const pressed = { at: down, seats: [down], taken: nothingTaken };
        seats.press(pressed);
        expect(seats.press(pressed)).toEqual({ type: "stand" });
        seats.tick(input(0, down));
        expect(seats.tick(input(SIT_AFTER_MS * 5, down))).toBeUndefined();
        seats.tick(input(SIT_AFTER_MS * 5 + 1, down, true));
        seats.tick(input(SIT_AFTER_MS * 6, down));
        expect(seats.tick(input(SIT_AFTER_MS * 8, down))?.type).toBe("sit");
    });
});
