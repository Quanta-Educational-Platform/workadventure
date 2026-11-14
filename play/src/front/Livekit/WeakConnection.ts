// quanta: whether this browser's own link to LiveKit is weak (LiveKit rates it Poor or Lost for a while). The call then
// keeps audio first: incoming cameras drop to their lowest layer (LivekitParticipant) and the own camera sends what WA
// budgets for 180p (CameraCap), until the link has been good again for a while. Screen sharing is left alone: slides must stay
// legible, and adaptive stream already sizes it.
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

export interface WeakConnectionTracker {
    update(quality: ConnectionQuality): void;
    stop(): void;
}

/** `own`: this browser's link, which the camera and screen share caps follow; another person's only reports. */
export function createWeakConnectionTracker(
    onChange: (weak: boolean) => void,
    { own = true }: { own?: boolean } = {},
): WeakConnectionTracker {
    const room = {};
    let weak = false;
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
            if (own) setRoomWeak(room, target);
            if (own && !target) linkRecoveredStore.update((count) => count + 1);
            onChange(target);
        }, delayMs);
    };

    return {
        update(quality) {
            if (quality === ConnectionQuality.Poor || quality === ConnectionQuality.Lost) settle(true, ENTER_MS);
            else if (quality === ConnectionQuality.Good || quality === ConnectionQuality.Excellent)
                settle(false, LEAVE_MS);
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
