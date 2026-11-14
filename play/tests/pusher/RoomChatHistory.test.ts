import { beforeEach, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import type { SocketData } from "../../src/pusher/models/Websocket/SocketData";
import type { PusherWebSocket } from "../../src/pusher/services/PusherWebSocket";
import type * as RoomModeration from "../../src/pusher/quanta/roomModeration";
import { ROOM_CHAT_TTL, ROOM_HISTORY_LIMIT, RoomSession } from "../../src/common/quanta/RoomSession";

const redis = vi.hoisted(() => {
    const strings = new Map<string, string>();
    const lists = new Map<string, string[]>();
    const sets = new Map<string, Set<string>>();
    const ttls = new Map<string, number>();
    const range = (list: string[], start: number, stop: number) => {
        const from = start < 0 ? Math.max(0, list.length + start) : start;
        const to = stop < 0 ? list.length + stop : stop;
        return list.slice(from, to + 1);
    };
    const control: {
        readGate?: Promise<void>;
        failChatReads: boolean;
        failWrites: boolean;
        // Commands wait in node-redis's offline queue until Redis is back.
        offline: boolean;
        queued: (() => void)[];
    } = { failChatReads: false, failWrites: false, offline: false, queued: [] };
    const write = <T>(apply: () => T): Promise<T> => {
        if (control.failWrites) return Promise.reject(new Error("Redis write failed"));
        if (!control.offline) return Promise.resolve(apply());
        return new Promise((resolve) => {
            control.queued.push(() => resolve(apply()));
        });
    };
    // When each key expires, on the test's clock; a key past it is gone, as in Redis.
    const expiry = new Map<string, number>();
    const exists = (key: string) => lists.has(key) || sets.has(key) || strings.has(key);
    const alive = (key: string) => {
        const at = expiry.get(key);
        if (at !== undefined && at <= Date.now()) {
            for (const store of [lists, sets, strings, expiry, ttls]) store.delete(key);
        }
        return exists(key);
    };
    const expire = (key: string, ttl: number) => {
        if (!exists(key)) return;
        ttls.set(key, ttl);
        expiry.set(key, Date.now() + ttl);
    };
    const pttl = (key: string) => {
        const at = expiry.get(key);
        return at === undefined ? -1 : at - Date.now();
    };
    const remove = (key: string, value: string) => {
        const list = lists.get(key) ?? [];
        const index = list.indexOf(value);
        if (index >= 0) list.splice(index, 1);
        return index >= 0 ? 1 : 0;
    };
    const client = {
        get: vi.fn(async (key: string) => {
            await control.readGate;
            alive(key);
            return strings.get(key) ?? null;
        }),
        set: vi.fn((key: string, value: string) => write(() => strings.set(key, value) && "OK")),
        pExpire: vi.fn((key: string, ttl: number) => write(() => ttls.set(key, ttl) && 1)),
        lRange: vi.fn(async (key: string, start: number, stop: number) => {
            await control.readGate;
            if (control.failChatReads) throw new Error("Redis read failed");
            alive(key);
            return range(lists.get(key) ?? [], start, stop);
        }),
        sMembers: vi.fn(async (key: string) => {
            await control.readGate;
            if (control.failChatReads) throw new Error("Redis read failed");
            alive(key);
            return [...(sets.get(key) ?? [])];
        }),
        zRange: vi.fn(async (key: string) => {
            await control.readGate;
            if (control.failChatReads) throw new Error("Redis read failed");
            alive(key);
            return [...(sets.get(key) ?? [])].sort((a, b) => Number(a) - Number(b));
        }),
        lRem: vi.fn((key: string, _count: number, value: string) => write(() => remove(key, value))),
        multi: vi.fn(() => {
            const steps: (() => void)[] = [];
            const chain = {
                rPush: (key: string, value: string) => {
                    steps.push(() => lists.set(key, [...(lists.get(key) ?? []), value]));
                    return chain;
                },
                lTrim: (key: string, start: number, stop: number) => {
                    steps.push(() => lists.set(key, range(lists.get(key) ?? [], start, stop)));
                    return chain;
                },
                pExpire: (key: string, ttl: number) => {
                    steps.push(() => ttls.set(key, ttl));
                    return chain;
                },
                exec: () => write(() => steps.map((step) => step())),
            };
            return chain;
        }),
        // CHAT_WRITE_SCRIPT, step for step, with the test's clock standing in for Redis's TIME. Deleted ids, a sorted
        // set scored by id there, are a set here, sorted when read. Earlier versions of the script took fewer
        // arguments; they are modelled too, so a test can show what they got wrong.
        eval: vi.fn((_script: string, options: { keys: string[]; arguments: string[] }) =>
            write(() => {
                const [list, deleted, occupiedKey] = options.keys;
                const [
                    deadline,
                    ttlArg,
                    limitArg,
                    append,
                    deletedId,
                    deletedEntry,
                    now,
                    occupied,
                    sessionTtl,
                    live,
                    editedFrom,
                    editedTo,
                ] = options.arguments;
                const version = options.arguments.length;
                const ttl = Number(ttlArg);
                const limit = Number(limitArg);
                if (Date.now() > Number(deadline)) return 0;
                for (const key of options.keys) alive(key);
                if (version >= 9 && occupied === "1") {
                    const last = strings.get(occupiedKey);
                    const exists = lists.has(list) || sets.has(deleted);
                    if (
                        (last === undefined && exists) ||
                        (last !== undefined && Number(version >= 10 ? live : now) - Number(last) > Number(sessionTtl))
                    )
                        for (const key of [list, deleted])
                            for (const store of [lists, sets, expiry, ttls]) store.delete(key);
                }
                if (append) lists.set(list, range([...(lists.get(list) ?? []), append], -limit, -1));
                if (editedFrom) {
                    const saved = lists.get(list) ?? [];
                    const at = saved.indexOf(editedFrom);
                    if (at >= 0) saved[at] = editedTo;
                }
                if (deletedId) {
                    remove(list, deletedEntry);
                    if (!lists.get(list)?.length) lists.delete(list);
                    const ids = [...(sets.get(deleted) ?? []), deletedId].sort((a, b) => Number(a) - Number(b));
                    sets.set(deleted, new Set(version >= 9 ? ids.slice(-limit) : ids));
                }
                if (version < 8) {
                    for (const key of [list, deleted]) expire(key, ttl);
                    return 1;
                }
                const oldest = lists.get(list)?.[0];
                if (oldest) {
                    const first = Number((JSON.parse(oldest) as { id: string }).id);
                    for (const id of sets.get(deleted) ?? []) if (Number(id) < first) sets.get(deleted)?.delete(id);
                    if (!sets.get(deleted)?.size) sets.delete(deleted);
                }
                if (occupied === "1") {
                    strings.set(occupiedKey, now);
                    for (const key of options.keys) expire(key, ttl);
                } else
                    for (const key of [list, deleted]) {
                        const left = pttl(key);
                        if (left === -1 || left > ttl) expire(key, ttl);
                    }
                return 1;
            }),
        ),
    };
    const reconnect = () => {
        control.offline = false;
        for (const queued of control.queued.splice(0)) queued();
    };
    return { strings, lists, sets, ttls, expiry, control, client, reconnect, pttl };
});
vi.mock("../../src/pusher/services/RedisClient", () => ({ getRedisClient: () => Promise.resolve(redis.client) }));
vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

let play: typeof RoomModeration;
const sockets: PusherWebSocket[] = [];
const CHAT_KEY = "quanta:room-chat:class";
const TOMBSTONES = "quanta:room-chat-tombstones:class";

/** A fresh play process: in-memory sessions are gone, Redis keeps what was written. */
function disconnectAll(): void {
    for (const client of sockets.splice(0)) play?.leaveModeratedRoom(client);
}
async function restartPlay(): Promise<void> {
    disconnectAll();
    vi.resetModules();
    play = await import("../../src/pusher/quanta/roomModeration");
}
function socket(id: string, staff = false) {
    const client = mock<PusherWebSocket>();
    const data = mock<SocketData>({
        userUuid: id,
        name: id,
        tags: staff ? ["admin"] : [],
        roomId: "https://play.test/class",
        world: "class",
        quantaPublicName: id,
    });
    data.spaces = new Set(["class.quantaRoomChat"]);
    client.getUserData.mockReturnValue(data);
    client.isDisconnecting.mockReturnValue(false);
    client.emitInBatchBounded.mockImplementation((message) => {
        client.emitInBatch(message);
        return true;
    });
    sockets.push(client);
    return client;
}
async function enter(client: PusherWebSocket): Promise<boolean> {
    await play.restoreModeratedRoom(client);
    return play.joinModeratedRoom(client, (member) => play.leaveModeratedRoom(member));
}
function command(client: PusherWebSocket, input: object) {
    play.handleRoomChat(client, {
        spaceName: "class.quantaRoomChat",
        spaceEvent: {
            event: {
                $case: "spaceMessage",
                spaceMessage: { message: JSON.stringify(input), name: "", characterTextures: [] },
            },
        },
    });
}
/** The messages of the last snapshot the client was sent. */
function history(client: ReturnType<typeof socket>): string[] | undefined {
    for (const [message] of [...client.emitInBatch.mock.calls].reverse()) {
        if (message.message?.$case !== "publicEvent") continue;
        const event = message.message.publicEvent.spaceEvent?.event;
        if (event?.$case !== "spaceMessage") continue;
        const update = JSON.parse(event.spaceMessage.message) as { messages?: { body: string }[] };
        if (update.messages) return update.messages.map((entry) => entry.body);
    }
    return undefined;
}
const flush = () =>
    new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
const SYNC = { op: "sync" };

beforeEach(async () => {
    redis.strings.clear();
    redis.lists.clear();
    redis.sets.clear();
    redis.ttls.clear();
    redis.expiry.clear();
    Object.assign(redis.control, {
        readGate: undefined,
        failChatReads: false,
        failWrites: false,
        offline: false,
        queued: [],
    });
    vi.clearAllMocks();
    // The first import of play loads its whole module graph: slow on a busy machine.
    await restartPlay();
}, 30_000);

it("gives a late joiner and a reloaded tab the class chat so far", async () => {
    const teacher = socket("teacher", true);
    await enter(teacher);
    command(teacher, { op: "send", body: "open https://example.test/task" });
    command(teacher, { op: "send", body: "start with question 1" });
    // The teacher reloads: a new socket, the old one gone.
    play.leaveModeratedRoom(teacher);
    const reloaded = socket("teacher", true);
    await enter(reloaded);
    command(reloaded, SYNC);
    expect(history(reloaded)).toEqual(["open https://example.test/task", "start with question 1"]);
    const late = socket("late");
    await enter(late);
    command(late, SYNC);
    expect(history(late)).toEqual(["open https://example.test/task", "start with question 1"]);
});

it("keeps the class chat across a play restart, the reconnect a deploy forces on everyone", async () => {
    const teacher = socket("teacher", true),
        student = socket("student");
    await enter(teacher);
    await enter(student);
    command(teacher, { op: "send", body: "read page 4" });
    command(student, { op: "send", body: "ok" });
    command(student, { op: "send", body: "typo" });
    command(student, { op: "delete", id: play.roomSessions.get("class").messages.at(-1)?.id });
    await flush();
    // Refreshed while the room is occupied: a room nobody returns to doesn't show it tomorrow.
    expect(redis.ttls.get(CHAT_KEY)).toBe(ROOM_CHAT_TTL + 5 * 60 * 1000);

    await restartPlay();
    const back = socket("student");
    await enter(back);
    command(back, SYNC);
    expect(history(back)).toEqual(["read page 4", "ok"]);
    // New messages follow the restored ones, never reusing their ids.
    command(back, { op: "send", body: "done" });
    const ids = play.roomSessions.get("class").messages.map((message) => Number(message.id));
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(3);
});

it("keeps an edit across a play restart, and a deletion after it still removes the message", async () => {
    const teacher = socket("teacher", true);
    await enter(teacher);
    command(teacher, { op: "send", body: "question 1" });
    command(teacher, { op: "send", body: "qestion 2" });
    await flush();
    const [, second] = redis.lists.get(CHAT_KEY)!.map((entry) => JSON.parse(entry) as { id: string });
    command(teacher, { op: "edit", id: second.id, body: "question 2" });
    await flush();

    await restartPlay();
    const back = socket("teacher", true);
    await enter(back);
    command(back, SYNC);
    expect(history(back)).toEqual(["question 1", "question 2"]);
    expect(redis.lists.get(CHAT_KEY)!.map((entry) => JSON.parse(entry) as { edited?: true })[1].edited).toBe(true);

    command(back, { op: "delete", id: second.id });
    await flush();
    await restartPlay();
    const again = socket("teacher", true);
    await enter(again);
    command(again, SYNC);
    expect(history(again)).toEqual(["question 1"]);
    expect(redis.lists.get(CHAT_KEY)).toHaveLength(1);
});

it("sends the history to whoever joined while a slow Redis was still being read", async () => {
    const teacher = socket("teacher", true);
    await enter(teacher);
    command(teacher, { op: "send", body: "before the restart" });
    await flush();
    await restartPlay();
    let answer!: () => void;
    redis.control.readGate = new Promise((resolve) => {
        answer = resolve;
    });
    vi.useFakeTimers();
    const student = socket("student");
    const entering = enter(student);
    await vi.advanceTimersByTimeAsync(1000);
    await entering;
    vi.useRealTimers();
    command(student, SYNC);
    expect(history(student)).toEqual([]);
    answer();
    await flush();
    await flush();
    expect(history(student)).toEqual(["before the restart"]);
});

it("keeps the last 100 messages", async () => {
    vi.useFakeTimers();
    const teacher = socket("teacher", true);
    await enter(teacher);
    // A teacher's 60 commands per 10 s, in batches Redis answers between.
    /* eslint-disable no-await-in-loop */
    for (let i = 0; i < 150; i++) {
        if (i % 50 === 0) {
            await vi.advanceTimersByTimeAsync(0);
            vi.advanceTimersByTime(10_000);
        }
        command(teacher, { op: "send", body: String(i) });
    }
    /* eslint-enable no-await-in-loop */
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(10_000);
    expect(redis.lists.get(CHAT_KEY)).toHaveLength(ROOM_HISTORY_LIMIT);
    command(teacher, SYNC);
    expect(history(teacher)).toHaveLength(100);
    expect(history(teacher)?.[0]).toBe("50");
    vi.useRealTimers();
    await restartPlay();
    const back = socket("teacher", true);
    await enter(back);
    command(back, SYNC);
    expect(history(back)).toHaveLength(100);
    expect(history(back)?.[0]).toBe("50");
});

it("merges a restored history with messages sent before it arrived, without bringing back deleted ones", () => {
    const session = new RoomSession();
    const teacher = { id: "teacher", name: "Teacher", staff: true };
    const kept = { id: "100", sender: "teacher", name: "Teacher", body: "kept", at: 1 };
    const deleted = { id: "101", sender: "teacher", name: "Teacher", body: "deleted", at: 2 };
    session.send(teacher, "after");
    session.messages.unshift(deleted);
    session.delete(teacher, "101");
    expect(session.restoreMessages([kept, deleted])).toBe(true);
    expect(session.messages.map((message) => message.body)).toEqual(["kept", "after"]);
    expect(session.restoreMessages([kept])).toBe(false);
});

it("keeps every snapshot of the history far inside a connection's queue, whatever the messages hold", async () => {
    vi.useFakeTimers();
    const student = socket("student"),
        teacher = socket("teacher", true);
    await enter(student);
    await enter(teacher);
    // Invisible control characters cost six bytes each once escaped: they are not part of a message.
    command(student, { op: "send", body: "\u0001".repeat(4000) });
    expect(play.roomSessions.get("class").messages).toHaveLength(0);
    command(student, { op: "send", body: "\u0001ok\u0002" });
    expect(play.roomSessions.get("class").messages.at(-1)?.body).toBe("ok");
    // CJK text is three bytes a character: 100 messages at the limit would make a 1.2 MB snapshot.
    /* eslint-disable no-await-in-loop */
    for (let i = 0; i < 100; i++) {
        if (i % 50 === 0) {
            await vi.advanceTimersByTimeAsync(0);
            vi.advanceTimersByTime(10_000);
        }
        command(teacher, { op: "send", body: `${i}${"\u4e2d".repeat(3990)}` });
    }
    /* eslint-enable no-await-in-loop */
    vi.advanceTimersByTime(10_000);
    const late = socket("late");
    await enter(late);
    late.emitInBatch.mockClear();
    command(late, SYNC);
    const [[sent]] = late.emitInBatch.mock.calls;
    const event = sent.message?.$case === "publicEvent" ? sent.message.publicEvent.spaceEvent?.event : undefined;
    const wire = event?.$case === "spaceMessage" ? event.spaceMessage.message : "";
    // The history is at most 1 MiB; the rest of the 4 MiB queue stays free for everything else.
    expect(new TextEncoder().encode(wire).length).toBeLessThan(1.1 * 1024 * 1024);
    expect(history(late)?.at(-1)?.startsWith("99")).toBe(true);
    expect(history(late)?.length).toBeLessThan(100);
    expect(late.end.mock.calls).toHaveLength(0);
    vi.useRealTimers();
});

it("keeps a deleted message out of the history a restart restores, also when Redis failed the deletion at first", async () => {
    vi.useFakeTimers();
    const teacher = socket("teacher", true);
    await enter(teacher);
    command(teacher, { op: "send", body: "wrong link" });
    command(teacher, { op: "send", body: "right link" });
    await vi.advanceTimersByTimeAsync(0);
    redis.control.failWrites = true;
    command(teacher, { op: "delete", id: play.roomSessions.get("class").messages[0].id });
    await vi.advanceTimersByTimeAsync(0);
    redis.control.failWrites = false;
    await vi.advanceTimersByTimeAsync(60_000);
    vi.useRealTimers();
    await restartPlay();
    const back = socket("teacher", true);
    await enter(back);
    command(back, SYNC);
    expect(history(back)).toEqual(["right link"]);
});

it("drops chat writes queued while Redis was away instead of bringing back a history that has lapsed", async () => {
    vi.useFakeTimers();
    const store = await import("../../src/pusher/quanta/moderationStore");
    redis.control.offline = true;
    const before = redis.client.eval.mock.calls.length + redis.client.multi.mock.calls.length;
    for (let i = 0; i < 300; i++)
        store.appendRoomChat("class", { id: String(i), sender: "s", name: "s", body: String(i), at: i }, 60_000, 0);
    // The history lapses long before Redis comes back.
    await vi.advanceTimersByTimeAsync(ROOM_CHAT_TTL + 60 * 1000);
    redis.reconnect();
    await vi.advanceTimersByTimeAsync(0);
    expect(redis.lists.get(CHAT_KEY) ?? []).toHaveLength(0);
    const issued = redis.client.eval.mock.calls.length + redis.client.multi.mock.calls.length - before;
    expect(issued).toBeLessThanOrEqual(64);
    vi.useRealTimers();
});

it("restores saved removals and mutes even when the history can't be read", async () => {
    redis.strings.set(
        "quanta:room-moderation:class",
        JSON.stringify({ removed: [{ id: "removed", name: "removed", staff: false }], muted: ["muted"] }),
    );
    redis.control.failChatReads = true;
    expect(await enter(socket("removed"))).toBe(false);
    const muted = socket("muted");
    await enter(muted);
    command(muted, { op: "send", body: "spam" });
    expect(play.roomSessions.get("class").messages).toHaveLength(0);
});

it("never lengthens the history's life with a deletion retried after everyone left", async () => {
    vi.useFakeTimers();
    const teacher = socket("teacher", true);
    await enter(teacher);
    command(teacher, { op: "send", body: "keep" });
    command(teacher, { op: "send", body: "remove" });
    await vi.advanceTimersByTimeAsync(0);
    redis.control.failWrites = true;
    command(teacher, { op: "delete", id: play.roomSessions.get("class").messages[1].id });
    await vi.advanceTimersByTimeAsync(0);
    redis.control.failWrites = false;
    play.leaveModeratedRoom(teacher);
    await vi.advanceTimersByTimeAsync(0);
    expect(redis.pttl(CHAT_KEY)).toBe(ROOM_CHAT_TTL);
    // The retry lands after everyone left.
    await vi.advanceTimersByTimeAsync(2000);
    expect(redis.lists.get(CHAT_KEY)).toHaveLength(1);
    expect(redis.pttl(CHAT_KEY)).toBeLessThanOrEqual(ROOM_CHAT_TTL - 2000);
    vi.useRealTimers();
});

it("doesn't restore a history whose room has been empty longer than its TTL, even if its expiry was lost", async () => {
    vi.useFakeTimers();
    const teacher = socket("teacher", true);
    await enter(teacher);
    command(teacher, { op: "send", body: "yesterday's class" });
    await vi.advanceTimersByTimeAsync(0);
    // The last one out: Redis misses the shorter expiry, so the history keeps an occupied room's.
    redis.control.failWrites = true;
    play.leaveModeratedRoom(teacher);
    await vi.advanceTimersByTimeAsync(0);
    redis.control.failWrites = false;
    await vi.advanceTimersByTimeAsync(ROOM_CHAT_TTL + 60 * 1000);
    expect(redis.lists.get(CHAT_KEY)).toHaveLength(1);
    await restartPlay();
    const next = socket("teacher", true);
    await enter(next);
    command(next, SYNC);
    expect(history(next)).toEqual([]);
    // Today's class goes on, and play restarts once more: only today's chat comes back.
    command(next, { op: "send", body: "today's class" });
    await vi.advanceTimersByTimeAsync(0);
    await restartPlay();
    const again = socket("teacher", true);
    await enter(again);
    command(again, SYNC);
    expect(history(again)).toEqual(["today's class"]);
    vi.useRealTimers();
});

it("keeps deleted ids only while the messages they name could still be restored", async () => {
    vi.useFakeTimers();
    const teacher = socket("teacher", true);
    await enter(teacher);
    command(teacher, { op: "send", body: "mistake" });
    await vi.advanceTimersByTimeAsync(0);
    command(teacher, { op: "delete", id: play.roomSessions.get("class").messages[0].id });
    await vi.advanceTimersByTimeAsync(0);
    expect(redis.sets.get(TOMBSTONES)?.size).toBe(1);
    command(teacher, { op: "send", body: "next" });
    await vi.advanceTimersByTimeAsync(0);
    // Every message kept is newer than the deleted one: its id can't matter any more.
    expect(redis.sets.get(TOMBSTONES)?.size ?? 0).toBe(0);
    vi.useRealTimers();
});

it("keeps no more deleted ids than the history holds, while an old message stays", async () => {
    vi.useFakeTimers();
    const teacher = socket("teacher", true);
    await enter(teacher);
    command(teacher, { op: "send", body: "pinned instructions" });
    // Each send and delete is two of a teacher's 60 commands per 10 s.
    /* eslint-disable no-await-in-loop */
    for (let i = 0; i < 150; i++) {
        if (i % 25 === 0) {
            await vi.advanceTimersByTimeAsync(0);
            vi.advanceTimersByTime(10_000);
        }
        command(teacher, { op: "send", body: `oops ${i}` });
        command(teacher, { op: "delete", id: play.roomSessions.get("class").messages.at(-1)?.id });
    }
    /* eslint-enable no-await-in-loop */
    await vi.advanceTimersByTimeAsync(0);
    expect(redis.lists.get(CHAT_KEY)).toHaveLength(1);
    // Whatever the key, the deleted ids saved for this room.
    const kept = [...redis.sets].filter(([key]) => key.startsWith("quanta:room-chat-") && key.endsWith(":class"));
    expect(kept.reduce((count, [, ids]) => count + ids.size, 0)).toBeLessThanOrEqual(ROOM_HISTORY_LIMIT);
    vi.useRealTimers();
});

it("keeps a live class's history when Redis missed its writes for longer than its TTL", async () => {
    vi.useFakeTimers();
    const teacher = socket("teacher", true);
    await enter(teacher);
    command(teacher, { op: "send", body: "before the outage" });
    await vi.advanceTimersByTimeAsync(0);
    // The class stays; Redis takes none of its writes for longer than the history's TTL.
    redis.control.failWrites = true;
    await vi.advanceTimersByTimeAsync(ROOM_CHAT_TTL + 60 * 1000);
    redis.control.failWrites = false;
    command(teacher, { op: "send", body: "after the outage" });
    await vi.advanceTimersByTimeAsync(0);
    await restartPlay();
    const back = socket("teacher", true);
    await enter(back);
    command(back, SYNC);
    expect(history(back)).toEqual(["before the outage", "after the outage"]);
    vi.useRealTimers();
});
