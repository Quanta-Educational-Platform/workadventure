// quanta: the whole room's text chat (QUANTA_UI, in a room whose platform turned chat on). WA's own room-wide chat
// needs a Matrix server; this one is WA's proximity chat on a space everyone in the room joins, without the
// bubble's side effects (ProximityChatRoom.roomWide): no media, sounds, status or meeting events, and it never opens
// on its own. Nothing is kept: who joins later sees the messages from then on.
import { get } from "svelte/store";
import { FilterType } from "@workadventure/messages";
import type { ProximityChatRoomManager } from "../Chat/Connection/Proximity/ProximityChatRoomManager";
import { QL } from "./i18n";
import { QUANTA_ROOM_CHAT_SPACE } from "./roomChatSpace";

export function joinRoomChat(manager: ProximityChatRoomManager, signal: AbortSignal): void {
    // A meeting-room chat (isMeetingRoomChat) skips the bubble's arrivals and departures, which in a room-wide
    // space would be every player coming and going.
    manager
        .joinSpace(QUANTA_ROOM_CHAT_SPACE, get(QL).roomChat(), [], true, FilterType.ALL_USERS, false, signal, "area")
        .catch((error) => {
            if (!(error instanceof Error && error.name === "AbortError")) console.error(error);
        });
}
