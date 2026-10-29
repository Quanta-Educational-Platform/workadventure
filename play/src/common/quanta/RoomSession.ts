export type ModerationAction = "mute_chat" | "unmute_chat" | "mute_mic" | "remove" | "allow_back";
export type RoomPerson = { id: string; name: string; staff: boolean };
export type RoomMessage = { id: string; sender: string; name: string; body: string; at: number };
export const ROOM_SESSION_TTL = 30 * 60 * 1000;

/** Identity and permissions are supplied by the authenticated socket, never the command payload. */
export class RoomSession {
    readonly messages: RoomMessage[] = [];
    readonly muted = new Set<string>();
    readonly removed = new Map<string, RoomPerson>();
    private sequence = 0;
    private readonly commands = new Map<string, { at: number; count: number; syncAt?: number }>();

    acceptCommand(id: string): boolean {
        const now = Date.now();
        for (const [account, budget] of this.commands) if (now - budget.at >= 10_000) this.commands.delete(account);
        let budget = this.commands.get(id);
        if (!budget) {
            if (this.commands.size >= 1000) return false;
            this.commands.set(id, (budget = { at: now, count: 0 }));
        }
        return ++budget.count <= 10;
    }

    acceptSync(id: string): boolean {
        const budget = this.commands.get(id);
        if (!budget || (budget.syncAt !== undefined && Date.now() - budget.syncAt < 5000)) return false;
        budget.syncAt = Date.now();
        return true;
    }

    send(sender: RoomPerson, body: unknown): void {
        if (this.muted.has(sender.id) || this.removed.has(sender.id))
            throw new Error("Your chat is muted by the teacher.");
        if (typeof body !== "string" || !body.trim() || body.length > 4000)
            throw new Error("Message must contain 1–4000 characters.");
        this.messages.push({
            id: String(++this.sequence),
            sender: sender.id,
            name: sender.name.slice(0, 64),
            body,
            at: Date.now(),
        });
        // 100 messages at 4000 UTF-16 characters bounds text to 800 KB per active room.
        if (this.messages.length > 100) this.messages.shift();
    }

    delete(sender: RoomPerson, id: unknown): boolean {
        const index = this.messages.findIndex((message) => message.id === id);
        if (index < 0) return false;
        if (!sender.staff && this.messages[index].sender !== sender.id)
            throw new Error("Only staff can delete another person's message.");
        this.messages.splice(index, 1);
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
            case "mute_mic":
                break;
            default:
                throw new Error("Unknown moderation action.");
        }
        return action;
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
            this.expire(room, entry);
        }
    }
    private expire(room: string, entry: { expiry?: ReturnType<typeof setTimeout> }): void {
        clearTimeout(entry.expiry);
        entry.expiry = setTimeout(() => this.rooms.delete(room), ROOM_SESSION_TTL);
        entry.expiry.unref?.();
    }
}
