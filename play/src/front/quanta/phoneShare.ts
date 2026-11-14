// quanta: on a phone a shared screen beside the map is too small to read: it opens full screen (MainLayout's highlight
// full screen, kept inside the map's window by quanta-ui.css); the corner button takes the student back to the map, the
// share a tile in the call's row that opens it again.
import { get } from "svelte/store";
import { highlightedEmbedScreen } from "../Stores/HighlightedEmbedScreenStore";
import { highlightFullScreen } from "../Stores/ActionsCamStore";
import { phoneLayoutStore } from "./roomWindow";

export function startPhoneShareFullScreen(): void {
    let shown: string | undefined;
    // Singletons for the page's lifetime, like the stores they read.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    highlightedEmbedScreen.subscribe((box) => {
        const id = box?.uniqueId;
        if (id === shown) return;
        shown = id;
        if (id?.startsWith("screensharing_") && get(phoneLayoutStore)) highlightFullScreen.set(true);
    });
    // Leaving full screen on a phone goes back to the map, the share a tile in the call's row (a tap opens it full
    // screen again): never the share squeezed into the middle of the map.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    highlightFullScreen.subscribe((full) => {
        if (full || !get(phoneLayoutStore)) return;
        if (get(highlightedEmbedScreen)?.uniqueId.startsWith("screensharing_")) highlightedEmbedScreen.removeHighlight();
    });
}
