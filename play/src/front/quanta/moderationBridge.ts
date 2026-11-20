import { z } from "zod";
import { derived, get, writable } from "svelte/store";
import { fromPlatform, onPlatformOriginLearned, platformOrigin } from "./platformOrigin";
import { mayBlockOrReport, setRoomStaff } from "./staffTargets";
import { moderationInView, studentViewStore } from "./studentView";

const person = z.object({ id: z.string(), name: z.string(), staff: z.boolean() });
const message = z.object({
    id: z.string(),
    sender: z.string(),
    name: z.string(),
    body: z.string(),
    at: z.number(),
    edited: z.boolean().optional(),
    reactions: z.record(z.string(), z.array(z.object({ id: z.string(), name: z.string() }))).optional(),
    // Who it names with @ (mentions.ts), as the room's server knew them.
    mentions: z
        .array(z.object({ id: z.string(), name: z.string() }))
        .max(20)
        .optional(),
    // A direct message: its other person. Kept apart from the class chat (directMessages.ts).
    to: z.string().optional(),
    toName: z.string().optional(),
    // A group's message (a bubble of three or more): its readers besides the sender. Never the class's.
    group: z
        .array(z.object({ id: z.string(), name: z.string() }))
        .min(2)
        .max(20)
        .optional(),
});
const roomState = z.object({
    self: z.string(),
    canModerate: z.boolean(),
    people: z.array(person),
    muted: z.array(z.string()),
    // Students whose camera staff turned off and keep off (missing from an older room's server).
    cameraOff: z.array(z.string()).optional(),
    removed: z.array(person),
});
export const roomSnapshot = roomState.extend({
    quanta: z.literal(1),
    // The class chat's 100 and up to 200 direct messages (common/quanta/RoomSession.ts).
    messages: z.array(message).max(300),
    // The class messages staff pinned at the top of the chat, newest pin first (pinnedMessages.ts).
    pins: z.array(message).max(5).optional(),
    notice: z.string().optional(),
});
export type RoomSnapshot = z.infer<typeof roomSnapshot>;
export type RoomState = z.infer<typeof roomState>;
const roomUpdate = z.union([
    roomSnapshot,
    z.object({ quanta: z.literal(1), append: message }),
    z.object({ quanta: z.literal(1), deleted: z.string() }),
    z.object({ quanta: z.literal(1), edited: message }),
    z.object({ quanta: z.literal(1), state: roomState }),
    z.object({ quanta: z.literal(1), notice: z.string() }),
    z.object({ quanta: z.literal(1), pins: z.array(message).max(5) }),
]);
export function applyRoomUpdate(previous: RoomSnapshot | undefined, raw: unknown): RoomSnapshot | undefined {
    const parsed = roomUpdate.safeParse(raw);
    if (!parsed.success) return previous;
    const update = parsed.data;
    if ("messages" in update) return update;
    if ("state" in update)
        return { quanta: 1, messages: previous?.messages ?? [], pins: previous?.pins, ...update.state };
    if (!previous) return undefined;
    if ("notice" in update) return { ...previous, notice: update.notice };
    if ("pins" in update) return { ...previous, pins: update.pins };
    if ("edited" in update)
        return {
            ...previous,
            notice: undefined,
            messages: previous.messages.map((entry) => (entry.id === update.edited.id ? update.edited : entry)),
        };
    if ("deleted" in update)
        return {
            ...previous,
            notice: undefined,
            messages: previous.messages.filter((entry) => entry.id !== update.deleted),
        };
    return {
        ...previous,
        notice: undefined,
        messages: keepRecent([...previous.messages.filter((entry) => entry.id !== update.append.id), update.append]),
    };
}
/** The newest 100 class messages and 200 direct ones, in order: direct messages never push the class chat out. */
function keepRecent(messages: RoomSnapshot["messages"]): RoomSnapshot["messages"] {
    let classLeft = 100;
    let directLeft = 200;
    const kept: RoomSnapshot["messages"] = [];
    for (let i = messages.length - 1; i >= 0; i--) {
        const direct = messages[i].to !== undefined || messages[i].group !== undefined;
        if (direct ? directLeft-- > 0 : classLeft-- > 0) kept.push(messages[i]);
    }
    return kept.reverse();
}
/** Whether the teacher muted this person in the room's chat, and the notice the chat shows them, if any. */
export function roomChatStatus(snapshot: RoomSnapshot): { muted: boolean; notice: string | undefined } {
    const muted = snapshot.muted.includes(snapshot.self);
    // A muted person's composer already says why: the server's refusal of a message sent as the mute landed would
    // only repeat it, in the server's English.
    return { muted, notice: muted ? undefined : snapshot.notice };
}
export function roomSyncRetry(send: () => void, signal: AbortSignal): (raw: unknown) => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    return (raw) => {
        const retry = z.object({ retryAfterMs: z.number().min(1000).max(10000), ref: z.undefined() }).safeParse(raw);
        // A refused command with a reference is the outbox's to send again (roomChatOutbox.ts), not a missed sync.
        if (!retry.success || timer !== undefined || signal.aborted) return;
        timer = setTimeout(() => {
            timer = undefined;
            if (!signal.aborted) send();
        }, retry.data.retryAfterMs);
    };
}
const moderationAction = z.enum([
    "mute_chat",
    "unmute_chat",
    "mute_mic",
    "mute_camera",
    "allow_camera",
    "remove",
    "allow_back",
]);
export type ModerationAction = z.infer<typeof moderationAction>;
const moderationCommand = z.object({
    type: z.literal("quanta_wa_moderate"),
    id: z.string().min(1).max(200),
    action: moderationAction,
});
const reportRequest = z.object({
    type: z.literal("quanta_wa_report"),
    id: z.string().min(1).max(200),
    name: z.string().max(120),
});

/** The room's people, staff and chat mutes as last heard: the menu on a video tile reads them. */
export const roomModerationStore = writable<RoomState | undefined>(undefined);
/** Staff turned this person's camera off and keep it off: the room's server only does that to students. */
export const cameraHeldStore = derived(
    roomModerationStore,
    (room) => !!room && (room.cameraOff ?? []).includes(room.self),
);
/** Only the platform reaches the room script that says who draws on the teacher's board; it says when it can. */
export const platformLetsDrawStore = writable(false);
let roomCommand: ((command: object) => void) | undefined;

/** What the people list asks for, asked from inside the room: the room's server checks the rights again. */
export function moderatePerson(action: ModerationAction, id: string): void {
    if (get(roomModerationStore)?.canModerate) roomCommand?.({ op: "moderate", action, id });
}

/** A teacher's nudge to a student (a toast and a sound on their screen): the room's server checks the rights again. */
export const POKE_PRESETS = ["answer", "microphone", "camera", "attention"] as const;
export type PokePreset = (typeof POKE_PRESETS)[number];
export function pokePerson(id: string, preset: PokePreset): void {
    if (get(roomModerationStore)?.canModerate) roomCommand?.({ op: "poke", id, preset });
}
const pokeRequest = z.object({
    type: z.literal("quanta_wa_poke"),
    id: z.string().min(1).max(200),
    preset: z.enum(POKE_PRESETS),
});

export function askPlatformToLetDraw(id: string, allow: boolean): void {
    const origin = platformOrigin();
    if (origin && window.parent !== window)
        window.parent.postMessage(
            { type: "quanta_wa_person_action", action: allow ? "let_draw" : "stop_drawing", id },
            origin,
        );
}

/** `report`: opens blocking or reporting someone, asked for from the platform's people list. */
export function startModerationBridge(
    send: (command: object) => void,
    signal: AbortSignal,
    report?: (id: string, name: string) => void,
) {
    let last: RoomSnapshot | undefined;
    roomCommand = send;
    const publish = () => {
        const origin = platformOrigin();
        if (!origin || !last || window.parent === window) return;
        window.parent.postMessage(
            {
                type: "quanta_wa_moderation",
                // The person menu's whole set (mute_camera, quanta_wa_report): an older room has neither.
                personMenu: 1,
                // This room can poke (pokePerson): the platform's people list offers Poke only when it sees this.
                poke: 1,
                self: last.self,
                canModerate: moderationInView(last.canModerate, get(studentViewStore)),
                people: last.people,
                muted: last.muted,
                // This room keeps a turned-off camera off until staff allow it (allow_camera).
                cameraOff: last.cameraOff ?? [],
                removed: last.removed,
                notice: last.notice,
            },
            origin,
        );
    };
    const receive = (event: MessageEvent) => {
        if (!fromPlatform(event)) return;
        if (event.data?.type === "quanta_wa_moderation_request") {
            send({ op: "sync" });
            return;
        }
        if (event.data?.type === "quanta_wa_person_menu") {
            platformLetsDrawStore.set(event.data.letDraw === true);
            return;
        }
        const reportAsked = reportRequest.safeParse(event.data);
        if (reportAsked.success) {
            if (last && !last.canModerate && mayBlockOrReport({ uuid: reportAsked.data.id }))
                report?.(reportAsked.data.id, reportAsked.data.name);
            return;
        }
        const pokeAsked = pokeRequest.safeParse(event.data);
        if (pokeAsked.success) {
            if (last?.canModerate) send({ op: "poke", id: pokeAsked.data.id, preset: pokeAsked.data.preset });
            return;
        }
        const command = moderationCommand.safeParse(event.data);
        if (command.success && last?.canModerate)
            send({ op: "moderate", action: command.data.action, id: command.data.id });
    };
    window.addEventListener("message", receive, { signal });
    const stopRepublishing = onPlatformOriginLearned(publish);
    signal.addEventListener(
        "abort",
        () => {
            window.removeEventListener("message", receive);
            stopRepublishing();
            if (roomCommand === send) {
                roomCommand = undefined;
                roomModerationStore.set(undefined);
            }
        },
        { once: true },
    );
    const offer = () => {
        if (!last) return;
        const { self, canModerate, people, muted, cameraOff, removed } = last;
        roomModerationStore.set({
            self,
            canModerate: moderationInView(canModerate, get(studentViewStore)),
            people,
            muted,
            cameraOff,
            removed,
        });
        publish();
    };
    // Lives as long as the page.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    studentViewStore.subscribe(offer);
    return (snapshot: RoomSnapshot) => {
        last = snapshot;
        setRoomStaff(snapshot.people);
        offer();
    };
}
