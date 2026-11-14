// quanta: WA's raised-hands card in the room's top-right corner keeps the middle of the map clear, as the platform's
// card does: on a map narrower than this it shows only its header until opened.
import { derived } from "svelte/store";
import { canvasSize, coWebsites, windowSize } from "../Stores/CoWebsiteStore";
import { sidePanelLayoutStore, sidePanelReservedStore } from "./sidePanel";

export const HANDS_DOCK_OPEN_MIN_MAP_WIDTH = 880;

/** The map's width beside the side column (People or Chat), which a co-website beside it in landscape takes instead. */
export const mapAreaWidthStore = derived(
    [canvasSize, coWebsites, windowSize, sidePanelReservedStore, sidePanelLayoutStore],
    ([$canvas, $coWebsites, $window, $reserved, $layout]) => {
        const besideWebsite = $coWebsites.length > 0 && $window.width > $window.height;
        return $canvas.width - ($reserved && !besideWebsite ? $layout.width + $layout.margin : 0);
    },
);

/** Open as the person left it, else open only on a wide enough map (always outside a class). */
export function handsDockOpen(chosen: boolean | undefined, mapWidth: number, quantaUi: boolean): boolean {
    return chosen ?? !(quantaUi && mapWidth < HANDS_DOCK_OPEN_MIN_MAP_WIDTH);
}
