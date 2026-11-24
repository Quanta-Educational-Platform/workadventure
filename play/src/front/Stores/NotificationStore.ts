import { writable } from "svelte/store";
import { v4 as uuid } from "uuid";

export type Notification = {
    id: string;
    text: string;
    icon?: string;
    /** quanta: how long it stays up; WA's own last 5 s. */
    durationMs?: number;
    /** quanta: who it is from, shown in bold before the text (a teacher's poke). */
    lead?: string;
    /** quanta: what kind of notice it is (quanta/Notice.svelte); otherwise told from its icon. */
    tone?: "info" | "action" | "problem" | "recording";
    /** quanta: one button on the notice (its label and what it does); pressing it also closes the notice. */
    action?: { label: string; run: () => void };
};

export const NOTIFICATION_MS = 5000;
/** quanta: long enough to read two sentences (the teacher stopping a student speaking to the class). */
export const LONG_NOTIFICATION_MS = 9000;

/**
 * Store for playing notifications
 */
function createNotificationStore() {
    const { subscribe, update } = writable<Set<Notification>>(new Set());

    return {
        subscribe,
        playNotification: (
            text: string,
            icon?: string,
            id?: string,
            durationMs?: number,
            extra?: Pick<Notification, "lead" | "tone" | "action">,
        ) => {
            const notification: Notification = {
                id: id ?? uuid(),
                text,
                icon,
                ...(durationMs === undefined ? {} : { durationMs }),
                ...extra,
            };
            update((list) => {
                list.add(notification);
                return list;
            });
            // Its own timer, whether or not it is on screen: dismissing another never restarts it.
            setTimeout(() => {
                update((list) => {
                    list.delete(notification);
                    return list;
                });
            }, durationMs ?? NOTIFICATION_MS);
        },
        removeNotification(notification: Notification) {
            update((list) => {
                list.delete(notification);
                return list;
            });
        },
        removeNotificationById(id: string) {
            update((list) => {
                const notification = Array.from(list).find((n) => n.id === id);
                if (notification) {
                    list.delete(notification);
                }
                return list;
            });
        },
        clearAllNotification: () => {
            update((list) => {
                list.clear();
                return list;
            });
        },
    };
}

export const notificationPlayingStore = createNotificationStore();
