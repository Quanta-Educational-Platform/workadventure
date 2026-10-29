import { afterEach, describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import type { SocketData } from "../../src/pusher/models/Websocket/SocketData";
import type { PusherWebSocket } from "../../src/pusher/services/PusherWebSocket";
import {
    handleRoomChat,
    joinModeratedRoom as admit,
    leaveModeratedRoom,
    roomSessions,
    ROOM_CHAT_QUEUE_BYTES,
} from "../../src/pusher/quanta/roomModeration";
const sockets: PusherWebSocket[] = [];
function socket(id: string, staff = false, room = "test") {
    const client = mock<PusherWebSocket>();
    const data = mock<SocketData>({
        userUuid: id,
        name: id,
        tags: staff ? ["admin"] : [],
        roomId: room,
        world: room,
        quantaPublicName: id,
    });
    data.spaces = new Set([`${room}.quantaRoomChat`]);
    client.getUserData.mockReturnValue(data);
    client.emitInBatchBounded.mockImplementation((message) => {
        client.emitInBatch(message);
        return true;
    });
    sockets.push(client);
    return client;
}
function joinModeratedRoom(client: PusherWebSocket) {
    return admit(client, (socket, code, reason) => {
        leaveModeratedRoom(socket);
        socket.end(code, reason);
    });
}
function command(client: PusherWebSocket, input: object) {
    return handleRoomChat(client, {
        spaceName: `${client.getUserData().world}.quantaRoomChat`,
        spaceEvent: {
            event: {
                $case: "spaceMessage",
                spaceMessage: { message: JSON.stringify(input), name: "spoofed", characterTextures: [] },
            },
        },
    });
}
afterEach(() => {
    for (const client of sockets.splice(0)) leaveModeratedRoom(client);
    vi.useRealTimers();
});
describe("room chat transport", () => {
    it("enforces staff permissions, removes every connection and blocks reconnect until allowed back", () => {
        const teacher = socket("teacher", true),
            student = socket("student"),
            secondTab = socket("student"),
            otherStaff = socket("staff", true);
        for (const client of [teacher, student, secondTab, otherStaff]) expect(joinModeratedRoom(client)).toBe(true);
        command(student, { op: "moderate", action: "remove", id: "teacher" });
        expect(teacher.end.mock.calls).toHaveLength(0);
        command(teacher, { op: "moderate", action: "remove", id: "staff" });
        expect(otherStaff.end.mock.calls).toHaveLength(0);
        command(teacher, { op: "moderate", action: "mute_mic", id: "student" });
        expect(student.emitInBatch.mock.calls.flat()).toContainEqual(
            expect.objectContaining({
                message: expect.objectContaining({
                    $case: "privateEvent",
                    privateEvent: expect.objectContaining({
                        spaceEvent: { event: { $case: "muteAudio", muteAudio: { force: true } } },
                    }),
                }),
            }),
        );
        command(teacher, { op: "moderate", action: "remove", id: "student" });
        expect(student.end.mock.calls.length).toBeGreaterThan(0);
        expect(secondTab.end.mock.calls.length).toBeGreaterThan(0);
        const retry = socket("student");
        expect(joinModeratedRoom(retry)).toBe(false);
        command(teacher, { op: "moderate", action: "allow_back", id: "student" });
        expect(joinModeratedRoom(retry)).toBe(true);
    });
    it("replays server names and rejects delete and mute bypass attempts", () => {
        const student = socket("writer", false, "history"),
            other = socket("other", false, "history"),
            teacher = socket("teacher", true, "history");
        for (const client of [student, other, teacher]) joinModeratedRoom(client);
        command(student, { op: "send", body: "help" });
        command(other, { op: "delete", id: "1" });
        const late = socket("late", false, "history");
        joinModeratedRoom(late);
        command(late, { op: "sync" });
        expect(JSON.stringify(late.emitInBatch.mock.calls)).toContain("help");
        expect(JSON.stringify(late.emitInBatch.mock.calls)).not.toContain("spoofed");
        command(teacher, { op: "delete", id: "1" });
        late.emitInBatch.mockClear();
        expect(JSON.stringify(late.emitInBatch.mock.calls)).not.toContain("help");
        command(teacher, { op: "moderate", action: "mute_chat", id: "writer" });
        command(student, { op: "send", body: "spam" });
        late.emitInBatch.mockClear();
        command(late, { op: "sync" });
        expect(JSON.stringify(late.emitInBatch.mock.calls)).not.toContain("spam");
    });
});

it("shares mute and removal across alternate URL spellings of the trusted world", () => {
    const teacher = socket("teacher", true, "canonical"),
        student = socket("student", false, "canonical");
    joinModeratedRoom(teacher);
    joinModeratedRoom(student);
    command(teacher, { op: "moderate", action: "mute_chat", id: "student" });
    const alternate = socket("student", false, "canonical");
    alternate.getUserData().roomId = "https://other-spelling.test/room/?ignored=1";
    joinModeratedRoom(alternate);
    command(alternate, { op: "send", body: "bypass" });
    expect(roomSessions.get("canonical").messages).toHaveLength(0);
    expect(JSON.stringify(alternate.emitInBatch.mock.calls)).not.toContain("bypass");
    command(teacher, { op: "moderate", action: "remove", id: "student" });
    const retry = socket("student", false, "canonical");
    retry.getUserData().roomId = "https://play.test/room/";
    expect(joinModeratedRoom(retry)).toBe(false);
});
it("never replays a client-supplied full name, including after the client changes it", () => {
    const student = socket("writer", false, "privacy"),
        teacher = socket("teacher", true, "privacy");
    student.getUserData().name = "Private Full Name";
    student.getUserData().quantaPublicName = "public_username";
    joinModeratedRoom(student);
    joinModeratedRoom(teacher);
    command(student, { op: "send", body: "help" });
    command(teacher, { op: "sync" });
    const replay = JSON.stringify(teacher.emitInBatch.mock.calls);
    expect(replay).toContain("public_username");
    expect(replay).not.toContain("Private Full Name");
});
it("does not amplify no-op deletes or invalid commands into history and shares rate limits across tabs", () => {
    vi.useFakeTimers();
    const student = socket("student", false, "limits"),
        teacher = socket("teacher", true, "limits");
    joinModeratedRoom(student);
    joinModeratedRoom(teacher);
    const session = roomSessions.get("limits");
    for (let i = 0; i < 100; i++) session.send({ id: "student", name: "student", staff: false }, "x".repeat(4000));
    student.emitInBatch.mockClear();
    teacher.emitInBatch.mockClear();
    for (let i = 0; i < 5; i++) {
        command(student, { op: "delete", id: "missing" });
        command(student, { op: "bogus" });
    }
    expect(teacher.emitInBatch.mock.calls).toHaveLength(0);
    expect(JSON.stringify(student.emitInBatch.mock.calls).length).toBeLessThan(2000);
    const anotherTab = socket("student", false, "limits");
    joinModeratedRoom(anotherTab);
    command(anotherTab, { op: "sync" });
    expect(JSON.stringify(anotherTab.emitInBatch.mock.calls)).toContain("retryAfterMs");
    expect(JSON.stringify(anotherTab.emitInBatch.mock.calls)).not.toContain("messages");
    vi.advanceTimersByTime(10000);
    student.emitInBatch.mockClear();
    teacher.emitInBatch.mockClear();
    command(student, { op: "delete", id: "100" });
    expect(JSON.stringify(teacher.emitInBatch.mock.calls)).toContain("deleted");
    expect(JSON.stringify(teacher.emitInBatch.mock.calls).length).toBeLessThan(1000);
    expect(session.messages).toHaveLength(99);
    student.emitInBatch.mockClear();
    anotherTab.emitInBatch.mockClear();
    command(student, { op: "sync" });
    command(anotherTab, { op: "sync" });
    expect(student.emitInBatch.mock.calls).toHaveLength(1);
    expect(JSON.stringify(anotherTab.emitInBatch.mock.calls)).toContain("retryAfterMs");
    expect(JSON.stringify(anotherTab.emitInBatch.mock.calls)).not.toContain("messages");
    student.emitInBatchBounded.mockReturnValue(false);
    vi.advanceTimersByTime(5000);
    command(student, { op: "sync" });
    expect(student.end.mock.calls).toHaveLength(1);
    expect(student.emitInBatchBounded.mock.calls.at(-1)?.[1]).toBe(ROOM_CHAT_QUEUE_BYTES);
});
