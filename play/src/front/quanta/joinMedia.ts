// quanta: a class starts quiet. On entering, the microphone and camera are off whatever the last visit left, until
// the user turns them on, or the platform's join choice does (roomBridge.ts). What the user does in the room stands.
import { QUANTA_UI } from "../Enum/EnvironmentVariable";

/** The microphone's or camera's state as a page opens: the one saved from the last visit, except in a class. */
export function startingMediaState(saved: () => boolean): boolean {
    return QUANTA_UI ? false : saved();
}
