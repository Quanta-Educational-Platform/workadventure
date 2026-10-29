import { afterEach, describe, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import { JoinRoomFrontMessage } from "@workadventure/messages";
import type { BackConnection, SocketData } from "../../src/pusher/models/Websocket/SocketData";
import { PusherWebSocket, type RawSocket } from "../../src/pusher/services/PusherWebSocket";
import type { PusherRoom } from "../../src/pusher/models/PusherRoom";
vi.mock("../../src/pusher/enums/EnvironmentVariable", async () => {
    const env = await import("./mocks/pusherEnvironmentVariableMock");
    return { ...env, FRONT_ENVIRONMENT_VARIABLES: { ...env.FRONT_ENVIRONMENT_VARIABLES, QUANTA_UI: true } };
});
import { SocketManager } from "../../src/pusher/services/SocketManager";
import {
    roomSessions,
    handleRoomChat,
    leaveModeratedRoom,
    ROOM_CHAT_QUEUE_BYTES,
} from "../../src/pusher/quanta/roomModeration";
import { ROOM_SESSION_TTL } from "../../src/common/quanta/RoomSession";
const clients: PusherWebSocket[] = [];
function setup(id: string, world: string, username?: string, staff = false) {
    const client = mock<PusherWebSocket>();
    const data = mock<SocketData>({
        userUuid: id,
        world,
        roomId: `https://play.test/${world}`,
        tags: staff ? ["admin"] : [],
        quantaPublicName: username,
        analyticsEventsEnabled: false,
        joinedRoom: false,
    });
    data.spaces = new Set();
    data.joinSpacesPromise = new Map();
    data.currentChatRoomArea = [];
    const back = mock<BackConnection>();
    data.backConnection = back;
    Object.defineProperty(data, "name", { value: undefined, writable: true });
    client.getUserData.mockReturnValue(data);
    let closed = false;
    client.isDisconnecting.mockImplementation(() => closed);
    client.end.mockImplementation(() => {
        closed = true;
    });
    client.emitInBatchBounded.mockReturnValue(true);
    const manager = new SocketManager();
    vi.spyOn(manager, "getOrCreateRoom").mockResolvedValue(mock<PusherRoom>());
    clients.push(client);
    return { manager, client, data, back };
}
const join = ({ manager, client }: ReturnType<typeof setup>) =>
    manager.handleJoinRoom(
        client,
        JoinRoomFrontMessage.fromPartial({ name: "Private Full Name", positionMessage: {}, viewportMessage: {} }),
    );
afterEach(() => {
    for (const client of clients.splice(0)) leaveModeratedRoom(client);
    vi.restoreAllMocks();
    vi.useRealTimers();
});
describe("Quanta socket admission and terminal removal", () => {
    it("admits a fresh connection without a client name and sends only the Admin API public username to back", async () => {
        const user = setup("student", "fresh", "public_username");
        await join(user);
        expect(user.data.name).toBe("public_username");
        expect(JSON.stringify(user.back.write.mock.calls)).not.toContain("Private Full Name");
        expect(user.data.joinedRoom).toBe(true);
    });
    it("uses a non-identifying alias when the Admin API username is absent", async () => {
        const user = setup("email@example.test", "alias");
        await join(user);
        expect(user.data.name).toBe("Guest");
        expect(JSON.stringify(user.back.write.mock.calls)).not.toContain("Private Full Name");
    });
    it("cleans up the room, spaces and back stream before socket.end and expires removed membership", async () => {
        vi.useFakeTimers();
        const student = setup("student", "lifecycle", "student");
        const teacher = setup("teacher", "lifecycle", "teacher", true);
        student.data.name = "student";
        teacher.data.name = "teacher";
        await join(student);
        await join(teacher);
        const leaveRoom = vi.spyOn(student.manager, "leaveRoom");
        const leaveSpaces = vi.spyOn(student.manager, "leaveSpaces");
        const backEnd = student.back.end.mock;
        handleRoomChat(teacher.client, {
            spaceName: "lifecycle.quantaRoomChat",
            spaceEvent: {
                event: {
                    $case: "spaceMessage",
                    spaceMessage: {
                        message: JSON.stringify({ op: "moderate", action: "remove", id: "student" }),
                        name: "",
                        characterTextures: [],
                    },
                },
            },
        });
        expect(student.client.end.mock.calls).toHaveLength(1);
        expect(leaveRoom).toHaveBeenCalledOnce();
        expect(leaveSpaces).toHaveBeenCalledOnce();
        expect(backEnd.calls).toHaveLength(1);
        expect(backEnd.invocationCallOrder[0]).toBeLessThan(student.client.end.mock.invocationCallOrder[0]);
        expect(student.data.joinedRoom).toBe(false);
        teacher.manager.cleanupSocket(teacher.client);
        expect(roomSessions.get("lifecycle").removed.has("student")).toBe(true);
        vi.advanceTimersByTime(ROOM_SESSION_TTL);
        expect(roomSessions.get("lifecycle").removed.size).toBe(0);
    });
});

it("cleans up an overloaded transport before enqueueing forced microphone or camera mute events", async () => {
    const student = setup("student", "mic-queue-cap", "student");
    const teacher = setup("teacher", "mic-queue-cap", "teacher", true);
    const raw = mock<RawSocket>();
    raw.getUserData.mockReturnValue(student.data);
    raw.send.mockReturnValue(2);
    raw.getBufferedAmount.mockReturnValue(0);
    const real = new PusherWebSocket(raw);
    try {
        await student.manager.handleJoinRoom(
            real,
            JoinRoomFrontMessage.fromPartial({ positionMessage: {}, viewportMessage: {} }),
        );
        await join(teacher);
        student.data.spaces.add("mic-queue-cap.quantaRoomChat");
        raw.getBufferedAmount.mockReturnValue(ROOM_CHAT_QUEUE_BYTES);
        handleRoomChat(teacher.client, {
            spaceName: "mic-queue-cap.quantaRoomChat",
            spaceEvent: {
                event: {
                    $case: "spaceMessage",
                    spaceMessage: {
                        message: JSON.stringify({ op: "moderate", action: "mute_mic", id: "student" }),
                        name: "",
                        characterTextures: [],
                    },
                },
            },
        });
        expect(real.isDisconnecting()).toBe(true);
        expect(student.data.joinedRoom).toBe(false);
        expect(student.back.end.mock.calls).toHaveLength(1);
        expect(raw.end.mock.calls).toHaveLength(1);
        expect(student.back.end.mock.invocationCallOrder[0]).toBeLessThan(raw.end.mock.invocationCallOrder[0]);
        real.flushBatch();
        expect(raw.send.mock.calls).toHaveLength(0);
    } finally {
        if (!real.isDisconnecting()) {
            student.manager.cleanupSocket(real);
            real.end();
        }
    }
});
