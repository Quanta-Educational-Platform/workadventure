// quanta: in a class (QUANTA_UI) only the room's admins (the `admin` tag Quanta gives course staff) get the map's
// editor and explorer and ask others to follow; students would only wander off with them. Upstream rules otherwise.

export function mapEditorEntryVisible(quantaUi: boolean, upstreamVisible: boolean, isAdmin: boolean): boolean {
    return upstreamVisible && (!quantaUi || isAdmin);
}

export function mapExplorerEntryVisible(quantaUi: boolean, mapManagerActivated: boolean, isAdmin: boolean): boolean {
    return mapManagerActivated && (!quantaUi || isAdmin);
}

/** "Stop following" stays while a follow is on, so nobody is left stuck to a leader. */
export function followEntryVisible(quantaUi: boolean, upstreamVisible: boolean, following: boolean): boolean {
    return quantaUi ? following : upstreamVisible;
}

/**
 * The ⋮ menu's entries. A class keeps device settings and the avatar; the rest is elsewhere or of no use in a lesson:
 * the room link, people and messages are in Quanta's page, Explore (and the map's editors through it) in the zoom
 * column, global messages in the settings, recording in the page's header; statuses, companions, desks, WA's apps and
 * installing WA as an app have no part in a class, and names come from Quanta.
 */
export type ProfileMenuEntry =
    | "status"
    | "name"
    | "avatar"
    | "companion"
    | "issueReport"
    | "settings"
    | "apps"
    | "recording"
    | "rightBar"
    | "installApp";

const CLASS_MENU_ENTRIES: ReadonlySet<ProfileMenuEntry> = new Set(["avatar", "settings"]);

export function profileMenuEntryVisible(quantaUi: boolean, entry: ProfileMenuEntry, upstreamVisible = true): boolean {
    return upstreamVisible && (!quantaUi || CLASS_MENU_ENTRIES.has(entry));
}

/** A locked table shuts the teacher out: in a class nobody locks, but "Unlock" stays while something is locked. */
export function lockEntryVisible(quantaUi: boolean, upstreamVisible: boolean, locked: boolean): boolean {
    return upstreamVisible && (!quantaUi || locked);
}

/** How far the emoji panel keeps from the frame's edges, to clear the zoom column. */
const EMOJI_PANEL_PADDING = 84;
const EMOJI_PANEL_MIN_PADDING = 8;

/** In a frame too narrow to clear the zoom column the panel stays whole instead, over the column. */
export function emojiPanelPadding(frameWidth: number, panelWidth: number): number {
    const spare = (frameWidth - panelWidth) / 2;
    return Math.max(EMOJI_PANEL_MIN_PADDING, Math.min(EMOJI_PANEL_PADDING, spare));
}
