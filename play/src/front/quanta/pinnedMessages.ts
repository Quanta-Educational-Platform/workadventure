// quanta: the class chat's pinned messages, as its room's server last sent them (common/quanta/RoomSession.ts): the
// strip at the top of the class chat shows them to everyone; staff pin and unpin from a message's actions.
import { writable } from "svelte/store";
import type { Mention } from "./mentions";

export interface PinnedMessage {
    id: string;
    sender: string;
    name: string;
    body: string;
    at: number;
    /** Who it names with @, as the room's server kept them (mentions.ts). */
    mentions?: Mention[];
}

export const pinnedMessagesStore = writable<{
    pins: PinnedMessage[];
    canPin: boolean;
    unpin: (id: string) => void;
}>({ pins: [], canPin: false, unpin: () => {} });
