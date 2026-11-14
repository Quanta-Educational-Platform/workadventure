// quanta: the side column sliding open or shut with the room's frame beside the page (sidePanel.ts). Read live, by the
// frame's current width, rather than from what was last written to CSS: the camera lays the map out on the frame's
// resize, which can come before the next write, and one frame against old numbers was a refit and a jump.

interface Slide {
    /** The frame's width without the column: what the map keeps the whole way. */
    base: number;
    /** The column's full space, and what the frame grows by (less where the page is short of room). */
    space: number;
    widens: number;
}

let slide: Slide | undefined;

export function setSideSlide(next: Slide | undefined): void {
    slide = next;
}

/** The column's full space at the slide's open end. */
export function sideSlideSpace(): number {
    return slide?.space ?? 0;
}

export function sideSlideActive(): boolean {
    return slide !== undefined;
}

/** What the frame has gained so far (opening) or still holds (closing). */
export function sideSlideGained(): number {
    return slide ? Math.min(slide.widens, Math.max(0, window.innerWidth - slide.base)) : 0;
}

/** The column's space shown now, while sliding: what the frame has gained, plus what it never will. */
export function sideSlideShown(): number {
    return slide ? Math.min(slide.space, sideSlideGained() + Math.max(0, slide.space - slide.widens)) : 0;
}
