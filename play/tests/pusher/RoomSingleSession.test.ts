import { afterEach, expect, it, vi } from "vitest";
import { mock } from "vitest-mock-extended";
import type { ServerToClientMessage } from "@workadventure/messages";
import type { SocketData } from "../../src/pusher/models/Websocket/SocketData";
import type { PusherWebSocket } from "../../src/pusher/services/PusherWebSocket";
vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));
import {
    handleRoomChat,
    joinModeratedRoom,
    leaveModeratedRoom,
    replaceOlderSessions,
} from "../../src/pusher/quanta/roomModeration";

const sockets: PusherWebSocket[] = [];
const sent = new WeakMap<PusherWebSocket, ServerToClientMessage[]>();
function join(id: string, tabId: string, room = "single", staff = false) {
    const client = mock<PusherWebSocket>();
    const data = mock<SocketData>({
        userUuid: id,
        tabId,
        tags: staff ? ["admin"] : [],
        world: room,
        quantaPublicName: id,
    });
    data.spaces = new Set([`${room}.quantaRoomChat`]);
    client.getUserData.mockReturnValue(data);
    const messages: ServerToClientMessage[] = [];
    sent.set(client, messages);
    client.send.mockImplementation((message: ServerToClientMessage) => messages.push(message));
    client.emitInBatchBounded.mockReturnValue(true);
    sockets.push(client);
    joinModeratedRoom(client, (socket, code, reason) => {
        leaveModeratedRoom(socket);
        socket.end(code, reason);
    });
    replaceOlderSessions(client);
    return client;
}
const replacedScreen = (client: PusherWebSocket) =>
    (sent.get(client) ?? []).some(
        (message) =>
            message.message?.$case === "errorScreenMessage" &&
            message.message.errorScreenMessage.type === "replaced" &&
            message.message.errorScreenMessage.code === "ROOM_OPENED_ELSEWHERE" &&
            message.message.errorScreenMessage.buttonTitle === "Use here",
    );

afterEach(() => {
    for (const client of sockets.splice(0)) leaveModeratedRoom(client);
});

it("a newer session of the same account takes the room over; the older one leaves with a way back", () => {
    const first = join("teacher", "tab-1", "single", true);
    const student = join("student", "tab-9");
    const second = join("teacher", "tab-2", "single", true);
    expect(replacedScreen(first)).toBe(true);
    expect(first.end.mock.calls).toEqual([[1008, expect.any(String)]]);
    expect(second.end.mock.calls).toHaveLength(0);
    expect(student.end.mock.calls).toHaveLength(0);
    expect(replacedScreen(student)).toBe(false);
    // Using it here again (a reload: a new tab id) takes it back.
    const third = join("teacher", "tab-3", "single", true);
    expect(replacedScreen(second)).toBe(true);
    expect(third.end.mock.calls).toHaveLength(0);
});

it("leaves a reconnection of the same tab and the same account in other rooms alone", () => {
    const first = join("student", "tab-1");
    const reconnect = join("student", "tab-1");
    const elsewhere = join("student", "tab-2", "other-room");
    expect(first.end.mock.calls).toHaveLength(0);
    expect(reconnect.end.mock.calls).toHaveLength(0);
    expect(elsewhere.end.mock.calls).toHaveLength(0);
});

it("a student the teacher removes leaves with the removal screen's code, which the room shows in their language", () => {
    const teacher = join("teacher", "tab-1", "removal", true);
    const student = join("student", "tab-2", "removal");
    handleRoomChat(teacher, {
        spaceName: "removal.quantaRoomChat",
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
    const screens = (sent.get(student) ?? []).flatMap((message) =>
        message.message?.$case === "errorScreenMessage" ? [message.message.errorScreenMessage] : [],
    );
    expect(screens.map((screen) => [screen.type, screen.code])).toEqual([["error", "ROOM_REMOVED"]]);
    expect(student.end.mock.calls).toEqual([[1008, expect.any(String)]]);
});
