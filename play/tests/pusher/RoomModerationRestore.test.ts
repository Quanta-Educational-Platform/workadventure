import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import { JoinRoomFrontMessage } from "@workadventure/messages";
import type { BackConnection, SocketData } from "../../src/pusher/models/Websocket/SocketData";
import type { PusherWebSocket } from "../../src/pusher/services/PusherWebSocket";
import type { PusherRoom } from "../../src/pusher/models/PusherRoom";
import type * as RoomModeration from "../../src/pusher/quanta/roomModeration";

const redis = vi.hoisted(() => {
    const data = new Map<string, { value: string; ttl: number }>();
    const control: { available: boolean; readGate?: Promise<void> } = { available: true };
    const client = {
        // Redis answers what the key held when the command arrived, however late the reply.
        get: vi.fn(async (key: string) => {
            const value = data.get(key)?.value ?? null;
            await control.readGate;
            return value;
        }),
        set: vi.fn((key: string, value: string, options: { expiration: { type: string; value: number } }) => {
            data.set(key, { value, ttl: options.expiration.value });
            return Promise.resolve("OK");
        }),
        // The class chat's history (RoomChatHistory.test.ts covers it): none saved here.
        lRange: vi.fn(() => Promise.resolve([])),
        sMembers: vi.fn(() => Promise.resolve([])),
        eval: vi.fn(() => Promise.resolve(1)),
        lRem: vi.fn(() => Promise.resolve(0)),
        multi: vi.fn(() => {
            const chain = {
                rPush: () => chain,
                lTrim: () => chain,
                pExpire: () => chain,
                exec: () => Promise.resolve([]),
            };
            return chain;
        }),
        pExpire: vi.fn((key: string, ttl: number) => {
            const entry = data.get(key);
            if (entry) entry.ttl = ttl;
            return Promise.resolve(entry ? 1 : 0);
        }),
    };
    // A Redis that never answers: node-redis keeps reconnecting instead of failing.
    const connect = () => (control.available ? Promise.resolve(client) : new Promise<never>(() => {}));
    return { data, control, client, connect };
});
vi.mock("../../src/pusher/services/RedisClient", () => ({ getRedisClient: () => redis.connect() }));
vi.mock("../../src/pusher/enums/EnvironmentVariable", async () => {
    const env = await import("./mocks/pusherEnvironmentVariableMock");
    return { ...env, FRONT_ENVIRONMENT_VARIABLES: { ...env.FRONT_ENVIRONMENT_VARIABLES, QUANTA_UI: true } };
});

let play: typeof RoomModeration;
const sockets: PusherWebSocket[] = [];
const KEY = "quanta:room-moderation:class";
const DAY = 24 * 60 * 60 * 1000;
const HALF_HOUR = 30 * 60 * 1000;

function disconnectAll(): void {
    for (const client of sockets.splice(0)) play?.leaveModeratedRoom(client);
}
/** A fresh play process: in-memory sessions are gone, Redis keeps what was written. */
async function restartPlay(): Promise<void> {
    disconnectAll();
    vi.resetModules();
    play = await import("../../src/pusher/quanta/roomModeration");
}
function socket(id: string, staff = false, world = "class") {
    const client = mock<PusherWebSocket>();
    const data = mock<SocketData>({
        userUuid: id,
        name: id,
        tags: staff ? ["admin"] : [],
        roomId: `https://play.test/${world}`,
        world,
        quantaPublicName: id,
    });
    data.spaces = new Set([`${world}.quantaRoomChat`]);
    client.getUserData.mockReturnValue(data);
    let closed = false;
    client.isDisconnecting.mockImplementation(() => closed);
    client.end.mockImplementation(() => {
        closed = true;
    });
    client.emitInBatchBounded.mockImplementation((message) => {
        client.emitInBatch(message);
        return true;
    });
    sockets.push(client);
    return client;
}
// The admission SocketManager.handleJoinRoom performs.
async function enter(client: PusherWebSocket): Promise<boolean> {
    await play.restoreModeratedRoom(client);
    return play.joinModeratedRoom(client, (member, code, reason) => {
        play.leaveModeratedRoom(member);
        member.end(code, reason);
    });
}
function command(client: PusherWebSocket, input: object) {
    return play.handleRoomChat(client, {
        spaceName: `${client.getUserData().world}.quantaRoomChat`,
        spaceEvent: {
            event: {
                $case: "spaceMessage",
                spaceMessage: { message: JSON.stringify(input), name: "", characterTextures: [] },
            },
        },
    });
}
const flush = () =>
    new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
function redisComesBack(): void {
    redis.control.available = true;
}
/** Holds Redis replies until the returned function is called. */
function holdReads(): () => void {
    let answer!: () => void;
    redis.control.readGate = new Promise((resolve) => {
        answer = resolve;
    });
    return answer;
}
// The chat's history is read alongside, with its own key: these count the saved decisions' reads.
const moderationReads = () => redis.client.get.mock.calls.filter(([key]) => key === KEY);
const saved = () => JSON.parse(redis.data.get(KEY)?.value ?? "null") as { removed: { id: string }[]; muted: string[] };

beforeEach(async () => {
    redis.data.clear();
    redis.control.available = true;
    redis.control.readGate = undefined;
    vi.clearAllMocks();
    await restartPlay();
});
afterEach(() => {
    disconnectAll();
    vi.useRealTimers();
});

describe("room moderation across a play restart", () => {
    it("keeps a removed student out and a chat-muted student muted", async () => {
        const teacher = socket("teacher", true);
        const removed = socket("removed");
        const muted = socket("muted");
        expect(await Promise.all([teacher, removed, muted].map(enter))).toEqual([true, true, true]);
        command(teacher, { op: "moderate", action: "remove", id: "removed" });
        command(teacher, { op: "moderate", action: "mute_chat", id: "muted" });
        await flush();
        expect(saved()).toEqual({ removed: [{ id: "removed", name: "removed", staff: false }], muted: ["muted"] });
        expect(redis.data.get(KEY)?.ttl).toBe(DAY);

        await restartPlay();
        const teacherAgain = socket("teacher", true);
        const removedAgain = socket("removed");
        const mutedAgain = socket("muted");
        expect(await enter(teacherAgain)).toBe(true);
        expect(await enter(removedAgain)).toBe(false);
        expect(removedAgain.end.mock.calls.length).toBeGreaterThan(0);
        expect(await enter(mutedAgain)).toBe(true);
        command(mutedAgain, { op: "send", body: "after restart" });
        expect(play.roomSessions.get("class").messages).toHaveLength(0);
        expect(JSON.stringify(mutedAgain.emitInBatch.mock.calls)).toContain("muted by the teacher");

        command(teacherAgain, { op: "moderate", action: "allow_back", id: "removed" });
        command(teacherAgain, { op: "moderate", action: "unmute_chat", id: "muted" });
        await flush();
        expect(saved()).toEqual({ removed: [], muted: [] });
        await restartPlay();
        expect(await enter(socket("removed"))).toBe(true);
    });

    it("reads Redis once per room session", async () => {
        await Promise.all(["a", "b", "c"].map((id) => enter(socket(id))));
        expect(moderationReads()).toHaveLength(1);
    });

    it("admits on memory alone when Redis never answers, and moderation still works", async () => {
        vi.useFakeTimers();
        redis.control.available = false;
        const teacher = socket("teacher", true);
        const student = socket("student");
        const admitted = enter(teacher);
        await vi.advanceTimersByTimeAsync(play.RESTORE_JOIN_WAIT_MS);
        expect(await admitted).toBe(true);
        expect(await enter(student)).toBe(true);
        expect(() => command(teacher, { op: "moderate", action: "remove", id: "student" })).not.toThrow();
        expect(student.end.mock.calls.length).toBeGreaterThan(0);
        const retry = socket("student");
        expect(await enter(retry)).toBe(false);
        // The timed-out read and the writes give up without an unhandled rejection.
        await vi.advanceTimersByTimeAsync(60_000);
    });

    it("applies a slow read to people who joined meanwhile, without undoing a newer decision", async () => {
        redis.data.set(KEY, {
            value: JSON.stringify({
                removed: [{ id: "late", name: "late", staff: false }],
                muted: ["quiet"],
            }),
            ttl: DAY,
        });
        const answer = holdReads();
        vi.useFakeTimers();
        const teacher = socket("teacher", true);
        const late = socket("late");
        const quiet = socket("quiet");
        const newcomer = socket("newcomer");
        const admitted = Promise.all([teacher, late, quiet, newcomer].map(enter));
        await vi.advanceTimersByTimeAsync(play.RESTORE_JOIN_WAIT_MS);
        expect(await admitted).toEqual([true, true, true, true]);
        command(teacher, { op: "moderate", action: "unmute_chat", id: "quiet" });
        command(teacher, { op: "moderate", action: "mute_chat", id: "newcomer" });
        vi.useRealTimers();
        answer();
        await flush();
        await flush();
        expect(late.end.mock.calls.length).toBeGreaterThan(0);
        const session = play.roomSessions.get("class");
        expect([...session.removed.keys()]).toEqual(["late"]);
        expect([...session.muted]).toEqual(["newcomer"]);
        expect(saved()).toEqual({ removed: [{ id: "late", name: "late", staff: false }], muted: ["newcomer"] });
        expect(quiet.end.mock.calls).toHaveLength(0);
    });

    it("keeps a saved removal whatever is decided about the person's chat meanwhile, and vice versa", async () => {
        redis.data.set(KEY, {
            value: JSON.stringify({ removed: [{ id: "removed", name: "removed", staff: false }], muted: ["muted"] }),
            ttl: DAY,
        });
        const answer = holdReads();
        vi.useFakeTimers();
        const teacher = socket("teacher", true);
        const removed = socket("removed");
        const muted = socket("muted");
        const admitted = Promise.all([teacher, removed, muted].map(enter));
        await vi.advanceTimersByTimeAsync(play.RESTORE_JOIN_WAIT_MS);
        expect(await admitted).toEqual([true, true, true]);
        command(teacher, { op: "moderate", action: "mute_chat", id: "removed" });
        command(teacher, { op: "moderate", action: "unmute_chat", id: "removed" });
        command(teacher, { op: "moderate", action: "remove", id: "muted" });
        command(teacher, { op: "moderate", action: "allow_back", id: "muted" });
        vi.useRealTimers();
        answer();
        await flush();
        await flush();
        expect(removed.end.mock.calls.length).toBeGreaterThan(0);
        const session = play.roomSessions.get("class");
        expect([...session.removed.keys()]).toEqual(["removed"]);
        expect([...session.muted]).toEqual(["muted"]);
        expect(await enter(socket("removed"))).toBe(false);
    });

    it("asks Redis again after a failed read, on a later join and without holding it, and applies what it says", async () => {
        redis.data.set(KEY, {
            value: JSON.stringify({ removed: [{ id: "removed", name: "removed", staff: false }], muted: [] }),
            ttl: DAY,
        });
        vi.useFakeTimers();
        redis.control.available = false;
        const teacher = socket("teacher", true);
        const removed = socket("removed");
        const admitted = Promise.all([teacher, removed].map(enter));
        await vi.advanceTimersByTimeAsync(play.RESTORE_JOIN_WAIT_MS);
        expect(await admitted).toEqual([true, true]);
        command(teacher, { op: "moderate", action: "mute_chat", id: "removed" });
        // The read gives up; Redis comes back, but nothing asks before the backoff ends.
        await vi.advanceTimersByTimeAsync(10_000);
        redisComesBack();
        expect(await enter(socket("early"))).toBe(true);
        expect(moderationReads()).toHaveLength(0);
        expect(removed.end.mock.calls).toHaveLength(0);

        await vi.advanceTimersByTimeAsync(play.RESTORE_RETRY_MIN_MS);
        teacher.emitInBatch.mockClear();
        // This join doesn't wait for the retry: it is admitted before any timer runs.
        expect(await enter(socket("later"))).toBe(true);
        await vi.advanceTimersByTimeAsync(0);
        expect(moderationReads()).toHaveLength(1);
        expect(removed.end.mock.calls.length).toBeGreaterThan(0);
        expect(JSON.stringify(teacher.emitInBatch.mock.calls)).toContain('\\"removed\\":[{\\"id\\":\\"removed\\"');
        // The mute decided while Redis was away is saved now, next to the saved removal.
        expect(saved()).toEqual({ removed: [{ id: "removed", name: "removed", staff: false }], muted: ["removed"] });
        expect(await enter(socket("removed"))).toBe(false);
    });

    it("backs off between failed reads, up to a bound", async () => {
        vi.useFakeTimers();
        redis.control.available = false;
        const first = enter(socket("a"));
        await vi.advanceTimersByTimeAsync(play.RESTORE_JOIN_WAIT_MS);
        await first;
        let reads = 1;
        await vi.advanceTimersByTimeAsync(10_000 - play.RESTORE_JOIN_WAIT_MS);
        const connect = vi.spyOn(redis, "connect");
        // A read asks for the saved moderation and the saved chat together.
        const readsMade = () => connect.mock.calls.length / 2;
        // Each read depends on the clock the previous one left.
        /* eslint-disable no-await-in-loop */
        for (const wait of [2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000]) {
            await vi.advanceTimersByTimeAsync(wait - 1);
            await enter(socket("b"));
            expect(readsMade()).toBe(reads - 1);
            await vi.advanceTimersByTimeAsync(1);
            await enter(socket("b"));
            expect(readsMade()).toBe(reads);
            reads++;
            // The retry itself gives up after the read timeout.
            await vi.advanceTimersByTimeAsync(10_000);
        }
        /* eslint-enable no-await-in-loop */
        expect(play.RESTORE_RETRY_MAX_MS).toBe(60_000);
    });

    it("lets go of chat mutes once the room stays empty, and expires removals with the session", async () => {
        vi.useFakeTimers();
        const teacher = socket("teacher", true);
        const student = socket("student");
        const other = socket("other");
        await Promise.all([teacher, student, other].map(enter));
        command(teacher, { op: "moderate", action: "mute_chat", id: "student" });
        command(teacher, { op: "moderate", action: "remove", id: "other" });
        for (const client of [teacher, student]) play.leaveModeratedRoom(client);
        await vi.advanceTimersByTimeAsync(0);
        expect(redis.data.get(KEY)?.ttl).toBe(HALF_HOUR);
        expect(saved().muted).toEqual(["student"]);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(saved()).toEqual({ removed: [{ id: "other", name: "other", staff: false }], muted: [] });
        expect(redis.data.get(KEY)?.ttl).toBe(HALF_HOUR);
        await enter(socket("teacher", true));
        await vi.advanceTimersByTimeAsync(0);
        expect(redis.data.get(KEY)?.ttl).toBe(DAY);
    });

    it("keeps chat mutes when play restarts before the empty-room grace ends", async () => {
        const teacher = socket("teacher", true);
        const student = socket("student");
        await enter(teacher);
        await enter(student);
        command(teacher, { op: "moderate", action: "mute_chat", id: "student" });
        await restartPlay();
        await flush();
        expect(saved().muted).toEqual(["student"]);
        const back = socket("student");
        await enter(back);
        expect(play.roomSessions.get("class").muted.has("student")).toBe(true);
    });

    it("ignores a saved value it cannot read", async () => {
        redis.data.set(KEY, { value: "{not json", ttl: DAY });
        expect(await enter(socket("student"))).toBe(true);
        redis.data.set(KEY, { value: JSON.stringify({ removed: [{ id: 1 }], muted: [2] }), ttl: DAY });
        await restartPlay();
        expect(await enter(socket("student"))).toBe(true);
        expect(play.roomSessions.get("class").removed.size).toBe(0);
    });
});

it("handleJoinRoom refuses a student removed before the restart and never registers a socket closed while waiting", async () => {
    redis.data.set(KEY, {
        value: JSON.stringify({ removed: [{ id: "student", name: "student", staff: false }], muted: [] }),
        ttl: DAY,
    });
    const join = async (client: PusherWebSocket) => {
        // Imported per call so it shares the current process's room moderation.
        const { SocketManager } = await import("../../src/pusher/services/SocketManager");
        const manager = new SocketManager();
        vi.spyOn(manager, "getOrCreateRoom").mockResolvedValue(mock<PusherRoom>());
        await manager.handleJoinRoom(
            client,
            JoinRoomFrontMessage.fromPartial({ positionMessage: {}, viewportMessage: {} }),
        );
    };
    const student = socket("student");
    const studentBack = mock<BackConnection>();
    student.getUserData().backConnection = studentBack;
    await join(student);
    expect(student.end.mock.calls.length).toBeGreaterThan(0);
    expect(studentBack.write.mock.calls).toHaveLength(0);

    const answer = holdReads();
    const leaving = socket("leaving", false, "other");
    const leavingBack = mock<BackConnection>();
    leaving.getUserData().backConnection = leavingBack;
    const joining = join(leaving);
    leaving.isPermanentlyDisconnected.mockReturnValue(true);
    answer();
    await joining;
    expect(leavingBack.write.mock.calls).toHaveLength(0);
    const teacher = socket("teacher", true, "other");
    await enter(teacher);
    command(teacher, { op: "sync" });
    expect(JSON.stringify(teacher.emitInBatch.mock.calls)).not.toContain('"id":"leaving"');
});
