// quanta: @mentions in the class chat and direct messages. A message names people as "@Name", where Name is what the
// writer's room calls them (real names for teachers, usernames for students, fullNames.ts); its client sends their
// ids along, and the room's server keeps only people in the room now (in a direct message, its other person).
import { get, writable } from "svelte/store";
import { mentionText, namesMention } from "../../common/quanta/chatBody";
import { roomModerationStore } from "./moderationBridge";
import { fullNamesStore, shownName } from "./fullNames";
import { groupMembers, isGroupConversation } from "./conversationKey";

export interface MentionPerson {
    id: string;
    /** As this viewer's room shows them, what "@" writes. */
    shown: string;
    /** The room's server's name for them, when it differs. */
    name: string;
    staff: boolean;
}

export type Mention = { id: string; name: string };

/** People who can be named here: everyone in the room but this viewer, or in a direct message its other person. */
export function mentionPeople(peerId?: string): MentionPerson[] {
    const room = get(roomModerationStore);
    const names = get(fullNamesStore);
    const people = (room?.people ?? []).filter((person) => person.id !== room?.self);
    // In a group's conversation, its people; in a direct one, its other person.
    const members = peerId !== undefined && isGroupConversation(peerId) ? new Set(groupMembers(peerId)) : undefined;
    return people
        .filter((person) => peerId === undefined || (members ? members.has(person.id) : person.id === peerId))
        .map((person) => ({
            id: person.id,
            shown: shownName(names, person.id, person.name),
            name: person.name,
            staff: person.staff,
        }));
}

const collator = new Intl.Collator(undefined, { sensitivity: "base" });
const fold = (text: string) => text.toLocaleLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");

/** Who the list offers for what was typed after "@": a word of the name starting with it; teachers first. */
export function mentionMatches(people: MentionPerson[], query: string, limit = 50): MentionPerson[] {
    const wanted = fold(query.trim());
    const starts = (text: string) =>
        !wanted || fold(text).startsWith(wanted) || fold(text).split(/[\s._-]+/).some((word) => word.startsWith(wanted));
    return people
        .filter((person) => starts(person.shown) || starts(person.name))
        .sort((a, b) => Number(b.staff) - Number(a.staff) || collator.compare(a.shown, b.shown))
        .slice(0, limit);
}

/** The "@query" the caret is at the end of, if any: "@" at the start or after a space, up to 40 characters. */
export function mentionQueryBefore(text: string): string | undefined {
    const match = /(?:^|[\s(])@([^\s@][^@\n]{0,39}|)$/u.exec(text);
    return match ? match[1] : undefined;
}

const wordAfter = /^[\p{L}\p{N}_]/u;

/** The ids of the people a body names with "@", of those who can be named (mentionPeople). */
export function mentionIdsIn(body: string, peerId?: string): string[] {
    if (!body.includes("@")) return [];
    const text = mentionText(body);
    return mentionPeople(peerId)
        .filter((person) => namesMention(text, person.shown) || namesMention(text, person.name))
        .map((person) => person.id);
}

/**
 * A message's HTML with every "@Name" it mentions wrapped, the viewer's own marked: text only, never inside a link.
 * Each reads as this viewer's room calls the person: a teacher reads the real name the class chat's server name stands for.
 */
export function markMentions(
    html: string,
    mentions: readonly Mention[],
    self: string | undefined,
    fullNames: ReadonlyMap<string, string>,
): string {
    if (!mentions.length || !html.includes("@")) return html;
    const targets = mentions
        .flatMap((mention) => {
            const shown = shownName(fullNames, mention.id, mention.name);
            return [...new Set([shown, mention.name])].map((name) => ({
                at: `@${name}`,
                shown: `@${shown}`,
                me: mention.id === self,
            }));
        })
        .sort((a, b) => b.at.length - a.at.length);
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode())
        if (node instanceof Text && node.data.includes("@") && !node.parentElement?.closest("a, code")) texts.push(node);
    for (const node of texts) {
        const value = node.data.replace(/ /g, " ");
        const parts: (string | { text: string; me: boolean })[] = [];
        let last = 0;
        for (let i = value.indexOf("@"); i >= 0; i = value.indexOf("@", i + 1)) {
            if (i < last || (i > 0 && wordAfter.test(value[i - 1]))) continue;
            const target = targets.find(
                (candidate) =>
                    value.startsWith(candidate.at, i) && !wordAfter.test(value.slice(i + candidate.at.length)),
            );
            if (!target) continue;
            parts.push(node.data.slice(last, i), { text: target.shown, me: target.me });
            last = i + target.at.length;
        }
        if (!parts.length) continue;
        parts.push(node.data.slice(last));
        const fragment = doc.createDocumentFragment();
        for (const part of parts) {
            if (typeof part === "string") {
                if (part) fragment.append(part);
                continue;
            }
            const span = doc.createElement("span");
            span.className = part.me ? "quanta-mention me" : "quanta-mention";
            span.textContent = part.text;
            fragment.append(span);
        }
        node.replaceWith(fragment);
    }
    return doc.body.innerHTML;
}

/** Chats where someone named this viewer since they last looked: "class", or a direct conversation's person. */
export const mentionMarksStore = writable<ReadonlySet<string>>(new Set());

export function markMentioned(chat: string): void {
    mentionMarksStore.update((marks) => (marks.has(chat) ? marks : new Set([...marks, chat])));
}

export function clearMentioned(chat: string): void {
    mentionMarksStore.update((marks) => {
        if (!marks.has(chat)) return marks;
        const next = new Set(marks);
        next.delete(chat);
        return next;
    });
}
