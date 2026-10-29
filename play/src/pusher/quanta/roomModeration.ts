import { asError } from "catch-unknown";
import { SpaceUser, ErrorScreenMessage } from "@workadventure/messages";
import type { PublicEventFrontToPusher, SubMessage } from "@workadventure/messages";
import { RoomSessions, type RoomPerson } from "../../common/quanta/RoomSession";
import type { PusherWebSocket } from "../services/PusherWebSocket";
import type { ConnectingSocketData } from "../models/Websocket/SocketData";

export const roomSessions = new RoomSessions();
const connections = new Map<string, Set<PusherWebSocket>>();
type TerminalDisconnect = (socket: PusherWebSocket, code: number, reason: string) => void;
const terminators = new WeakMap<PusherWebSocket, TerminalDisconnect>();
const chatSpace = "quantaRoomChat";
export const ROOM_CHAT_QUEUE_BYTES = 4 * 1024 * 1024;
export function publicRoomName(data: Pick<ConnectingSocketData, "quantaPublicName">): string {
    return data.quantaPublicName?.trim().slice(0, 64) || "Guest";
}
function roomOf(socket: PusherWebSocket): string {
    // Admin API world identifies the Quanta entity independently of URL spelling.
    const world = socket.getUserData().world;
    if (!world) throw new Error("Room identity unavailable.");
    return world;
}
function person(socket: PusherWebSocket): RoomPerson {
    const data = socket.getUserData();
    return { id: data.userUuid, name: publicRoomName(data), staff: data.tags.includes("admin") };
}
function terminate(socket: PusherWebSocket, reason: string): void {
    terminators.get(socket)?.(socket, 1008, reason);
}
function removeNotice(socket: PusherWebSocket): void {
    try {
        socket.send({
            message: {
                $case: "errorScreenMessage",
                errorScreenMessage: ErrorScreenMessage.fromPartial({
                    type: "error",
                    title: "Removed by the teacher",
                    subtitle: "Ask the teacher to let you back into this room.",
                }),
            },
        });
    } finally {
        terminate(socket, "You were removed by the teacher. Ask the teacher to let you back in.");
    }
}
export function joinModeratedRoom(socket: PusherWebSocket, disconnect: TerminalDisconnect): boolean {
    terminators.set(socket, disconnect);
    const data = socket.getUserData();
    if (!data.world) {
        terminate(socket, "Room identity unavailable.");
        return false;
    }
    const room = roomOf(socket);
    // Admission must work before JoinRoomFrontMessage has initialized SocketData.name.
    if (roomSessions.get(room).removed.has(data.userUuid) && !data.tags.includes("admin")) {
        removeNotice(socket);
        return false;
    }
    roomSessions.join(room, socket);
    let members = connections.get(room);
    if (!members) connections.set(room, (members = new Set()));
    members.add(socket);
    return true;
}
export function leaveModeratedRoom(socket: PusherWebSocket): void {
    const room = socket.getUserData().world;
    const members = connections.get(room);
    if (!members?.delete(socket)) return;
    roomSessions.leave(room, socket);
    if (!members.size) connections.delete(room);
    else publishRoomModeration(socket);
}
function state(socket: PusherWebSocket) {
    const session = roomSessions.get(roomOf(socket));
    const people = new Map<string, RoomPerson>();
    for (const member of connections.get(roomOf(socket)) ?? []) people.set(person(member).id, person(member));
    return {
        self: person(socket).id,
        canModerate: person(socket).staff,
        people: [...people.values()],
        muted: [...session.muted],
        removed: [...session.removed.values()],
    };
}
function queueRoomEvent(socket: PusherWebSocket, message: SubMessage): boolean {
    if (socket.isDisconnecting()) return false;
    if (socket.emitInBatchBounded(message, ROOM_CHAT_QUEUE_BYTES)) return true;
    terminate(socket, "Chat connection overloaded. Please reconnect.");
    return false;
}
function deliver(socket: PusherWebSocket, update: object): void {
    const data = socket.getUserData();
    if (!data.spaces.has(`${data.world}.${chatSpace}`)) return;
    queueRoomEvent(socket, {
        message: {
            $case: "publicEvent",
            publicEvent: {
                spaceName: chatSpace,
                senderUserId: "quanta-server",
                spaceEvent: {
                    event: {
                        $case: "spaceMessage",
                        spaceMessage: {
                            message: JSON.stringify({ quanta: 1, ...update }),
                            characterTextures: [],
                            name: "",
                        },
                    },
                },
            },
        },
    });
}
function snapshot(socket: PusherWebSocket): void {
    deliver(socket, { ...state(socket), messages: roomSessions.get(roomOf(socket)).messages });
}
export function publishRoomModeration(socket: PusherWebSocket): void {
    for (const member of [...(connections.get(roomOf(socket)) ?? [])]) deliver(member, { state: state(member) });
}
function broadcast(socket: PusherWebSocket, update: object): void {
    for (const member of [...(connections.get(roomOf(socket)) ?? [])]) deliver(member, update);
}
export function handleRoomChat(socket: PusherWebSocket, event: PublicEventFrontToPusher): boolean {
    if (event.spaceName !== `${socket.getUserData().world}.${chatSpace}`) return false;
    if (socket.isDisconnecting()) return true;
    const payload = event.spaceEvent?.event;
    if (payload?.$case !== "spaceMessage") return true;
    const session = roomSessions.get(roomOf(socket));
    // Limits are shared by every tab and URL spelling for this account and room.
    if (!session.acceptCommand(person(socket).id)) {
        deliver(socket, { retryAfterMs: 10000 });
        return true;
    }
    try {
        if (payload.spaceMessage.message.length > 25000) throw new Error("Message too large.");
        const command: unknown = JSON.parse(payload.spaceMessage.message);
        if (!command || typeof command !== "object") throw new Error("Invalid command.");
        const input = Object.fromEntries(Object.entries(command));
        if (input.op === "sync") {
            if (session.acceptSync(person(socket).id)) snapshot(socket);
            else deliver(socket, { retryAfterMs: 5000 });
        } else if (input.op === "send") {
            session.send(person(socket), input.body);
            broadcast(socket, { append: session.messages.at(-1) });
        } else if (input.op === "delete") {
            if (session.delete(person(socket), input.id)) broadcast(socket, { deleted: input.id });
        } else if (input.op === "moderate") {
            const targets = [...(connections.get(roomOf(socket)) ?? [])].filter(
                (member) => person(member).id === input.id,
            );
            const activeTarget = targets.find((member) => person(member).staff) ?? targets[0];
            const target = activeTarget ? person(activeTarget) : session.removed.get(String(input.id));
            const before = JSON.stringify({ muted: [...session.muted], removed: [...session.removed] });
            const action = session.moderate(person(socket), input.action, target);
            for (const member of targets) {
                if (action === "remove") removeNotice(member);
                if (action === "mute_mic") {
                    for (const kind of ["muteAudio", "muteVideo"] as const) {
                        if (
                            !queueRoomEvent(member, {
                                message: {
                                    $case: "privateEvent",
                                    privateEvent: {
                                        spaceName: chatSpace,
                                        receiverUserId: "",
                                        sender: SpaceUser.fromPartial({
                                            name: publicRoomName(socket.getUserData()),
                                            tags: socket.getUserData().tags,
                                        }),
                                        spaceEvent: {
                                            event:
                                                kind === "muteAudio"
                                                    ? { $case: "muteAudio", muteAudio: { force: true } }
                                                    : { $case: "muteVideo", muteVideo: { force: true } },
                                        },
                                    },
                                },
                            })
                        )
                            break;
                    }
                }
            }
            if (before !== JSON.stringify({ muted: [...session.muted], removed: [...session.removed] }))
                publishRoomModeration(socket);
        } else throw new Error("Invalid command.");
    } catch (error) {
        deliver(socket, { notice: asError(error).message });
    }
    return true;
}
