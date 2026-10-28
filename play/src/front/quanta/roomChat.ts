// quanta: the whole room's text chat (QUANTA_UI, in a room whose platform turned chat on). WA's own room-wide chat
// needs a Matrix server; this one is WA's proximity chat on a space everyone in the room joins, without the
// bubble's side effects (ProximityChatRoom.roomWide): no media, sounds, status or meeting events, and it never opens
// on its own. Nothing is kept: who joins later sees the messages from then on.
import { get } from "svelte/store";
import { FilterType } from "@workadventure/messages";
import type { ProximityChatRoomManager } from "../Chat/Connection/Proximity/ProximityChatRoomManager";
import type { ProximityChatRoom } from "../Chat/Connection/Proximity/ProximityChatRoom";
import { selectedRoomStore } from "../Chat/Stores/SelectRoomStore";
import { QL } from "./i18n";
import { QUANTA_ROOM_CHAT_SPACE } from "./roomChatSpace";

// The room's chat was the one on screen when its scene ended (moving to another room in the same frame): the next
// room's chat takes its place, rather than the panel keeping the ended room's.
let selectedWhenLeft = false;

/** Joins the room's chat; the returned cleanup, for the scene's teardown, lets go of it. */
export function joinRoomChat(manager: ProximityChatRoomManager, signal: AbortSignal): () => void {
    // The wrapper exists (and can be selected in the room list) before its join completes: held from now on, so the
    // teardown finds it whether the join completed, is pending or failed.
    const name = get(QL).roomChat();
    const room: ProximityChatRoom = manager.getOrCreateRoom(QUANTA_ROOM_CHAT_SPACE, name, "area");
    // A meeting-room chat (isMeetingRoomChat) skips the bubble's arrivals and departures, which in a room-wide
    // space would be every player coming and going.
    manager
        .joinSpace(QUANTA_ROOM_CHAT_SPACE, name, [], true, FilterType.ALL_USERS, false, signal, "area")
        .then((joined) => {
            if (signal.aborted) return;
            if (selectedWhenLeft && get(selectedRoomStore) === undefined) selectedRoomStore.set(joined);
            selectedWhenLeft = false;
        })
        .catch((error) => {
            if (!(error instanceof Error && error.name === "AbortError")) console.error(error);
        });
    return () => {
        if (get(selectedRoomStore) === room) {
            selectedWhenLeft = true;
            selectedRoomStore.set(undefined);
        }
    };
}
