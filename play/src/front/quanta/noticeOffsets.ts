// quanta: the room's notices (MainLayout's .quanta-notices) start below what sits in the room's top-left corner: the
// call's tiles and the room script's buttons. Each registers its element; the lowest bottom edge, measured from the top
// of the notices' own container (so a co-website above the map isn't counted twice), goes to one CSS variable.
import { coWebsitesSize } from "../Stores/CoWebsiteStore";

const VARIABLE = "--quanta-notices-clear";
const bottoms = new Map<object, number>();

function publish(): void {
    const lowest = Math.max(0, ...bottoms.values());
    if (lowest > 0) document.documentElement.style.setProperty(VARIABLE, `${Math.round(lowest)}px`);
    else document.documentElement.style.removeProperty(VARIABLE);
}

/** Keeps the notices below this element while it is shown; the returned function lets them go back up. */
export function keepNoticesBelow(element: HTMLElement): () => void {
    const owner = {};
    const measure = () => {
        const rect = element.getBoundingClientRect();
        const container = document.getElementById("main-layout-main")?.getBoundingClientRect();
        if (rect.height > 0 && rect.width > 0) bottoms.set(owner, rect.bottom - (container?.top ?? 0));
        else bottoms.delete(owner);
        publish();
    };
    let frame = 0;
    const later = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(measure);
    };
    const observer = new ResizeObserver(later);
    observer.observe(element);
    window.addEventListener("resize", later);
    window.addEventListener("orientationchange", later);
    // A co-website above the map moves the element without resizing it.
    const unsubscribe = coWebsitesSize.subscribe(later);
    return () => {
        cancelAnimationFrame(frame);
        observer.disconnect();
        window.removeEventListener("resize", later);
        window.removeEventListener("orientationchange", later);
        unsubscribe();
        bottoms.delete(owner);
        publish();
    };
}
