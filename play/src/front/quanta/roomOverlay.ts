// quanta: whether the room shows something over its map that the person is using: the emoji picker, a dock tray, a
// menu, the settings dialog, a modal or a pop-up. The platform hides a presented board it lays over the map on a phone
// while one is open (roomBridge.ts), or the picker would open under the board.
import { derived, writable } from "svelte/store";
import { activeSecondaryZoneActionBarStore, menuVisiblilityStore, openedMenuStore } from "../Stores/MenuStore";
import { modalVisibilityStore } from "../Stores/ModalStore";
import { popupStore } from "../Stores/PopupStore";

/** The dock's microphone or camera tray is open (QuantaDock.svelte). */
export const dockTrayOpenStore = writable(false);

/** How many people's menus (a call tile's arrow, VideoMediaBox.svelte) are open: the platform hides a presented board
 * in place while one is (roomBridge.ts), without laying the stage out again, which would close the menu. */
const tileMenus = writable(0);
export const tileMenuOpenStore = derived(tileMenus, ($n) => $n > 0);
/** A call tile's menu opened; the returned function says it closed. */
export function tileMenuOpened(): () => void {
    tileMenus.update((n) => n + 1);
    let open = true;
    return () => {
        if (!open) return;
        open = false;
        tileMenus.update((n) => Math.max(0, n - 1));
    };
}

export const roomOverlayStore = derived(
    [
        activeSecondaryZoneActionBarStore,
        openedMenuStore,
        menuVisiblilityStore,
        modalVisibilityStore,
        popupStore,
        dockTrayOpenStore,
    ],
    ([$secondary, $menu, $settings, $modal, $popups, $tray]) =>
        $secondary !== undefined ||
        $menu !== undefined ||
        $settings ||
        $modal ||
        $popups.length > 0 ||
        $tray,
);
