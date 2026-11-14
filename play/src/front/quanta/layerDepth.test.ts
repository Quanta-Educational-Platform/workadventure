import { describe, expect, it } from "vitest";
import { LAYER_DEPTH_PROPERTY, tileLayerDepth } from "./layerDepth";

describe("tileLayerDepth", () => {
    it("is the layer's own depth when it has one", () => {
        expect(tileLayerDepth([{ name: LAYER_DEPTH_PROPERTY, value: 630 }], 1_000_000)).toBe(630);
    });
    it("is the layer's place among the layers otherwise", () => {
        expect(tileLayerDepth(undefined, -2)).toBe(-2);
        expect(tileLayerDepth([{ name: "other", value: 630 }], 1_000_000)).toBe(1_000_000);
    });
    it("ignores a value that isn't a number", () => {
        expect(tileLayerDepth([{ name: LAYER_DEPTH_PROPERTY, value: "630" }], -2)).toBe(-2);
        expect(tileLayerDepth([{ name: LAYER_DEPTH_PROPERTY, value: Number.NaN }], -2)).toBe(-2);
    });
});
