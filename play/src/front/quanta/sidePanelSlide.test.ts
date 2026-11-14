import { expect, it } from "vitest";
import { cubicBezier, SLIDE_IN, SLIDE_OUT, sidePanelSlide } from "./sidePanelSlide";

const node = {} as Element;
const offset = (css: string) => Number(/translateX\((-?[\d.e-]+)px\)/.exec(css)?.[1]);

it("eases like CSS's cubic-bezier", () => {
    const linear = cubicBezier(0, 0, 1, 1);
    expect(linear(0.3)).toBeCloseTo(0.3, 4);
    const out = cubicBezier(0.2, 0, 0, 1);
    expect(out(0)).toBe(0);
    expect(out(1)).toBe(1);
    expect(out(0.5)).toBeGreaterThan(0.85);
    let last = 0;
    for (let x = 0.05; x <= 1; x += 0.05) {
        expect(out(x)).toBeGreaterThanOrEqual(last);
        last = out(x);
    }
});

it("slides the column in and out by its width and margin, at the people column's pace", () => {
    const opening = sidePanelSlide(node, { distance: 332, direction: "in" });
    expect(opening.duration).toBe(SLIDE_IN.duration);
    expect(offset(opening.css!(0, 1))).toBeCloseTo(332);
    expect(offset(opening.css!(1, 0))).toBeCloseTo(0);
    const closing = sidePanelSlide(node, { distance: 332, direction: "out" });
    expect(closing.duration).toBe(SLIDE_OUT.duration);
    // Svelte runs t from 1 down to 0 going out.
    expect(offset(closing.css!(1, 0))).toBeCloseTo(0);
    expect(offset(closing.css!(0, 1))).toBeCloseTo(332);
    expect(offset(closing.css!(0.5, 0.5))).toBeCloseTo(
        332 * cubicBezier(SLIDE_OUT.curve[0], SLIDE_OUT.curve[1], SLIDE_OUT.curve[2], SLIDE_OUT.curve[3])(0.5),
    );
});

it("swaps in place", () => {
    expect(sidePanelSlide(node, { distance: 332, direction: "out", instant: true }).duration).toBe(0);
});
