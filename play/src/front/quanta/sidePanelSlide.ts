// quanta: the chat column slides in and out as the platform's people column does (VirtualRoom.tsx, RoomPeoplePanel:
// PEOPLE_SLIDE_IN / PEOPLE_SLIDE_OUT), so opening and closing look the same whichever tab is showing.
import type { TransitionConfig } from "svelte/transition";

export const SLIDE_IN = { duration: 380, curve: [0.2, 0, 0, 1] } as const;
export const SLIDE_OUT = { duration: 430, curve: [0.4, 0, 0.2, 1] } as const;

/** CSS's cubic-bezier(x1, y1, x2, y2) timing function. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (progress: number) => number {
    const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
    return (progress) => {
        if (progress <= 0) return 0;
        if (progress >= 1) return 1;
        // x(t) rises monotonically for x1, x2 in [0, 1]: find the t whose x is the progress, by halving.
        let low = 0;
        let high = 1;
        for (let step = 0; step < 30; step++) {
            const mid = (low + high) / 2;
            if (at(x1, x2, mid) < progress) low = mid;
            else high = mid;
        }
        return at(y1, y2, (low + high) / 2);
    };
}

/**
 * The column sliding `distance` pixels in from its edge (`direction` "in") or out to it ("out"); `instant` for a
 * swap between People and Chat, which happens in place.
 */
export function sidePanelSlide(
    _node: Element,
    { distance, direction, instant }: { distance: number; direction: "in" | "out"; instant?: boolean },
): TransitionConfig {
    if (instant) return { duration: 0 };
    const { duration, curve } = direction === "in" ? SLIDE_IN : SLIDE_OUT;
    const ease = cubicBezier(curve[0], curve[1], curve[2], curve[3]);
    return {
        duration,
        // Svelte's t runs 0 to 1 coming in and 1 to 0 going out; u is the rest. Either way the time elapsed is
        // the curve's input, as in a CSS transition.
        css: (t, u) => {
            const offset = direction === "in" ? 1 - ease(t) : ease(u);
            return `transform: translateX(${offset * distance}px);`;
        },
    };
}
