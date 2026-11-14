// quanta: private conversations between staff and one person in the room. They are class chat messages with a
// recipient (common/quanta/RoomSession.ts): the room's server keeps them with the class chat, across reloads and
// reconnections, and sends each only to its two people. Staff start a conversation from the platform's people list;
// the person can then reply. This module is the class chat's direct messages, grouped by the other person.
import { get, writable } from "svelte/store";
import type { ChatMessage } from "../Chat/Connection/ChatConnection";
import { chatVisibilityStore } from "../Stores/ChatStore";
import { gameManager } from "../Phaser/Game/GameManager";
import { classChatRoom } from "./chatAudience";
import { chatBodyFromText } from "../../common/quanta/chatBody";
import { directEntriesStore, type DirectEntry } from "./directEntries";

export interface DirectConversation {
    /** The other person's account. */
    peerId: string;
    name: string;
    messages: ChatMessage[];
    unread: boolean;
}

export const directConversationsStore = writable<DirectConversation[]>([]);
/** The conversation the side column shows instead of the class's or table's chat, if any. */
export const activeDirectStore = writable<string | undefined>(undefined);

// Messages already shown or counted, so a snapshot that repeats them (a reconnection) is not news.
const seen = new Set<string>();
// What the first history after this page opened holds is history (read or not before a reload); ids only grow.
let historyUpTo: number | undefined;
// So is what was sent before this page opened, for a history the room's server restores after sending that one, or
// messages arriving before it; the slack covers the server's clock running behind this one.
const NEWS_SINCE = Date.now() - 60_000;

function isShown(peerId: string): boolean {
    return get(activeDirectStore) === peerId && get(chatVisibilityStore);
}

/** The class chat's direct messages, as it last rendered them; conversations opened without any are kept. */
function setDirectMessages(rendered: { entries: DirectEntry[]; newestId: number | undefined } | undefined): void {
    if (!rendered) return;
    const { entries, newestId } = rendered;
    historyUpTo ??= newestId;
    const history = historyUpTo ?? 0;
    let arrived = false;
    directConversationsStore.update((all) => {
        const byPeer = new Map<string, DirectConversation>();
        for (const conversation of all) byPeer.set(conversation.peerId, { ...conversation, messages: [] });
        for (const entry of entries) {
            const conversation = byPeer.get(entry.peerId) ?? {
                peerId: entry.peerId,
                name: entry.peerName,
                messages: [],
                unread: false,
            };
            if (entry.peerName) conversation.name = entry.peerName;
            conversation.messages.push(entry.message);
            if (!seen.has(entry.id)) {
                seen.add(entry.id);
                const sentAt = entry.message.date?.getTime() ?? 0;
                if (Number(entry.id) > history && sentAt > NEWS_SINCE && !entry.mine && !isShown(entry.peerId)) {
                    conversation.unread = true;
                    arrived = true;
                }
            }
            byPeer.set(entry.peerId, conversation);
        }
        return [...byPeer.values()];
    });
    if (arrived) {
        try {
            gameManager.getCurrentGameScene().playSound("new-message");
        } catch {
            /* No scene: nothing to play the sound in. */
        }
    }
}

/** Shows the conversation with this person in the side column, starting it if needed. */
export function openDirect(peerId: string, name: string): void {
    directConversationsStore.update((all) =>
        all.some((conversation) => conversation.peerId === peerId)
            ? all.map((conversation) =>
                  conversation.peerId === peerId
                      ? { ...conversation, name: name || conversation.name, unread: false }
                      : conversation,
              )
            : [...all, { peerId, name, messages: [], unread: false }],
    );
    activeDirectStore.set(peerId);
    chatVisibilityStore.set(true);
}

/** From the platform's people list and the person menu, which know people by account. */
export function openDirectWithAccount(uuid: string, name: string): boolean {
    if (!uuid) return false;
    openDirect(uuid, name);
    return true;
}

export function closeDirect(): void {
    activeDirectStore.set(undefined);
}

/** Unsent text and why the last message wasn't sent, per conversation: kept while its view is closed, and what is
 *  typed to one person never goes to another. */
export const directDrafts = new Map<string, string>();
export const directSendErrors = new Map<string, string>();
/** Messages the room's server refused, per conversation, until its view takes them back (takeDirectFailure). */
export const directFailuresStore = writable<ReadonlyMap<string, { text: string; reason: string }>>(new Map());

export function takeDirectFailure(peerId: string): { text: string; reason: string } | undefined {
    const failure = get(directFailuresStore).get(peerId);
    if (failure) {
        directFailuresStore.update((all) => {
            const next = new Map(all);
            next.delete(peerId);
            return next;
        });
    }
    return failure;
}

/** Sent through the class chat, which holds it back and sends it again like its own messages. Undefined when there was
 *  nothing to send or no chat to send it in. Refused (the person left, the teacher removed you): the text waits in
 *  directFailuresStore, with why, whether or not its conversation is still shown. */
export function sendDirect(peerId: string, text: string): Promise<void> | undefined {
    const trimmed = text.trim();
    const room = classChatRoom();
    if (!trimmed || !room) return undefined;
    const sending = room.sendDirectMessage(peerId, chatBodyFromText(trimmed));
    sending.catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        directFailuresStore.update((all) => {
            const next = new Map(all);
            const earlier = next.get(peerId);
            next.set(peerId, { text: earlier ? `${earlier.text}\n${text}` : text, reason });
            return next;
        });
    });
    return sending;
}

directEntriesStore.subscribe(setDirectMessages);

// A conversation opened and left without a message (a tap on "Message") is not kept: the chat opens on the class's
// chat next time, as it would have before.
chatVisibilityStore.subscribe((visible) => {
    if (visible) return;
    const active = get(activeDirectStore);
    const conversation = get(directConversationsStore).find((entry) => entry.peerId === active);
    if (active === undefined || (conversation && conversation.messages.length > 0)) return;
    activeDirectStore.set(undefined);
    directConversationsStore.update((all) => all.filter((entry) => entry.peerId !== active || entry.messages.length > 0));
});
