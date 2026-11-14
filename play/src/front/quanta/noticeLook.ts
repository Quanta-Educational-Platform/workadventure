// quanta: how a WA notification (Stores/NotificationStore.ts) looks as one of the room's notices (Notice.svelte): WA's
// icon keys as the room's line icons, and the kind of notice each one is when the caller did not say.
import type { Notification } from "../Stores/NotificationStore";
import type { IconName } from "./icons";

/** What kind of notice it is, which only its icon's colour says: information, your move, something wrong, recording. */
export type NoticeTone = "info" | "action" | "problem" | "recording";

const LOOKS: Record<string, { icon: IconName | "rec"; tone: NoticeTone }> = {
    "microphone-off.png": { icon: "micOff", tone: "info" },
    "camera-off.png": { icon: "videocamOff", tone: "info" },
    megaphone: { icon: "campaign", tone: "action" },
    "icon-tool-area.png": { icon: "navigation", tone: "info" },
    "recording-start": { icon: "rec", tone: "recording" },
    "recording-stop": { icon: "rec", tone: "recording" },
    "quanta-mic": { icon: "mic", tone: "action" },
    "quanta-camera": { icon: "videocam", tone: "action" },
    "quanta-attention": { icon: "bellRing", tone: "action" },
    "quanta-problem": { icon: "info", tone: "problem" },
    "quanta-removed": { icon: "userX", tone: "info" },
};

export function notificationLook(notification: Notification): { icon: IconName | "rec"; tone: NoticeTone } {
    const look = LOOKS[notification.icon ?? ""] ?? { icon: "info" as const, tone: "info" as const };
    return { icon: look.icon, tone: notification.tone ?? look.tone };
}

export interface StackedNotice {
    key: string;
    /** Its height on screen, in CSS pixels. */
    height: number;
    /** Plain information: the first to give way. */
    info: boolean;
    /** Never kept out of sight: the recording's notices. */
    pinned: boolean;
}

/**
 * Which of the room's notices (oldest first) are kept out of sight: beyond `max` at once, information gives way, oldest
 * first; then, while the stack is taller than `room`, information and then the older of the rest. The recording's
 * notices and the newest notice that is not information always show, in full, whatever room is left.
 */
export function noticesKeptOut(notices: readonly StackedNotice[], max: number, room: number, gap: number): Set<string> {
    const out = new Set<string>();
    const newestOther = [...notices].reverse().find((notice) => !notice.info)?.key;
    const kept = (notice: StackedNotice) => notice.pinned || notice.key === newestOther;
    const shown = () => notices.filter((notice) => !out.has(notice.key));
    const height = () => {
        const list = shown();
        return list.reduce((sum, notice) => sum + notice.height, 0) + gap * Math.max(0, list.length - 1);
    };
    const giveWay = (fits: () => boolean, passes: boolean[]) => {
        for (const pass of passes) {
            for (const notice of notices) {
                if (fits()) return;
                if (out.has(notice.key) || kept(notice) || notice.info !== pass) continue;
                out.add(notice.key);
            }
        }
    };
    // The count gives way only for information; the height, after it, for the older of the rest too.
    giveWay(() => shown().length <= max, [true]);
    giveWay(() => height() <= room, [true, false]);
    return out;
}
