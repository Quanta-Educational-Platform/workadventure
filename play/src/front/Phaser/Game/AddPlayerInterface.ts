import type { PositionMessage } from "@workadventure/messages";
import type { PlayerInterface } from "./PlayerInterface";

export interface AddPlayerInterface extends PlayerInterface {
    position: PositionMessage;
    /** The player's public variables, when known: where it is seated (quanta/seats.ts). */
    variables?: Map<string, unknown>;
}
