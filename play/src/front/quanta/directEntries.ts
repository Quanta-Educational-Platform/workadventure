// quanta: the class chat's direct messages as it last rendered them (ProximityChatRoom.renderRoomChat), read by
// directMessages.ts. Its own module, importing nothing of the room, so the chat room can write here without an import
// cycle through the scene.
import { writable } from "svelte/store";
import type { ChatMessage } from "../Chat/Connection/ChatConnection";

/** A direct message: whose conversation it belongs to, and whether it is ours. */
export interface DirectEntry {
    id: string;
    peerId: string;
    peerName: string;
    mine: boolean;
    message: ChatMessage;
}

/** The class chat's direct messages, and the newest id of any message it had then (class or direct), once the room's
 *  server sent its history; undefined until the chat first rendered. */
export const directEntriesStore = writable<{ entries: DirectEntry[]; newestId: number | undefined } | undefined>(
    undefined,
);
