// quanta: whether the room shows something over its map that the person is using: the emoji picker, a dock tray, a
// menu, the settings dialog, a modal or a pop-up. The platform hides a presented board it lays over the map on a phone
// while one is open (roomBridge.ts), or the picker would open under the board.
import { derived, writable } from "svelte/store";
import { activeSecondaryZoneActionBarStore, menuVisiblilityStore, openedMenuStore } from "../Stores/MenuStore";
import { modalVisibilityStore } from "../Stores/ModalStore";
import { popupStore } from "../Stores/PopupStore";

/** The dock's microphone or camera tray is open (QuantaDock.svelte). */
export const dockTrayOpenStore = writable(false);

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
        $secondary !== undefined || $menu !== undefined || $settings || $modal || $popups.length > 0 || $tray,
);
