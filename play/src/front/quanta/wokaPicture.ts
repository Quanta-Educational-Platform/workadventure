// quanta: a person's woka as a picture, by their Quanta uuid, for the chat's avatars: the same face the People list
// shows, where the chat itself has no picture for them. Found among the other players on the map (one's own messages
// carry no avatar); someone who has left keeps the chat's letter.
import { derived, readable, type Readable } from "svelte/store";
import { gameManager } from "../Phaser/Game/GameManager";

const none: Readable<string | undefined> = readable(undefined);

export function wokaPictureStore(uuid: string | undefined): Readable<string | undefined> {
    if (!uuid) return none;
    let scene;
    try {
        scene = gameManager.getCurrentGameScene();
    } catch {
        return none;
    }
    return derived(scene.MapPlayersByKey, ($players, set: (value: string | undefined) => void) => {
        const player = [...$players.values()].find((p) => p.userUuid === uuid);
        if (!player) {
            set(undefined);
            return;
        }
        return player.pictureStore.subscribe(set);
    });
}

/** The first store's picture, else the second's. */
export function pictureOr(
    first: Readable<string | undefined> | undefined,
    second: Readable<string | undefined>,
): Readable<string | undefined> {
    if (!first) return second;
    return derived([first, second], ([$first, $second]) => $first ?? $second);
}
