import { writable } from "svelte/store";
import type { IconName } from "./icons";

/** What the dock gives up first when its row can't hold every button: each step folds one more into ⋮. Devices last:
 *  their arrows only hide, as Audio and video settings is already in ⋮. */
export const DOCK_FOLDS = ["reactions", "hand", "share", "devices"] as const;
export type DockFold = (typeof DOCK_FOLDS)[number] | "megaphone";

/** A phone's row holds six round buttons (microphone, camera, hand, chat, ⋮, leave), never squeezed: the rest are
 *  in ⋮ from the start, the megaphone only while it isn't on air (lit, it stays in reach to stop). */
export const PHONE_FOLDS: readonly DockFold[] = ["reactions", "share", "devices", "megaphone"];

export interface FoldedAction {
    key: Exclude<DockFold, "devices">;
    label: string;
    icon: IconName;
    pressed?: boolean;
    disabled?: boolean;
    run: () => void;
}

/** The buttons folded out of the dock, shown at the top of ⋮ (DockFoldedItems.svelte). */
export const dockFoldedStore = writable<FoldedAction[]>([]);
