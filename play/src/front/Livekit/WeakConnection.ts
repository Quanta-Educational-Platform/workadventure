// quanta: whether this browser's own link to LiveKit is weak (LiveKit rates it Poor or Lost for a while). The call then
// keeps audio first: incoming cameras drop to their lowest layer (LivekitParticipant) and the own camera sends what WA
// budgets for 180p (CameraCap), until the link has been good again for a while. A screen share sends few frames or its
// lowest layer (ScreenShareCap).
import { ConnectionQuality } from "livekit-client";
import { derived, writable } from "svelte/store";

/** Poor for this long before video steps down: one bad report is not a weak link. */
const ENTER_MS = 6_000;
/** Good for this long before video comes back, so a link that flaps does not flap the video with it. */
const LEAVE_MS = 20_000;

// Several LiveKit rooms can be open at once (a bubble and a megaphone space); the link is weak if any of them says so.
const weakRooms = writable(new Set<object>());

export const weakConnectionStore = derived(weakRooms, (rooms) => rooms.size > 0);

/** quanta: counts the times this browser's own link came back good (not a call left while weak), for the notice. */
export const linkRecoveredStore = writable(0);

function setRoomWeak(room: object, weak: boolean): void {
    weakRooms.update((rooms) => {
        if (rooms.has(room) === weak) return rooms;
        const next = new Set(rooms);
        if (weak) next.add(room);
        else next.delete(room);
        return next;
    });
}

let heldUntil = 0;

/** A link test fills the link on purpose: what this browser's link looks like meanwhile is no verdict on it. */
export function holdWeakVerdicts(ms: number): void {
    heldUntil = Math.max(heldUntil, Date.now() + ms);
}

export interface WeakConnectionTracker {
    update(quality: ConnectionQuality): void;
    stop(): void;
}

/** Back off this far at most for a link that keeps going weak again (`backOff`). */
const LEAVE_MAX_MS = 160_000;
/** Good this long after leaving and the back-off starts over. */
const BACK_OFF_RESET_MS = 5 * 60_000;

/**
 * `own`: this browser's link, which the camera and screen share caps follow; another person's only reports.
 * `backOff`: each time the link goes weak again soon after it came back, it must stay good twice as long to leave, so
 * a link that carries the slowed share but not the full one doesn't flip it (and every incoming camera) back and forth.
 */
export function createWeakConnectionTracker(
    onChange: (weak: boolean) => void,
    { own = true, backOff = false }: { own?: boolean; backOff?: boolean } = {},
): WeakConnectionTracker {
    const room = {};
    let weak = false;
    let leaveMs = LEAVE_MS;
    let leftAt = 0;
    let pending: boolean | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const clear = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        pending = undefined;
    };

    const settle = (target: boolean, delayMs: number) => {
        if (weak === target) {
            clear();
            return;
        }
        if (pending === target) return;
        clear();
        pending = target;
        timer = setTimeout(() => {
            timer = undefined;
            pending = undefined;
            weak = target;
            if (backOff) {
                if (target) leaveMs = Date.now() - leftAt < BACK_OFF_RESET_MS ? Math.min(LEAVE_MAX_MS, leaveMs * 2) : LEAVE_MS;
                else leftAt = Date.now();
            }
            if (own) setRoomWeak(room, target);
            if (own && !target) linkRecoveredStore.update((count) => count + 1);
            onChange(target);
        }, delayMs);
    };

    return {
        update(quality) {
            if (own && Date.now() < heldUntil) {
                if (pending === true) clear();
                return;
            }
            if (quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost) settle(true, ENTER_MS);
            else if (quality === ConnectionQuality.Good || quality === ConnectionQuality.Excellent)
                settle(false, leaveMs);
            // Neither: a pending step down waits for the next bad report, not just the first one.
            else if (pending === true) clear();
        },
        stop() {
            clear();
            if (weak) {
                weak = false;
                if (own) setRoomWeak(room, false);
                onChange(false);
            }
        },
    };
}
