import { get } from "svelte/store";
import { LL } from "../../i18n/i18n-svelte";
import { gameManager } from "../Phaser/Game/GameManager";
import { QL } from "../quanta/i18n";
import { roomHandSpaceStore } from "../quanta/roomHand";
import type { SpaceInterface } from "./SpaceInterface";

/** A human name for a space, to tell spaces apart in the raise-hand picker and the raised-hands panel. */
export function spaceLabel(space: SpaceInterface): string {
    if (space.kind === "bubble") {
        return get(LL).actionbar.help.lock.bubbleLabel();
    }
    // quanta: the room itself (quanta/roomHand.ts).
    if (space === get(roomHandSpaceStore)) {
        return get(QL).wholeRoom();
    }
    if (space.kind === "megaphone") {
        return get(LL).megaphone.modal.liveMessage.title();
    }
    // Meeting rooms and listener zones carry their display name on their proximity chat room.
    const room = get(gameManager.getCurrentGameScene().proximityChatRoomManager.roomsStore).find(
        (candidate) => candidate.getCurrentSpaceName() === space.getName(),
    );
    return room ? get(room.name) : space.getName();
}
