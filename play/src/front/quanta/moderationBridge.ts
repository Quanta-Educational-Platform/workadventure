import { z } from "zod";
import { QUANTA_URL } from "../Enum/EnvironmentVariable";

const person = z.object({ id: z.string(), name: z.string(), staff: z.boolean() });
const message = z.object({ id: z.string(), sender: z.string(), name: z.string(), body: z.string(), at: z.number() });
const roomState = z.object({
    self: z.string(),
    canModerate: z.boolean(),
    people: z.array(person),
    muted: z.array(z.string()),
    removed: z.array(person),
});
export const roomSnapshot = roomState.extend({
    quanta: z.literal(1),
    messages: z.array(message).max(100),
    notice: z.string().optional(),
});
export type RoomSnapshot = z.infer<typeof roomSnapshot>;
const roomUpdate = z.union([
    roomSnapshot,
    z.object({ quanta: z.literal(1), append: message }),
    z.object({ quanta: z.literal(1), deleted: z.string() }),
    z.object({ quanta: z.literal(1), state: roomState }),
    z.object({ quanta: z.literal(1), notice: z.string() }),
]);
export function applyRoomUpdate(previous: RoomSnapshot | undefined, raw: unknown): RoomSnapshot | undefined {
    const parsed = roomUpdate.safeParse(raw);
    if (!parsed.success) return previous;
    const update = parsed.data;
    if ("messages" in update) return update;
    if ("state" in update) return { quanta: 1, messages: previous?.messages ?? [], ...update.state };
    if (!previous) return undefined;
    if ("notice" in update) return { ...previous, notice: update.notice };
    if ("deleted" in update)
        return {
            ...previous,
            notice: undefined,
            messages: previous.messages.filter((entry) => entry.id !== update.deleted),
        };
    return {
        ...previous,
        notice: undefined,
        messages: [...previous.messages.filter((entry) => entry.id !== update.append.id), update.append].slice(-100),
    };
}
export function roomSyncRetry(send: () => void, signal: AbortSignal): (raw: unknown) => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
    return (raw) => {
        const retry = z.object({ retryAfterMs: z.number().min(1000).max(10000) }).safeParse(raw);
        if (!retry.success || timer !== undefined || signal.aborted) return;
        timer = setTimeout(() => {
            timer = undefined;
            if (!signal.aborted) send();
        }, retry.data.retryAfterMs);
    };
}
const moderationCommand = z.object({
    type: z.literal("quanta_wa_moderate"),
    id: z.string().min(1).max(200),
    action: z.enum(["mute_chat", "unmute_chat", "mute_mic", "remove", "allow_back"]),
});
export function startModerationBridge(send: (command: object) => void, signal: AbortSignal) {
    let origin: string | undefined;
    try {
        origin = new URL(document.referrer || QUANTA_URL || "").origin;
    } catch {
        /* No parent origin configured. */
    }
    let last: RoomSnapshot | undefined;
    const publish = () => {
        if (!origin || !last || window.parent === window) return;
        window.parent.postMessage(
            {
                type: "quanta_wa_moderation",
                self: last.self,
                canModerate: last.canModerate,
                people: last.people,
                muted: last.muted,
                removed: last.removed,
                notice: last.notice,
            },
            origin,
        );
    };
    const receive = (event: MessageEvent) => {
        if (event.source !== window.parent || event.origin !== origin) return;
        if (event.data?.type === "quanta_wa_moderation_request") {
            send({ op: "sync" });
            return;
        }
        const command = moderationCommand.safeParse(event.data);
        if (command.success && last?.canModerate)
            send({ op: "moderate", action: command.data.action, id: command.data.id });
    };
    window.addEventListener("message", receive, { signal });
    signal.addEventListener("abort", () => window.removeEventListener("message", receive), { once: true });
    return (snapshot: RoomSnapshot) => {
        last = snapshot;
        publish();
    };
}
