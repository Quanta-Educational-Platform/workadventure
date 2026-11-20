// quanta: someone named this viewer with @ (mentions.ts): a toast and a sound wherever they are, the chat closed or
// on another conversation, and an "@" on the chat button and the conversation's tab until they look at it.
import { derived, get } from "svelte/store";
import type { ChatRoom } from "../Chat/Connection/ChatConnection";
import { selectedRoomStore } from "../Chat/Stores/SelectRoomStore";
import { gameManager } from "../Phaser/Game/GameManager";
import { chatVisibilityStore } from "../Stores/ChatStore";
import { chatNotificationStore } from "../Stores/ProximityNotificationStore";
import { chatTextFromBody } from "../../common/quanta/chatBody";
import { isClassChat } from "./chatAudience";
import { activeDirectStore, openDirect } from "./directMessages";
import { fullNamesStore, shownName } from "./fullNames";
import { clearMentioned, markMentioned } from "./mentions";
import { conversationOf } from "./conversationKey";

type Entry = {
    id: string;
    sender: string;
    name: string;
    body: string;
    to?: string;
    group?: { id: string; name: string }[];
};

const announced = new Set<string>();
const PREVIEW = 80;
// One toast and sound per sender in this long: the "@" marks still show every mention.
const SENDER_GAP_MS = 5000;
const lastToast = new Map<string, number>();

/** Which chat is in front of the viewer now: "class", a direct conversation's person, or none. */
const readingStore = derived(
    [chatVisibilityStore, selectedRoomStore, activeDirectStore],
    ([visible, selected, direct]): string | undefined => {
        if (!visible) return undefined;
        if (direct !== undefined) return direct;
        return isClassChat(selected) ? "class" : undefined;
    },
);
// Lives as long as the page.
// eslint-disable-next-line svelte/no-ignored-unsubscribe
readingStore.subscribe((chat) => {
    if (chat !== undefined) clearMentioned(chat);
});

export function announceMention(entry: Entry, room: ChatRoom, self = ""): void {
    if (announced.has(entry.id)) return;
    announced.add(entry.id);
    const conversation = conversationOf(entry, self);
    const chat = conversation ?? "class";
    if (get(readingStore) === chat) return;
    markMentioned(chat);
    const now = Date.now();
    if (now - (lastToast.get(entry.sender) ?? -Infinity) < SENDER_GAP_MS) return;
    lastToast.set(entry.sender, now);
    const name = shownName(get(fullNamesStore), entry.sender, entry.name);
    const text = chatTextFromBody(entry.body).replace(/\s+/g, " ").trim();
    const preview = text.length > PREVIEW ? `${text.slice(0, PREVIEW)}…` : text;
    chatNotificationStore.addNotification(name, preview, room, entry.id, true, undefined, {
        mention: true,
        ...(conversation !== undefined && {
            onOpen: () =>
                openDirect(
                    conversation,
                    entry.group
                        ? [{ id: entry.sender, name: entry.name }, ...entry.group]
                              .filter((member) => member.id !== self)
                              .map((member) => member.name)
                              .join(", ")
                        : entry.name,
                ),
        }),
    });
    // A direct message rings already (directMessages.ts).
    if (conversation !== undefined) return;
    try {
        gameManager.getCurrentGameScene().playSound("new-message", 0.35);
    } catch {
        /* No scene: nothing to play the sound in. */
    }
}
