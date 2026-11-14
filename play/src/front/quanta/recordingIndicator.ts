// quanta: whether the room shows its own recording indicator, and what it says. The room script (web
// public/wa/quanta-button.js) puts a "quanta-recording" button in WA's top bar while a lesson records; everyone in the
// room must always see one. The platform's page around the room shows it in its header and says so
// ("quanta_wa_recording_indicator", roomBridge.ts): from then on the room leaves it to the page, except while the room
// fills the screen (its Fullscreen setting), which hides the page's header. Until then (a page from before that word,
// or the room in its own tab) the room shows its own, in the dock's row (QuantaDock.svelte) or
// the chat's head while a chat covers the room (ChatPanelHeader.svelte). Staff in an older page had the header's
// control and no pill; that rule stays for them.
import { derived, readable, writable, type Readable } from "svelte/store";
import { additionalRightButtonsMenu } from "../Stores/MenuStore";
import { userIsAdminStore } from "../Stores/GameStore";
import { studentViewStore } from "./studentView";

export const RECORDING_BUTTON = "quanta-recording";

const platformShowsStore = writable(false);

/**
 * The room's own document fills the screen (its Fullscreen setting fullscreens the document or its body): whatever the
 * page around it shows is out of sight. A single element filling the screen is not this: a video there is drawn alone,
 * and nothing, an indicator included, can be drawn over it.
 */
const fullscreenStore = readable(false, (set) => {
    if (typeof document === "undefined") return;
    const doc = document as Document & { webkitFullscreenElement?: Element | null };
    const update = () => {
        const element = doc.fullscreenElement ?? doc.webkitFullscreenElement;
        set(element === document.documentElement || element === document.body);
    };
    update();
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
    return () => {
        document.removeEventListener("fullscreenchange", update);
        document.removeEventListener("webkitfullscreenchange", update);
    };
});

/** The page around the room shows the recording in its own header. */
export function platformShowsRecording(): void {
    platformShowsStore.set(true);
}

export interface RoomRecordingIndicator {
    paused: boolean;
    /** The room script's own words, in the room's language ("Recording", "Запис на паузі"). */
    label: string;
    tip: string | undefined;
}

export const roomRecordingIndicatorStore: Readable<RoomRecordingIndicator | undefined> = derived(
    [additionalRightButtonsMenu, platformShowsStore, userIsAdminStore, studentViewStore, fullscreenStore],
    ([$buttons, $platformShows, $admin, $studentView, $fullscreen]) => {
        const button = $buttons.find((entry) => entry.id === RECORDING_BUTTON);
        if (!button) return undefined;
        if (!$fullscreen && $platformShows) return undefined;
        if (!$fullscreen && window.parent !== window && $admin && !$studentView) return undefined;
        const props = (button.props as { button?: { label?: unknown; tooltipTitle?: unknown } }).button;
        const raw = typeof props?.label === "string" ? props.label : "";
        return {
            // The script's label starts with "●" (recording) or "⏸" (paused) for a WA without this indicator.
            paused: raw.startsWith("⏸"),
            label: raw.replace(/^[●⏸]\s*/u, ""),
            tip: typeof props?.tooltipTitle === "string" ? props.tooltipTitle : undefined,
        };
    },
);

/**
 * Whether the room records, as the room script's button says (only a map script can add it): what the room tells the
 * page around it (roomBridge.ts), so the page need not take a frame inside the room at its word.
 */
export const roomRecordingStateStore: Readable<{ active: boolean; paused: boolean }> = derived(
    additionalRightButtonsMenu,
    ($buttons) => {
        const button = $buttons.find((entry) => entry.id === RECORDING_BUTTON);
        const label = (button?.props as { button?: { label?: unknown } } | undefined)?.button?.label;
        return { active: !!button, paused: !!button && typeof label === "string" && label.startsWith("⏸") };
    },
);
