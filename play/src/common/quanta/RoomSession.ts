import { isBlankChatBody } from "./chatBody";

export type ModerationAction =
    | "mute_chat"
    | "unmute_chat"
    | "mute_mic"
    | "mute_camera"
    | "allow_camera"
    | "remove"
    | "allow_back";
export type RoomPerson = { id: string; name: string; staff: boolean };
/** Someone a message names with @: as the server knew them when it was sent, never more than its readers see. */
export type RoomMention = { id: string; name: string };
/** Who reacted with each emoji, in the order they did. */
export type RoomReactions = Record<string, { id: string; name: string }[]>;
export type RoomMessage = {
    id: string;
    sender: string;
    name: string;
    body: string;
    at: number;
    edited?: true;
    reactions?: RoomReactions;
    mentions?: RoomMention[];
    /** quanta: a direct message, seen only by its sender and this account (and kept apart from the class's). */
    to?: string;
    toName?: string;
    /** Whether each of a direct message's two people was staff when it was sent, as the server knew from their
     *  sockets: who counts as staff while they are away. */
    fromStaff?: true;
    toStaff?: true;
};
// cameraOff: missing from what an older room saved.
export type SavedModeration = { removed: RoomPerson[]; muted: string[]; cameraOff?: string[] };
export const ROOM_SESSION_TTL = 30 * 60 * 1000;
/** The class chat a session keeps, and sends whoever joins or reloads. */
export const ROOM_HISTORY_LIMIT = 100;
/** Direct messages a session keeps for the whole room, apart from the class's: they never push the class chat out. */
export const ROOM_DIRECT_LIMIT = 200;

/** Messages staff may pin at the top of the class chat at once. */
export const ROOM_PINS_LIMIT = 5;

/** Whether this account may see the message: the class's are everyone's, a direct one its two people's. */
export function messageVisibleTo(message: RoomMessage, id: string): boolean {
    return message.to === undefined || message.sender === id || message.to === id;
}
/** How long a room's class chat outlives the last person in it, across play restarts. */
export const ROOM_CHAT_TTL = 12 * 60 * 60 * 1000;
/** A message's encoded size: CJK text at the 4000-character limit is 12 KB; escapes can't inflate past this. */
export const MESSAGE_BYTES_LIMIT = 16 * 1024;
/** History per snapshot, newest first: well inside the 4 MiB a connection may queue, with room for everything else. */
export const SNAPSHOT_HISTORY_BYTES = 1024 * 1024;
/** Direct messages per snapshot, on a budget of their own so they never crowd the class chat out of a reload. */
export const SNAPSHOT_DIRECT_BYTES = 512 * 1024;
const encoder = new TextEncoder();
/** What a message costs on the wire and in Redis: its JSON, as UTF-8. */
export function encodedSize(value: unknown): number {
    return encoder.encode(JSON.stringify(value)).length;
}
// Control characters other than tab and line breaks show as nothing and cost six bytes each once escaped.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Identity and permissions are supplied by the authenticated socket, never the command payload. */
const REACTIONS_PER_MESSAGE = 12;
/** A teacher's marks on a request: on the way, dealt with. They name who, and don't count as that teacher's reaction. */
export const REACTION_MARKERS: readonly string[] = ["👋", "✅"];

function mentionsOf(people: RoomPerson[]): RoomMention[] {
    return people.map((person) => ({ id: person.id, name: person.name.slice(0, 64) }));
}

/** What a pin keeps of its message: who wrote what, and when; not who reacted. */
function pinCopy(message: RoomMessage): RoomMessage {
    return {
        id: message.id,
        sender: message.sender,
        name: message.name,
        body: message.body,
        at: message.at,
        ...(message.edited && { edited: true as const }),
        ...(message.mentions && { mentions: message.mentions }),
    };
}

export class RoomSession {
    readonly messages: RoomMessage[] = [];
    /** When this process began the room's session: a history Redis kept since then is this session's. */
    readonly startedAt = Date.now();
    readonly muted = new Set<string>();
    /** Students whose camera a teacher turned off: it stays off until a teacher allows it again. */
    readonly cameraOff = new Set<string>();
    readonly removed = new Map<string, RoomPerson>();
    /** The class messages staff pinned, newest pin first: copies, so they outlast the history's limit. */
    readonly pins: RoomMessage[] = [];
    private sequence = 0;
    // Unpinned here before the saved pins were read: the read must not bring them back.
    private readonly unpinnedIds = new Set<string>();
    // Deleted here before the saved history was read: the read must not bring them back.
    private readonly deletedIds = new Set<string>();
    // People a teacher removed or let back, and muted or unmuted, in this process: for that question, their saved
    // state is older than the decision. The two are separate, so a mute never undoes a saved removal.
    private readonly removalDecided = new Set<string>();
    private readonly muteDecided = new Set<string>();
    private readonly cameraDecided = new Set<string>();
    private readonly commands = new Map<string, { at: number; count: number; syncAt?: number }>();

    /** Commands per account in 10 s: a teacher moderating a class (mutes, removals) needs more than a student's chat. */
    acceptCommand(id: string, limit = 10): boolean {
        const now = Date.now();
        for (const [account, budget] of this.commands) if (now - budget.at >= 10_000) this.commands.delete(account);
        let budget = this.commands.get(id);
        if (!budget) {
            if (this.commands.size >= 1000) return false;
            this.commands.set(id, (budget = { at: now, count: 0 }));
        }
        return ++budget.count <= limit;
    }

    /** How long until the account's 10 s budget starts over, for a command it refused. */
    retryAfter(id: string): number {
        const budget = this.commands.get(id);
        return budget ? Math.min(10_000, Math.max(1000, 10_000 - (Date.now() - budget.at))) : 10_000;
    }

    acceptSync(id: string): boolean {
        const budget = this.commands.get(id);
        if (!budget || (budget.syncAt !== undefined && Date.now() - budget.syncAt < 5000)) return false;
        budget.syncAt = Date.now();
        return true;
    }

    /** The body as kept: control characters dropped, within the length and size limits. A student muted in the class
     *  chat may still write to a teacher directly (to ask why, among others); one removed from the room may not. */
    private checkBody(sender: RoomPerson, input: unknown, direct = false): string {
        if (this.removed.has(sender.id) || (!direct && this.muted.has(sender.id)))
            throw new Error("Your chat is muted by the teacher.");
        if (typeof input !== "string") throw new Error("Message must contain 1–4000 characters.");
        const body = input.replace(CONTROL, "");
        if (isBlankChatBody(body) || body.length > 4000) throw new Error("Message must contain 1–4000 characters.");
        if (encodedSize(body) > MESSAGE_BYTES_LIMIT) throw new Error("Message is too large.");
        return body;
    }

    /**
     * A class message, or with `to` a direct one. Staff write to anyone and anyone to staff; a student writes to
     * another student only in reply, where that person wrote first (they were staff then: a teacher's thread).
     */
    send(sender: RoomPerson, input: unknown, to?: RoomPerson, mentions: RoomPerson[] = []): RoomMessage {
        if (to) {
            if (to.id === sender.id) throw new Error("You can't write to yourself.");
            const replying = this.messages.some((entry) => entry.sender === to.id && entry.to === sender.id);
            if (!sender.staff && !to.staff && !replying) throw new Error("Only a teacher can start a private chat.");
        }
        const body = this.checkBody(sender, input, to !== undefined);
        // Ids keep increasing across play restarts, so a restored history and new messages never share one.
        this.sequence = Math.max(this.sequence + 1, Date.now());
        const message: RoomMessage = {
            id: String(this.sequence),
            sender: sender.id,
            name: sender.name.slice(0, 64),
            body,
            at: Date.now(),
            ...(mentions.length > 0 && { mentions: mentionsOf(mentions) }),
            ...(to && {
                to: to.id,
                toName: to.name.slice(0, 64),
                ...(sender.staff && { fromStaff: true as const }),
                ...(to.staff && { toStaff: true as const }),
            }),
        };
        this.messages.push(message);
        this.trim();
        return message;
    }

    /** 100 class messages and 200 direct ones at 4000 UTF-16 characters bound text to 2.4 MB per active room. */
    private trim(): void {
        let classMessages = this.messages.filter((entry) => entry.to === undefined).length;
        let direct = this.messages.length - classMessages;
        for (
            let i = 0;
            i < this.messages.length && (classMessages > ROOM_HISTORY_LIMIT || direct > ROOM_DIRECT_LIMIT);
        ) {
            const isDirect = this.messages[i].to !== undefined;
            if (isDirect ? direct > ROOM_DIRECT_LIMIT : classMessages > ROOM_HISTORY_LIMIT) {
                this.messages.splice(i, 1);
                if (isDirect) direct--;
                else classMessages--;
            } else i++;
        }
    }

    /** The message as edited, or undefined when there was nothing to change. Only its author edits it. */
    edit(sender: RoomPerson, id: unknown, input: unknown, mentions: RoomPerson[] = []): RoomMessage | undefined {
        // A message this account can't see answers as one that doesn't exist: nobody learns a direct message is there.
        const message = this.messages.find((entry) => entry.id === id && messageVisibleTo(entry, sender.id));
        if (!message) return undefined;
        const body = this.checkBody(sender, input, message.to !== undefined);
        if (message.sender !== sender.id) throw new Error("Only the author can edit a message.");
        if (message.body === body) return undefined;
        message.body = body;
        message.edited = true;
        if (mentions.length > 0) message.mentions = mentionsOf(mentions);
        else delete message.mentions;
        this.refreshPin(message);
        return message;
    }

    /** Adds this person's reaction, or takes it back. The message as it now stands, or undefined when it is gone. */
    react(sender: RoomPerson, id: unknown, emoji: unknown): RoomMessage | undefined {
        if (typeof emoji !== "string" || emoji.length > 16 || !/^\p{Extended_Pictographic}/u.test(emoji))
            throw new Error("Invalid reaction.");
        const message = this.messages.find((entry) => entry.id === id && messageVisibleTo(entry, sender.id));
        if (!message) return undefined;
        // The class chat's mute leaves a direct conversation with a teacher open; a removal closes everything.
        if (this.removed.has(sender.id) || (message.to === undefined && this.muted.has(sender.id)))
            throw new Error("Your chat is muted by the teacher.");
        const people = message.reactions?.[emoji] ?? [];
        const taken = people.some((person) => person.id === sender.id);
        const marker = REACTION_MARKERS.includes(emoji);
        if (marker && !sender.staff && !taken) throw new Error("Only a teacher can mark this.");
        if (
            !taken &&
            !message.reactions?.[emoji] &&
            Object.keys(message.reactions ?? {}).length >= REACTIONS_PER_MESSAGE
        )
            throw new Error("This message has too many different reactions.");
        const next = taken
            ? people.filter((person) => person.id !== sender.id)
            : [...people, { id: sender.id, name: sender.name.slice(0, 64) }];
        // A new object: the caller keeps the message as it was, to replace it in the saved history.
        const reactions = { ...message.reactions, [emoji]: next };
        if (next.length === 0) delete reactions[emoji];
        // One reaction a person: a new one takes the place of the last.
        if (!marker && !taken) {
            for (const [other, who] of Object.entries(reactions)) {
                if (other === emoji || REACTION_MARKERS.includes(other)) continue;
                const left = who.filter((person) => person.id !== sender.id);
                if (left.length === 0) delete reactions[other];
                else if (left.length < who.length) reactions[other] = left;
            }
        }
        if (Object.keys(reactions).length > 0) message.reactions = reactions;
        else delete message.reactions;
        return message;
    }

    /** The newest messages this account may see, at most SNAPSHOT_HISTORY_BYTES of them encoded, oldest first. */
    history(forId: string): RoomMessage[] {
        const recent: RoomMessage[] = [];
        let classBytes = 0;
        let directBytes = 0;
        for (let i = this.messages.length - 1; i >= 0; i--) {
            const message = this.messages[i];
            if (!messageVisibleTo(message, forId)) continue;
            // Each kind on its own budget, so a long private conversation never takes the class chat's place.
            if (message.to === undefined) {
                classBytes += encodedSize(message);
                if (classBytes > SNAPSHOT_HISTORY_BYTES) continue;
            } else {
                directBytes += encodedSize(message);
                if (directBytes > SNAPSHOT_DIRECT_BYTES) continue;
            }
            recent.push(message);
        }
        return recent.reverse();
    }

    /** Adds saved messages this process doesn't have, in order; true when anything changed. */
    restoreMessages(saved: RoomMessage[]): boolean {
        const known = new Set(this.messages.map((message) => message.id));
        const missing = saved.filter((message) => !known.has(message.id) && !this.deletedIds.has(message.id));
        if (!missing.length) return false;
        const merged = [...missing, ...this.messages].sort((a, b) => Number(a.id) - Number(b.id));
        this.messages.splice(0, this.messages.length, ...merged);
        this.trim();
        this.sequence = Math.max(this.sequence, ...this.messages.map((message) => Number(message.id) || 0));
        return true;
    }

    delete(sender: RoomPerson, id: unknown): RoomMessage | undefined {
        // A direct message is its two people's: staff outside it can't see it, so they don't delete it either.
        const index = this.messages.findIndex((message) => message.id === id && messageVisibleTo(message, sender.id));
        if (index < 0) return undefined;
        if (!sender.staff && this.messages[index].sender !== sender.id)
            throw new Error("Only staff can delete another person's message.");
        const [deleted] = this.messages.splice(index, 1);
        if (this.deletedIds.size < 10_000) this.deletedIds.add(deleted.id);
        const pinned = this.pins.findIndex((pin) => pin.id === deleted.id);
        if (pinned >= 0) this.pins.splice(pinned, 1);
        return deleted;
    }

    /** Pins a class message at the top of the chat, or unpins it: staff only. True when the pins changed. */
    pin(sender: RoomPerson, id: unknown, on: unknown): boolean {
        if (!sender.staff) throw new Error("Only staff can pin messages.");
        const index = this.pins.findIndex((pin) => pin.id === id);
        if (on !== true) {
            if (index < 0) return false;
            this.pins.splice(index, 1);
            if (this.unpinnedIds.size < 1000) this.unpinnedIds.add(String(id));
            return true;
        }
        const message = this.messages.find((entry) => entry.id === id && entry.to === undefined);
        if (!message) throw new Error("This message can no longer be pinned.");
        if (index >= 0) return false;
        this.pins.unshift(pinCopy(message));
        this.pins.splice(ROOM_PINS_LIMIT);
        this.unpinnedIds.delete(message.id);
        return true;
    }

    /** An edited message's pin reads as the message now does. */
    private refreshPin(message: RoomMessage): void {
        const index = this.pins.findIndex((pin) => pin.id === message.id);
        if (index >= 0) this.pins[index] = pinCopy(message);
    }

    /**
     * Adds the saved pins under the ones made here before the read answered, up to ROOM_PINS_LIMIT, leaving out
     * messages deleted or unpinned here meanwhile; true when anything changed.
     */
    restorePins(saved: RoomMessage[]): boolean {
        const known = new Set(this.pins.map((pin) => pin.id));
        const kept = saved.filter(
            (pin) =>
                pin.to === undefined &&
                !known.has(pin.id) &&
                !this.deletedIds.has(pin.id) &&
                !this.unpinnedIds.has(pin.id),
        );
        const room = ROOM_PINS_LIMIT - this.pins.length;
        if (!kept.length || room <= 0) return false;
        this.pins.push(...kept.slice(0, room).map(pinCopy));
        return true;
    }

    moderate(sender: RoomPerson, action: unknown, target: RoomPerson | undefined): ModerationAction {
        if (!sender.staff) throw new Error("Only staff can moderate the room.");
        if (!target) throw new Error("Person not found.");
        if (target.staff) throw new Error("Staff cannot moderate other staff.");
        switch (action) {
            case "mute_chat":
                if (this.muted.size >= 1000 && !this.muted.has(target.id)) throw new Error("Room mute limit reached.");
                this.muted.add(target.id);
                break;
            case "unmute_chat":
                this.muted.delete(target.id);
                break;
            case "remove":
                if (this.removed.size >= 1000 && !this.removed.has(target.id))
                    throw new Error("Room removal limit reached.");
                this.removed.set(target.id, target);
                break;
            case "allow_back":
                this.removed.delete(target.id);
                break;
            case "mute_camera":
                if (this.cameraOff.size >= 1000 && !this.cameraOff.has(target.id))
                    throw new Error("Room camera limit reached.");
                this.cameraOff.add(target.id);
                break;
            case "allow_camera":
                this.cameraOff.delete(target.id);
                break;
            case "mute_mic":
                break;
            default:
                throw new Error("Unknown moderation action.");
        }
        if (action === "remove" || action === "allow_back") this.removalDecided.add(target.id);
        if (action === "mute_chat" || action === "unmute_chat") this.muteDecided.add(target.id);
        if (action === "mute_camera" || action === "allow_camera") this.cameraDecided.add(target.id);
        return action;
    }

    saved(): SavedModeration {
        return { removed: [...this.removed.values()], muted: [...this.muted], cameraOff: [...this.cameraOff] };
    }

    /** Adds saved decisions about people nobody has acted on here yet; true when anything changed. */
    restore(saved: SavedModeration): boolean {
        let changed = false;
        for (const person of saved.removed) {
            if (this.removalDecided.has(person.id) || this.removed.has(person.id) || this.removed.size >= 1000)
                continue;
            this.removed.set(person.id, person);
            changed = true;
        }
        for (const id of saved.muted) {
            if (this.muteDecided.has(id) || this.muted.has(id) || this.muted.size >= 1000) continue;
            this.muted.add(id);
            changed = true;
        }
        for (const id of saved.cameraOff ?? []) {
            if (this.cameraDecided.has(id) || this.cameraOff.has(id) || this.cameraOff.size >= 1000) continue;
            this.cameraOff.add(id);
            changed = true;
        }
        return changed;
    }
}

export class RoomSessions {
    private readonly rooms = new Map<
        string,
        { session: RoomSession; members: Set<object>; expiry?: ReturnType<typeof setTimeout> }
    >();
    get(room: string): RoomSession {
        let entry = this.rooms.get(room);
        if (!entry) {
            entry = { session: new RoomSession(), members: new Set() };
            this.rooms.set(room, entry);
            this.expire(room, entry);
        }
        return entry.session;
    }
    join(room: string, member: object): void {
        this.get(room);
        const entry = this.rooms.get(room)!;
        clearTimeout(entry.expiry);
        entry.members.add(member);
    }
    leave(room: string, member: object): void {
        const entry = this.rooms.get(room);
        if (!entry) return;
        entry.members.delete(member);
        if (!entry.members.size) {
            entry.session.muted.clear();
            entry.session.cameraOff.clear();
            this.expire(room, entry);
        }
    }
    private expire(room: string, entry: { expiry?: ReturnType<typeof setTimeout> }): void {
        clearTimeout(entry.expiry);
        entry.expiry = setTimeout(() => this.rooms.delete(room), ROOM_SESSION_TTL);
        entry.expiry.unref?.();
    }
}
