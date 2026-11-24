import { asError } from "catch-unknown";
import { SpaceUser, ErrorScreenMessage } from "@workadventure/messages";
import type { PublicEventFrontToPusher, SubMessage } from "@workadventure/messages";
import {
    ROOM_CHAT_TTL,
    ROOM_SESSION_TTL,
    RoomSessions,
    type RoomMessage,
    type RoomPerson,
    type RoomSession,
    type SavedModeration,
    GROUP_MEMBERS_LIMIT,
    isPrivateMessage,
    messageVisibleTo,
} from "../../common/quanta/RoomSession";
import { mentionText, namesMention } from "../../common/quanta/chatBody";
import type { PusherWebSocket } from "../services/PusherWebSocket";
import { forwardTranscriptLine } from "./roomTranscript";
import type { SpaceInterface } from "../models/Space";
import type { ConnectingSocketData } from "../models/Websocket/SocketData";
import {
    appendRoomChat,
    deleteRoomChat,
    editRoomChat,
    expireModeration,
    expireRoomChat,
    loadModeration,
    loadRoomChat,
    loadRoomPins,
    saveModeration,
    saveRoomPins,
} from "./moderationStore";

export const roomSessions = new RoomSessions();
// The pusher's spaces by name (SocketManager): a teacher's mute reaches the back of every space the person is in.
let spaceByName: (name: string) => SpaceInterface | undefined = () => undefined;
export function setRoomSpaceLookup(lookup: (name: string) => SpaceInterface | undefined): void {
    spaceByName = lookup;
}
const connections = new Map<string, Set<PusherWebSocket>>();
type TerminalDisconnect = (socket: PusherWebSocket, code: number, reason: string) => void;
const terminators = new WeakMap<PusherWebSocket, TerminalDisconnect>();
// Sockets whose client asked for the chat: a history restored later is sent to them again.
const synced = new WeakSet<PusherWebSocket>();
const chatSpace = "quantaRoomChat";
export const ROOM_CHAT_QUEUE_BYTES = 4 * 1024 * 1024;
// Characters that draw nothing or a box: fillers and format marks are how a name is made to look blank.
const INVISIBLE_IN_NAME =
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u034F\u115F\u1160\u17B4\u17B5\u180B-\u180F\u2800\u3164\uFE00-\uFE0F\uFFA0]/gu;

export function publicRoomName(data: Pick<ConnectingSocketData, "quantaPublicName">): string {
    const name = data.quantaPublicName?.replace(INVISIBLE_IN_NAME, "").replace(/\s+/g, " ").trim();
    return name?.slice(0, 64) || "Guest";
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
// The room's own screens carry a code: the room shows them in the reader's language; the words here are the fallback.
export const REMOVED_SCREEN_CODE = "ROOM_REMOVED";
export const REPLACED_SCREEN_CODE = "ROOM_OPENED_ELSEWHERE";
function removeNotice(socket: PusherWebSocket): void {
    try {
        socket.send({
            message: {
                $case: "errorScreenMessage",
                errorScreenMessage: ErrorScreenMessage.fromPartial({
                    type: "error",
                    code: REMOVED_SCREEN_CODE,
                    title: "Removed by the teacher",
                    subtitle: "Ask the teacher to let you back into this room.",
                }),
            },
        });
    } finally {
        terminate(socket, "You were removed by the teacher. Ask the teacher to let you back in.");
    }
}
export const REPLACED_SCREEN_TYPE = "replaced";
/**
 * An account is in a room once: a session opened from another tab or device takes over, and the older ones leave
 * with a screen that lets them take it back. A reconnection of the same tab is the back's to replace.
 */
export function replaceOlderSessions(socket: PusherWebSocket): void {
    const data = socket.getUserData();
    for (const member of [...(connections.get(roomOf(socket)) ?? [])]) {
        const older = member.getUserData();
        if (member === socket || older.userUuid !== data.userUuid || older.tabId === data.tabId) continue;
        try {
            member.send({
                message: {
                    $case: "errorScreenMessage",
                    errorScreenMessage: ErrorScreenMessage.fromPartial({
                        type: REPLACED_SCREEN_TYPE,
                        code: REPLACED_SCREEN_CODE,
                        title: "You opened this room elsewhere",
                        subtitle: "You are in the room in another tab or on another device, so this one left it.",
                        buttonTitle: "Use here",
                    }),
                },
            });
        } catch (error) {
            console.warn("Room moderation could not tell an older session it was replaced", asError(error).message);
        } finally {
            terminate(member, "This room was opened in another tab or on another device.");
        }
    }
}
// Saved decisions outlive a restart while the room is in use, and lapse with the in-memory session once it empties.
const OCCUPIED_TTL_MS = 24 * 60 * 60 * 1000;
// A join waits this long for saved decisions, then goes ahead on what memory knows; a later answer still applies.
export const RESTORE_JOIN_WAIT_MS = 1000;
// A restart drops every socket at once; only after this does Redis take on the mutes an empty room cleared.
const EMPTY_SYNC_MS = 60_000;
// An occupied room's chat is refreshed while it stays occupied, so it outlives play stopping without anyone leaving.
const CHAT_REFRESH_MS = 5 * 60 * 1000;
const CHAT_OCCUPIED_TTL_MS = ROOM_CHAT_TTL + CHAT_REFRESH_MS;
setInterval(() => {
    for (const room of connections.keys()) expireRoomChat(room, CHAT_OCCUPIED_TTL_MS, roomSessions.get(room).startedAt);
}, CHAT_REFRESH_MS).unref?.();
// A read that failed is tried again on a later join or teacher action, after this long, doubling up to the maximum.
export const RESTORE_RETRY_MIN_MS = 2000;
export const RESTORE_RETRY_MAX_MS = 60_000;
type Restore = {
    // The first read only: joins wait for it, never for a retry.
    first: Promise<void>;
    waited: boolean;
    restored: boolean;
    reading: boolean;
    failures: number;
    retryAt: number;
    // Decisions taken before the saved ones were read, kept from Redis so they don't overwrite them.
    unsaved: boolean;
};
const restoring = new WeakMap<RoomSession, Restore>();
const emptySync = new Map<string, NodeJS.Timeout>();
function persist(room: string): void {
    const session = roomSessions.get(room);
    const state = restoring.get(session);
    if (state && !state.restored) {
        state.unsaved = true;
        retryRestore(room, session, state);
        return;
    }
    saveModeration(room, session.saved(), connections.has(room) ? OCCUPIED_TTL_MS : ROOM_SESSION_TTL);
}
async function restore(room: string, session: RoomSession, state: Restore): Promise<void> {
    state.reading = true;
    let saved: SavedModeration | undefined;
    try {
        saved = await loadModeration(room);
    } catch {
        state.failures++;
        state.retryAt = Date.now() + Math.min(RESTORE_RETRY_MAX_MS, RESTORE_RETRY_MIN_MS * 2 ** (state.failures - 1));
        return;
    } finally {
        state.reading = false;
    }
    state.restored = true;
    const changed = saved !== undefined && session.restore(saved);
    if (changed) {
        // A read that answers late applies to the people who joined meanwhile as well.
        for (const member of [...(connections.get(room) ?? [])]) {
            if (!session.removed.has(person(member).id) || person(member).staff) continue;
            try {
                removeNotice(member);
            } catch (error) {
                console.warn("Room moderation could not remove a restored removal", asError(error).message);
            }
        }
    }
    if (changed || state.unsaved) persist(room);
    if (changed) publishRoom(room);
}
// The chat's history is read on its own: a failed read of it never holds back saved removals and mutes.
type HistoryRestore = { first: Promise<void>; restored: boolean; reading: boolean; failures: number; retryAt: number };
const historyRestoring = new WeakMap<RoomSession, HistoryRestore>();
async function restoreHistory(room: string, session: RoomSession, state: HistoryRestore): Promise<void> {
    state.reading = true;
    let history: RoomMessage[];
    let pins: RoomMessage[];
    try {
        [history, pins] = await Promise.all([loadRoomChat(room), loadRoomPins(room)]);
    } catch {
        state.failures++;
        state.retryAt = Date.now() + Math.min(RESTORE_RETRY_MAX_MS, RESTORE_RETRY_MIN_MS * 2 ** (state.failures - 1));
        return;
    } finally {
        state.reading = false;
    }
    state.restored = true;
    // Whoever joined before the read answered was sent the chat without its history.
    const restoredMessages = session.restoreMessages(history);
    const restoredPins = session.restorePins(pins);
    // Pins made before the read were saved without the older ones: the merged list replaces them.
    if (restoredPins) saveRoomPins(room, session.pins, CHAT_OCCUPIED_TTL_MS);
    if (restoredPins || restoredMessages)
        for (const member of [...(connections.get(room) ?? [])]) if (synced.has(member)) snapshot(member);
}
function historyRestore(room: string, session: RoomSession): HistoryRestore {
    let state = historyRestoring.get(session);
    if (!state) {
        const fresh: HistoryRestore = {
            first: Promise.resolve(),
            restored: false,
            reading: false,
            failures: 0,
            retryAt: 0,
        };
        fresh.first = restoreHistory(room, session, fresh);
        historyRestoring.set(session, (state = fresh));
    } else if (!state.restored && !state.reading && Date.now() >= state.retryAt)
        restoreHistory(room, session, state).catch((error: unknown) =>
            console.warn("Room chat could not restore its history", asError(error).message),
        );
    return state;
}
function retryRestore(room: string, session: RoomSession, state: Restore): void {
    if (state.restored || state.reading || Date.now() < state.retryAt) return;
    restore(room, session, state).catch((error: unknown) =>
        console.warn("Room moderation could not restore saved decisions", asError(error).message),
    );
}
/** Loads the room's saved removals, mutes and chat, waiting at most RESTORE_JOIN_WAIT_MS, once per session. */
export async function restoreModeratedRoom(socket: PusherWebSocket): Promise<void> {
    const room = socket.getUserData().world;
    if (!room) return;
    const session = roomSessions.get(room);
    let state = restoring.get(session);
    if (!state) {
        const fresh: Restore = {
            first: Promise.resolve(),
            waited: false,
            restored: false,
            reading: false,
            failures: 0,
            retryAt: 0,
            unsaved: false,
        };
        fresh.first = restore(room, session, fresh);
        restoring.set(session, (state = fresh));
    } else retryRestore(room, session, state);
    const history = historyRestore(room, session);
    // Once a join has given up on a slow Redis, the joins after it don't wait again.
    if (state.waited) return;
    const pending = state;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
        Promise.all([pending.first, history.first]),
        new Promise<void>((resolve) => {
            timer = setTimeout(() => {
                pending.waited = true;
                resolve();
            }, RESTORE_JOIN_WAIT_MS);
        }),
    ]);
    clearTimeout(timer);
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
    if (!members) {
        connections.set(room, (members = new Set()));
        expireModeration(room, OCCUPIED_TTL_MS);
        expireRoomChat(room, CHAT_OCCUPIED_TTL_MS, roomSessions.get(room).startedAt);
    }
    members.add(socket);
    return true;
}
export function leaveModeratedRoom(socket: PusherWebSocket): void {
    const room = socket.getUserData().world;
    const members = connections.get(room);
    if (!members?.delete(socket)) return;
    roomSessions.leave(room, socket);
    if (!members.size) {
        connections.delete(room);
        pendingPublish.delete(room);
        expireModeration(room, ROOM_SESSION_TTL);
        expireRoomChat(room, ROOM_CHAT_TTL, roomSessions.get(room).startedAt);
        if (!emptySync.has(room)) {
            const timer = setTimeout(() => {
                emptySync.delete(room);
                persist(room);
            }, EMPTY_SYNC_MS);
            timer.unref?.();
            emptySync.set(room, timer);
        }
    } else schedulePublish(room);
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
        cameraOff: [...session.cameraOff],
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
    // One member's broken socket must not fail the join, leave or command of the one who triggered the fan-out.
    try {
        deliverTo(socket, update);
    } catch (error) {
        console.warn("Room moderation delivery failed", asError(error).message);
    }
}
function deliverTo(socket: PusherWebSocket, update: object): void {
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
    const session = roomSessions.get(roomOf(socket));
    deliver(socket, { ...state(socket), messages: session.history(person(socket).id), pins: session.pins });
}
/** The class chat's pins changed: everyone in the room is told, and they are saved with the chat. */
function publishPins(room: string): void {
    const session = roomSessions.get(room);
    for (const member of [...(connections.get(room) ?? [])]) deliver(member, { pins: session.pins });
    saveRoomPins(room, session.pins, CHAT_OCCUPIED_TTL_MS);
}
const MENTIONS_MAX = 10;
/**
 * Whom a message names with @, of the ids its client sent: people in the room now (whom everyone in it sees anyway)
 * whom the body names as "@<the server's name>", and in a direct message its other person alone (named as the
 * writer's room shows them, which may be a real name the server doesn't know). Names are the server's, so a mention
 * tells nobody anything new.
 */
function mentioned(room: string, ids: unknown, body: unknown, sender: RoomPerson, to?: RoomPerson): RoomPerson[] {
    if (!Array.isArray(ids) || typeof body !== "string" || !body.includes("@")) return [];
    const wanted = new Set(
        ids.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200).slice(0, 50),
    );
    wanted.delete(sender.id);
    if (to) return wanted.has(to.id) ? [to] : [];
    const found = new Map<string, RoomPerson>();
    for (const member of connections.get(room) ?? []) {
        const candidate = person(member);
        if (wanted.has(candidate.id) && (!found.get(candidate.id) || candidate.staff))
            found.set(candidate.id, candidate);
    }
    const text = mentionText(body);
    for (const [id, candidate] of found) if (!namesMention(text, candidate.name)) found.delete(id);
    return [...found.values()].slice(0, MENTIONS_MAX);
}
/**
 * Who a direct message goes to: a person in the room now (whom everyone in it sees anyway), else someone the asker
 * already has a direct conversation with, who is reloading or reconnecting and gets it with their next snapshot. Staff
 * then as the server recorded them when those messages were sent. Nobody else's conversations are looked into.
 */
function recipient(room: string, id: unknown, asker: RoomPerson): RoomPerson | undefined {
    if (typeof id !== "string" || !id || id.length > 200) return undefined;
    let found: RoomPerson | undefined;
    for (const member of connections.get(room) ?? []) {
        const candidate = person(member);
        if (candidate.id === id && (!found || candidate.staff)) found = candidate;
    }
    if (found) return found;
    let name: string | undefined;
    let staff = false;
    for (const entry of roomSessions.get(room).messages) {
        if (!isPrivateMessage(entry) || !messageVisibleTo(entry, asker.id)) continue;
        const member = entry.group?.find((candidate) => candidate.id === id);
        if (member) name = member.name;
        if (entry.sender === id) {
            name = entry.name;
            staff ||= entry.fromStaff === true;
        } else if (entry.to === id) {
            name = entry.toName ?? name;
            staff ||= entry.toStaff === true;
        }
    }
    return name === undefined ? undefined : { id, name, staff };
}
// A proximity bubble's space, as the back names it (Group.spaceName: room, group id, when it formed) behind the world.
const BUBBLE_SPACE = /#\d+#\d+$/;
/**
 * Whether the sender talks with every one of these people in one bubble now, as their sockets' joined spaces say:
 * what lets students keep what a bubble says as their own conversation without a teacher starting it.
 */
function together(room: string, sender: PusherWebSocket, ids: string[]): boolean {
    if (ids.length === 0) return false;
    const members = [...(connections.get(room) ?? [])];
    for (const bubble of sender.getUserData().spaces) {
        if (!BUBBLE_SPACE.test(bubble)) continue;
        if (ids.every((id) => members.some((member) => person(member).id === id && member.getUserData().spaces.has(bubble))))
            return true;
    }
    return false;
}
/** A group message's people besides the sender, each as recipient() finds them; undefined when there is no group. */
function groupOf(room: string, ids: unknown, asker: RoomPerson): RoomPerson[] | undefined {
    if (ids === undefined) return undefined;
    if (!Array.isArray(ids) || ids.length > GROUP_MEMBERS_LIMIT) throw new Error("That group can't be written to.");
    const people: RoomPerson[] = [];
    for (const id of new Set(ids)) {
        if (id === asker.id) continue;
        const member = recipient(room, id, asker);
        if (!member) throw new Error("That person is not in the room.");
        people.push(member);
    }
    return people;
}
function publishRoom(room: string): void {
    const members = [...(connections.get(room) ?? [])];
    if (!members.length) return;
    // The room part is the same for everyone; only self and canModerate differ.
    const shared = state(members[0]);
    for (const member of members) {
        const self = person(member);
        deliver(member, { state: { ...shared, self: self.id, canModerate: self.staff } });
    }
}
export function publishRoomModeration(socket: PusherWebSocket): void {
    publishRoom(roomOf(socket));
}
// A class joining at once would send everyone the whole room on every arrival; joins and leaves coalesce instead.
const PUBLISH_DELAY_MS = 500;
const pendingPublish = new Map<string, NodeJS.Timeout>();
function schedulePublish(room: string): void {
    if (pendingPublish.has(room)) return;
    pendingPublish.set(
        room,
        setTimeout(() => {
            pendingPublish.delete(room);
            publishRoom(room);
        }, PUBLISH_DELAY_MS),
    );
}
export function publishRoomArrival(socket: PusherWebSocket): void {
    schedulePublish(roomOf(socket));
}
/** What the sender's own copy carries: the reference its client gave the command, so it knows which one landed. */
/** To everyone who may see the message (a direct one: its two people); the sender's command answered by its ref. */
function broadcast(socket: PusherWebSocket, update: object, ref: string | undefined, message: RoomMessage): void {
    for (const member of [...(connections.get(roomOf(socket)) ?? [])]) {
        if (member === socket && ref !== undefined) deliver(member, { ...update, ref });
        else if (messageVisibleTo(message, person(member).id)) deliver(member, update);
    }
}
// A client may name a command (`ref`, up to 40 characters); answers meant for it alone carry the name back.
function refOf(command: unknown): string | undefined {
    const ref = command && typeof command === "object" ? (command as { ref?: unknown }).ref : undefined;
    return typeof ref === "string" && ref.length > 0 && ref.length <= 40 ? ref : undefined;
}
function refOfRaw(raw: string): string | undefined {
    if (raw.length > 25000) return undefined;
    try {
        return refOf(JSON.parse(raw));
    } catch {
        return undefined;
    }
}
// A student's reaction or bubble, told to staff only: a teacher receives nothing from outside their own view otherwise.
const ACTIVITY_GAP_MS = 1500;
const ACTIVITY_TEXT_MAX = 120;
const lastActivity = new WeakMap<PusherWebSocket, number>();
// A burst of reactions reaches the room as one update a message per gap: the first goes at once, the rest as one.
const REACTION_GAP_MS = 300;
type ReactionGap = { timer: ReturnType<typeof setTimeout>; message: RoomMessage; before?: RoomMessage };
const reactionGaps = new Map<string, ReactionGap>();
function publishReaction(room: string, message: RoomMessage, before: RoomMessage): void {
    for (const member of [...(connections.get(room) ?? [])])
        if (messageVisibleTo(message, person(member).id)) deliver(member, { edited: message });
    editRoomChat(room, before, message, CHAT_OCCUPIED_TTL_MS, roomSessions.get(room).startedAt);
}
function openReactionGap(room: string, message: RoomMessage): void {
    const key = `${room}\0${message.id}`;
    const gap: ReactionGap = {
        message,
        timer: setTimeout(() => {
            reactionGaps.delete(key);
            if (!gap.before) return;
            publishReaction(room, message, gap.before);
            openReactionGap(room, message);
        }, REACTION_GAP_MS),
    };
    gap.timer.unref?.();
    reactionGaps.set(key, gap);
}
function queueReaction(room: string, message: RoomMessage, before: RoomMessage): void {
    const gap = reactionGaps.get(`${room}\0${message.id}`);
    if (gap) {
        gap.before ??= before;
        return;
    }
    publishReaction(room, message, before);
    openReactionGap(room, message);
}
/** Sends what a gap holds now: an edit or deletion replaces the message in the saved history by its exact text. */
function settleReaction(room: string, id: unknown): void {
    const key = `${room}\0${String(id)}`;
    const gap = reactionGaps.get(key);
    if (!gap) return;
    clearTimeout(gap.timer);
    reactionGaps.delete(key);
    if (gap.before) publishReaction(room, gap.message, gap.before);
}
function relayActivity(socket: PusherWebSocket, raw: string): void {
    const sender = person(socket);
    const room = roomOf(socket);
    if (sender.staff || raw.length > 1000 || roomSessions.get(room).removed.has(sender.id)) return;
    const now = Date.now();
    if (now - (lastActivity.get(socket) ?? 0) < ACTIVITY_GAP_MS) return;
    lastActivity.set(socket, now);
    let command: { kind?: unknown; text?: unknown };
    try {
        command = JSON.parse(raw) as { kind?: unknown; text?: unknown };
    } catch {
        return;
    }
    const { kind, text } = command;
    if ((kind !== "emote" && kind !== "say" && kind !== "think") || typeof text !== "string") return;
    const body = text.replace(/\p{C}/gu, "").trim().slice(0, ACTIVITY_TEXT_MAX);
    if (!body) return;
    for (const member of connections.get(room) ?? [])
        if (person(member).staff)
            deliver(member, { activity: { uuid: sender.id, name: sender.name, kind, text: body } });
}
/**
 * A teacher's mute, enforced where the media flows as well as asked of the person's page: in each space they are in,
 * the back mutes their published track at LiveKit (a page that ignores the request is muted all the same). A microphone
 * they may turn back on themselves: a class needs them to answer and to talk at their table. A camera stays off until
 * staff allow it again (RoomSession.cameraOff): their page keeps it off.
 */
function muteAtServer(member: PusherWebSocket, action: "mute_mic" | "mute_camera"): void {
    const data = member.getUserData();
    for (const name of data.spaces) {
        if (name === `${data.world}.${chatSpace}`) continue;
        try {
            spaceByName(name)?.forwarder.forwardMessageToSpaceBack({
                $case: "privateEvent",
                privateEvent: {
                    spaceName: name,
                    // From the room's server itself: the back mutes at LiveKit and tells nobody (Space.dispatchPrivateEvent).
                    senderUserId: data.spaceUserId,
                    receiverUserId: data.spaceUserId,
                    spaceEvent: {
                        event:
                            action === "mute_mic"
                                ? { $case: "muteAudio", muteAudio: { force: true } }
                                : { $case: "muteVideo", muteVideo: { force: true } },
                    },
                },
            });
        } catch (error) {
            console.warn("Room moderation could not mute at the server", asError(error).message);
        }
    }
}
export const POKE_PRESETS: readonly string[] = ["answer", "camera", "microphone", "attention"];
const POKE_GAP_MS = 2000;
const lastPoke = new Map<string, number>();
/** A teacher's nudge to one student: a toast and a sound on their screen alone. Staff only, never to staff. */
function poke(socket: PusherWebSocket, id: unknown, preset: unknown): void {
    const sender = person(socket);
    if (!sender.staff) throw new Error("Only staff can poke.");
    if (typeof preset !== "string" || !POKE_PRESETS.includes(preset)) throw new Error("Unknown poke.");
    const room = roomOf(socket);
    const targets = [...(connections.get(room) ?? [])].filter((member) => person(member).id === id);
    if (!targets.length || targets.some((member) => person(member).staff)) throw new Error("Person not found.");
    const key = `${room}\0${String(id)}`;
    const now = Date.now();
    if (now - (lastPoke.get(key) ?? 0) < POKE_GAP_MS) return;
    lastPoke.set(key, now);
    if (lastPoke.size > 5000) for (const [entry, at] of lastPoke) if (now - at > POKE_GAP_MS) lastPoke.delete(entry);
    for (const member of targets) deliver(member, { poke: { from: sender.id, name: sender.name, preset } });
}
export function handleRoomChat(socket: PusherWebSocket, event: PublicEventFrontToPusher): boolean {
    if (event.spaceName !== `${socket.getUserData().world}.${chatSpace}`) return false;
    if (socket.isDisconnecting()) return true;
    const payload = event.spaceEvent?.event;
    if (payload?.$case !== "spaceMessage") return true;
    // Apart from the commands' budget: reacting a lot must not use up a student's chat.
    if (payload.spaceMessage.message.startsWith('{"op":"activity"')) {
        relayActivity(socket, payload.spaceMessage.message);
        return true;
    }
    const session = roomSessions.get(roomOf(socket));
    // Limits are shared by every tab and URL spelling for this account and room.
    const sender = person(socket);
    if (!session.acceptCommand(sender.id, sender.staff ? 60 : 10)) {
        const ref = refOfRaw(payload.spaceMessage.message);
        deliver(socket, { retryAfterMs: session.retryAfter(sender.id), ...(ref && { ref }) });
        return true;
    }
    let ref: string | undefined;
    try {
        if (payload.spaceMessage.message.length > 25000) throw new Error("Message too large.");
        const command: unknown = JSON.parse(payload.spaceMessage.message);
        if (!command || typeof command !== "object") throw new Error("Invalid command.");
        ref = refOf(command);
        const input = Object.fromEntries(Object.entries(command));
        if (input.op === "sync") {
            synced.add(socket);
            if (session.acceptSync(person(socket).id)) snapshot(socket);
            else deliver(socket, { retryAfterMs: 5000 });
        } else if (input.op === "send") {
            const to = input.to === undefined ? undefined : recipient(roomOf(socket), input.to, person(socket));
            if (input.to !== undefined && !to) throw new Error("That person is not in the room.");
            const group = groupOf(roomOf(socket), input.group, person(socket));
            const readers = to ? [to.id] : (group?.map((member) => member.id) ?? []);
            const named = mentioned(roomOf(socket), input.mentions, input.body, person(socket), to);
            const message = session.send(
                person(socket),
                input.body,
                to,
                group ? named.filter((member) => readers.includes(member.id)) : named,
                { group, together: together(roomOf(socket), socket, readers) },
            );
            broadcast(socket, { append: message }, ref, message);
            appendRoomChat(roomOf(socket), message, CHAT_OCCUPIED_TTL_MS, session.startedAt);
            forwardTranscriptLine(socket.getUserData().roomId, { op: "send", message });
        } else if (input.op === "edit") {
            // Only messages this person may see are touched at all, here and in the session.
            const saved = session.messages.find(
                (entry) => entry.id === input.id && messageVisibleTo(entry, person(socket).id),
            );
            if (saved) settleReaction(roomOf(socket), input.id);
            const before = saved && { ...saved };
            const to =
                saved?.to === undefined
                    ? undefined
                    : recipient(
                          roomOf(socket),
                          saved.sender === person(socket).id ? saved.to : saved.sender,
                          person(socket),
                      );
            const named = saved ? mentioned(roomOf(socket), input.mentions, input.body, person(socket), to) : [];
            const edited = session.edit(
                person(socket),
                input.id,
                input.body,
                saved?.group
                    ? named.filter((member) => member.id === saved.sender || saved.group?.some((reader) => reader.id === member.id))
                    : named,
            );
            if (edited && before) {
                broadcast(socket, { edited }, ref, edited);
                editRoomChat(roomOf(socket), before, edited, CHAT_OCCUPIED_TTL_MS, session.startedAt);
                forwardTranscriptLine(socket.getUserData().roomId, { op: "edit", message: edited });
                if (session.pins.some((pin) => pin.id === edited.id)) publishPins(roomOf(socket));
            } else if (saved) {
                // Nothing to change: taken as it is.
                if (ref) deliver(socket, { ref });
            } else {
                // Gone, or never this person's to see: the same answer either way, so the edit doesn't wait forever.
                deliver(socket, { notice: "This message can no longer be edited.", ...(ref && { ref }) });
            }
        } else if (input.op === "react") {
            const saved = session.messages.find(
                (entry) => entry.id === input.id && messageVisibleTo(entry, person(socket).id),
            );
            const before = saved && { ...saved };
            const reacted = session.react(person(socket), input.id, input.emoji);
            if (reacted && before) queueReaction(roomOf(socket), reacted, before);
        } else if (input.op === "delete") {
            if (session.messages.some((entry) => entry.id === input.id && messageVisibleTo(entry, person(socket).id)))
                settleReaction(roomOf(socket), input.id);
            const pinsBefore = session.pins.length;
            const deleted = session.delete(person(socket), input.id);
            if (deleted) {
                broadcast(socket, { deleted: deleted.id }, undefined, deleted);
                deleteRoomChat(roomOf(socket), deleted, CHAT_OCCUPIED_TTL_MS);
                forwardTranscriptLine(socket.getUserData().roomId, { op: "delete", message: deleted });
                if (session.pins.length !== pinsBefore) publishPins(roomOf(socket));
            }
        } else if (input.op === "poke") {
            poke(socket, input.id, input.preset);
            if (ref) deliver(socket, { ref });
        } else if (input.op === "pin") {
            if (session.pin(person(socket), input.id, input.on)) publishPins(roomOf(socket));
            else if (ref) deliver(socket, { ref });
        } else if (input.op === "moderate") {
            const targets = [...(connections.get(roomOf(socket)) ?? [])].filter(
                (member) => person(member).id === input.id,
            );
            const activeTarget = targets.find((member) => person(member).staff) ?? targets[0];
            const target = activeTarget ? person(activeTarget) : session.removed.get(String(input.id));
            const before = JSON.stringify({
                muted: [...session.muted],
                cameraOff: [...session.cameraOff],
                removed: [...session.removed],
            });
            const action = session.moderate(person(socket), input.action, target);
            for (const member of targets) {
                if (action === "mute_mic" || action === "mute_camera") muteAtServer(member, action);
                if (action === "remove") removeNotice(member);
                if (action === "mute_mic" || action === "mute_camera")
                    queueRoomEvent(member, {
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
                                        action === "mute_mic"
                                            ? { $case: "muteAudio", muteAudio: { force: true } }
                                            : { $case: "muteVideo", muteVideo: { force: true } },
                                },
                            },
                        },
                    });
            }
            if (
                before !==
                JSON.stringify({
                    muted: [...session.muted],
                    cameraOff: [...session.cameraOff],
                    removed: [...session.removed],
                })
            ) {
                publishRoomModeration(socket);
                persist(roomOf(socket));
            }
        } else throw new Error("Invalid command.");
    } catch (error) {
        deliver(socket, { notice: asError(error).message, ...(ref && { ref }) });
    }
    return true;
}
