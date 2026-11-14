// quanta: this player's sitting and standing (seats.ts), and showing other players on their seats. Seat state goes
// through the existing public player variable, so it needs no new message and reaches players who join later.
import type { Character } from "../Phaser/Entity/Character";
import type { GameScene } from "../Phaser/Game/GameScene";
import type { Player } from "../Phaser/Player/Player";
import { placement, SEAT_VARIABLE, SeatController, SeatIndex, type SeatAction } from "./seats";

/** Seats come from the map's areas, which the map editor can change: read again now and then, while walking. */
const RELOAD_SEATS_MS = 5000;

export class SeatManager {
    private readonly controller = new SeatController();
    private index: SeatIndex | undefined;
    private indexReadAt = -Infinity;
    // The last check: a player standing or sitting still is not checked again.
    private lastX = NaN;
    private lastY = NaN;
    private lastWalking = false;

    constructor(private readonly scene: GameScene) {}

    update(now: number): void {
        const player = this.scene.CurrentPlayer;
        const walking = player.walking;
        if (!walking && !this.lastWalking && player.x === this.lastX && player.y === this.lastY) return;
        this.lastX = player.x;
        this.lastY = player.y;
        this.lastWalking = walking;
        const seats = this.seats(now);
        if (seats.size === 0 && !this.controller.seated) return;
        this.apply(
            this.controller.tick({
                now,
                at: { x: player.x, y: player.y },
                walking,
                byPath: player.walkingByPath,
                settling: player.seatSettling,
                seats,
                isTaken: this.isTaken,
            }),
        );
    }

    /** The sit key: sits by a seat at once, or stands up. */
    pressSitKey(): void {
        // Keys can come before the room is joined.
        const player = this.scene.CurrentPlayer as Player | undefined;
        if (!player) return;
        this.apply(this.controller.press({ x: player.x, y: player.y }, this.seats(this.scene.time.now), this.isTaken));
    }

    /** What another player's seat variable now says; one just come into view is shown seated at once. */
    showRemote(character: Character, value: unknown, instant = false): void {
        const seat = typeof value === "string" ? this.seats(this.scene.time.now).get(value) : undefined;
        if (seat) character.sitOn(placement(seat), !instant);
        else character.standUp();
    }

    private apply(action: SeatAction): void {
        if (!action) return;
        const player = this.scene.CurrentPlayer;
        const variables = this.scene.getPlayerVariablesManager();
        const options = { public: true, persist: false, scope: "room" } as const;
        if (action.type === "sit") {
            player.sitOnSeat(placement(action.seat));
            variables?.setVariableFromApp(SEAT_VARIABLE, action.seat.id, options);
        } else {
            player.standUp();
            variables?.setVariableFromApp(SEAT_VARIABLE, null, options);
        }
    }

    private seats(now: number): SeatIndex {
        if (!this.index || now - this.indexReadAt >= RELOAD_SEATS_MS) {
            this.indexReadAt = now;
            const areas = this.scene.getGameMap().getWamFile()?.getGameMapAreas()?.getAreas();
            this.index = new SeatIndex(areas ? areas.values() : []);
            const seated = this.controller.seated;
            if (seated && !this.index.get(seated.id)) {
                // Its seat is gone from the map.
                this.controller.forget();
                this.apply({ type: "stand" });
            }
        }
        return this.index;
    }

    private readonly isTaken = (seatId: string): boolean => {
        for (const other of this.scene.MapPlayersByKey.values()) if (other.seatId === seatId) return true;
        return false;
    };
}
