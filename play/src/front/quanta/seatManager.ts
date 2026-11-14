// quanta: this player's sitting and standing (seats.ts), and showing other players on their seats. Seat state goes
// through the existing public player variable, so it needs no new message and reaches players who join later.
import { PositionMessage_Direction } from "@workadventure/messages";
import type { Character } from "../Phaser/Entity/Character";
import type { GameScene } from "../Phaser/Game/GameScene";
import type { Player } from "../Phaser/Player/Player";
import { SEAT_VARIABLE, SeatController, seatPose, seatsOf, type Seat, type SeatAction, type SeatFacing } from "./seats";

const DIRECTION: Record<SeatFacing, PositionMessage_Direction> = {
    down: PositionMessage_Direction.DOWN,
    up: PositionMessage_Direction.UP,
    left: PositionMessage_Direction.LEFT,
    right: PositionMessage_Direction.RIGHT,
};
const RELOAD_SEATS_MS = 2000;

export class SeatManager {
    private readonly controller = new SeatController();
    private seats: Seat[] = [];
    private seatsReadAt = -Infinity;

    constructor(private readonly scene: GameScene) {}

    update(now: number): void {
        const seats = this.readSeats(now);
        if (seats.length === 0 && !this.controller.seated) return;
        const player = this.scene.CurrentPlayer;
        this.apply(
            this.controller.tick({
                now,
                at: { x: player.x, y: player.y },
                moving: player.walking,
                seats,
                taken: this.takenSeats(),
            }),
        );
    }

    /** The sit key: sits by a seat at once, or stands up. */
    pressSitKey(): void {
        // Keys can come before the room is joined.
        const player = this.scene.CurrentPlayer as Player | undefined;
        if (!player) return;
        this.apply(
            this.controller.press({
                at: { x: player.x, y: player.y },
                seats: this.readSeats(this.scene.time.now),
                taken: this.takenSeats(),
            }),
        );
    }

    /** What another player's seat variable now says. */
    showRemote(character: Character, value: unknown): void {
        const seat =
            typeof value === "string" ? this.readSeats(this.scene.time.now).find((s) => s.id === value) : undefined;
        if (seat) character.sitOn(seat.id, seat.x, seat.y, DIRECTION[seat.facing], seatPose(seat));
        else character.standUp();
    }

    private apply(action: SeatAction): void {
        if (!action) return;
        const player = this.scene.CurrentPlayer;
        const variables = this.scene.getPlayerVariablesManager();
        const options = { public: true, persist: false, scope: "room" } as const;
        if (action.type === "sit") {
            const { seat } = action;
            player.sitOnSeat(seat.id, seat.x, seat.y, DIRECTION[seat.facing], seatPose(seat));
            variables?.setVariableFromApp(SEAT_VARIABLE, seat.id, options);
        } else {
            player.standUp();
            variables?.setVariableFromApp(SEAT_VARIABLE, null, options);
        }
    }

    private readSeats(now: number): Seat[] {
        if (now - this.seatsReadAt >= RELOAD_SEATS_MS) {
            this.seatsReadAt = now;
            const areas = this.scene.getGameMap().getWamFile()?.getGameMapAreas()?.getAreas();
            this.seats = areas ? seatsOf(areas.values()) : [];
        }
        return this.seats;
    }

    private takenSeats(): Set<string> {
        const taken = new Set<string>();
        for (const player of this.scene.MapPlayersByKey.values()) {
            if (player.seatId) taken.add(player.seatId);
        }
        return taken;
    }
}
