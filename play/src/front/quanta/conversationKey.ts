// quanta: which private conversation a room message belongs to. A direct one is its other person's id; a group's (a
// bubble of three or more, common/quanta/RoomSession.ts) is "g:" and everyone's ids, so the same people meeting again
// open the same conversation.
import { groupKey } from "../../common/quanta/RoomSession";

const GROUP_PREFIX = "g:";

export function isGroupConversation(key: string): boolean {
    return key.startsWith(GROUP_PREFIX);
}

/** The group conversation of these people (this viewer included). */
export function groupConversation(ids: Iterable<string>): string {
    return GROUP_PREFIX + groupKey(ids);
}

/** A group conversation's people, this viewer included. */
export function groupMembers(key: string): string[] {
    return isGroupConversation(key) ? key.slice(GROUP_PREFIX.length).split(",").filter(Boolean) : [];
}

/** The conversation a bubble's chat is kept in: the other person's for two, the group's for more. */
export function bubbleConversation(self: string, others: string[]): string | undefined {
    const ids = [...new Set(others)].filter((id) => id && id !== self);
    if (ids.length === 0) return undefined;
    return ids.length === 1 ? ids[0] : groupConversation([self, ...ids]);
}

/** The private conversation a message is in for this viewer, or undefined for the class's. */
export function conversationOf(
    entry: { sender: string; to?: string; group?: { id: string }[] },
    self: string,
): string | undefined {
    if (entry.group !== undefined) return groupConversation([entry.sender, ...entry.group.map((member) => member.id)]);
    if (entry.to !== undefined) return entry.sender === self ? entry.to : entry.sender;
    return undefined;
}
