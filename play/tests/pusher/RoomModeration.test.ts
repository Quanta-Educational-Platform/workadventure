import { afterEach, describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import type { SocketData } from "../../src/pusher/models/Websocket/SocketData";
import type { PusherWebSocket } from "../../src/pusher/services/PusherWebSocket";
vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));
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
        const forced = (event: object) =>
            expect.objectContaining({
                message: expect.objectContaining({
                    $case: "privateEvent",
                    privateEvent: expect.objectContaining({ spaceEvent: { event } }),
                }),
            });
        const muteAudio = forced({ $case: "muteAudio", muteAudio: { force: true } });
        const muteVideo = forced({ $case: "muteVideo", muteVideo: { force: true } });
        command(teacher, { op: "moderate", action: "mute_mic", id: "student" });
        expect(student.emitInBatch.mock.calls.flat()).toContainEqual(muteAudio);
        expect(student.emitInBatch.mock.calls.flat()).not.toContainEqual(muteVideo);
        command(teacher, { op: "moderate", action: "mute_camera", id: "student" });
        expect(student.emitInBatch.mock.calls.flat()).toContainEqual(muteVideo);
        command(student, { op: "moderate", action: "mute_camera", id: "teacher" });
        expect(teacher.emitInBatch.mock.calls.flat()).not.toContainEqual(muteVideo);
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
        const help = roomSessions.get("history").messages[0].id;
        command(other, { op: "delete", id: help });
        const late = socket("late", false, "history");
        joinModeratedRoom(late);
        command(late, { op: "sync" });
        expect(JSON.stringify(late.emitInBatch.mock.calls)).toContain("help");
        expect(JSON.stringify(late.emitInBatch.mock.calls)).not.toContain("spoofed");
        command(teacher, { op: "delete", id: help });
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
    command(student, { op: "delete", id: session.messages.at(-1)?.id });
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
it("lets only the author edit a message, keeps the blank rules and tells everyone in place", () => {
    const author = socket("author", false, "edits"),
        other = socket("other", false, "edits"),
        teacher = socket("teacher", true, "edits");
    for (const client of [author, other, teacher]) joinModeratedRoom(client);
    command(author, { op: "send", body: "2+2=5" });
    command(other, { op: "send", body: "next" });
    const session = roomSessions.get("edits");
    const id = session.messages[0].id;
    command(other, { op: "edit", id, body: "hijacked" });
    command(teacher, { op: "edit", id, body: "hijacked" });
    expect(session.messages[0]).toMatchObject({ body: "2+2=5" });
    expect(session.messages[0].edited).toBeUndefined();
    for (const blank of ["", "&nbsp;<br>", "<div><br></div>", 42])
        command(author, { op: "edit", id, body: blank });
    expect(session.messages[0].body).toBe("2+2=5");
    other.emitInBatch.mockClear();
    command(author, { op: "edit", id, body: "2+2=4" });
    expect(session.messages.map((message) => message.body)).toEqual(["2+2=4", "next"]);
    expect(session.messages[0].edited).toBe(true);
    const seen = JSON.stringify(other.emitInBatch.mock.calls);
    expect(seen).toContain("edited");
    expect(seen).toContain("2+2=4");
    other.emitInBatch.mockClear();
    command(author, { op: "edit", id, body: "2+2=4" });
    expect(other.emitInBatch.mock.calls).toHaveLength(0);
    command(teacher, { op: "moderate", action: "mute_chat", id: "author" });
    command(author, { op: "edit", id, body: "while muted" });
    expect(session.messages[0].body).toBe("2+2=4");
});
it("answers a message sent too fast with its reference and the time left, and the sender's copy with its own", () => {
    vi.useFakeTimers();
    const student = socket("student", false, "fast"),
        other = socket("other", false, "fast");
    joinModeratedRoom(student);
    joinModeratedRoom(other);
    const answers = () =>
        student.emitInBatch.mock.calls.map(([message]) =>
            JSON.parse(
                (
                    message as {
                        message: { publicEvent: { spaceEvent: { event: { spaceMessage: { message: string } } } } };
                    }
                ).message.publicEvent.spaceEvent.event.spaceMessage.message,
            ),
        );
    command(student, { op: "send", body: "first", ref: "c1" });
    expect(answers().at(-1)).toMatchObject({ append: { body: "first" }, ref: "c1" });
    expect(JSON.stringify(other.emitInBatch.mock.calls)).not.toContain("c1");
    for (let i = 2; i <= 10; i++) command(student, { op: "send", body: `m${i}`, ref: `c${i}` });
    vi.advanceTimersByTime(3000);
    command(student, { op: "send", body: "eleventh", ref: "c11" });
    expect(answers().at(-1)).toEqual({ quanta: 1, retryAfterMs: 7000, ref: "c11" });
    expect(roomSessions.get("fast").messages).toHaveLength(10);
    command(student, { op: "send", body: "", ref: "c12" });
    vi.advanceTimersByTime(7000);
    command(student, { op: "send", body: " ", ref: "c13" });
    expect(answers().at(-1)).toMatchObject({ notice: expect.any(String), ref: "c13" });
});
