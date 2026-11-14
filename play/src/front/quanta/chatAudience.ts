// quanta: the chats the side column offers, each with who reads it. The class's (the room-wide chat, roomChat.ts)
// always; the table's while the player talks with someone at a table (WA's proximity bubble), which only those at
// the table read. Zone chats (the lecture's) never show here.
import { derived, type Readable } from "svelte/store";
import type { ProximityChatRoom } from "../Chat/Connection/Proximity/ProximityChatRoom";
import { gameManager } from "../Phaser/Game/GameManager";
import { gameSceneStore } from "../Stores/GameSceneStore";
import { QUANTA_ROOM_CHAT_SPACE } from "./roomChatSpace";

export interface TableChat {
    room: ProximityChatRoom;
    /** The others at the table, by name. */
    names: string[];
    unread: boolean;
}

function manager() {
    try {
        return gameManager.getCurrentGameScene().proximityChatRoomManager;
    } catch {
        return undefined;
    }
}

export function classChatRoom(): ProximityChatRoom | undefined {
    return manager()?.resolveTargetRoom(QUANTA_ROOM_CHAT_SPACE);
}

export function isClassChat(room: object | undefined): boolean {
    const target = classChatRoom();
    return room !== undefined && room === target;
}

/**
 * The table's chat while the player is at one with someone, else undefined. It follows the running scene: a
 * reconnection or another room starts a new one, with its own table chat.
 */
export const tableChatStore: Readable<TableChat | undefined> = derived<typeof gameSceneStore, TableChat | undefined>(
    gameSceneStore,
    (scene, set) => {
        let room: ProximityChatRoom | undefined;
        try {
            room = scene?.proximityChatRoomManager.getDefaultRoom();
        } catch {
            room = undefined;
        }
        if (!room) {
            set(undefined);
            return;
        }
        const table = room;
        return derived([table.isJoined, table.spaceUsersStore, table.hasUnreadMessages], ([joined, users, unread]) => {
            if (!joined) return undefined;
            const me = table.getCurrentSpace()?.mySpaceUserId;
            const names = [...users.values()].filter((user) => user.spaceUserId !== me).map((user) => user.name);
            return names.length > 0 ? { room: table, names, unread } : undefined;
        }).subscribe(set);
    },
    undefined,
);

/** "Max", "Max, Anna", "Max, Anna +2". */
export function namesList(names: string[]): string {
    return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}
