import { describe, expect, it } from "vitest";
import type { AreaData } from "@workadventure/map-editor";
import { highlightRect, isInteractiveArea } from "./interactHighlight";

const area = (properties: unknown[]) => ({ properties }) as unknown as Pick<AreaData, "properties">;

describe("isInteractiveArea", () => {
    it("is an area with a website opened on a key press", () => {
        expect(isInteractiveArea(area([{ type: "openWebsite", trigger: "onaction" }]))).toBe(true);
    });
    it("is not an area that opens by itself, or has nothing to open", () => {
        expect(isInteractiveArea(area([{ type: "openWebsite", trigger: "onenter" }]))).toBe(false);
        expect(isInteractiveArea(area([{ type: "speakerMegaphone" }]))).toBe(false);
        expect(isInteractiveArea(area([]))).toBe(false);
    });
});

describe("highlightRect", () => {
    it("draws a board without the row one stands on below it", () => {
        expect(highlightRect({ name: "quanta:whiteboard:main", x: 128, y: 448, width: 256, height: 128 })).toEqual({
            x: 128,
            y: 456,
            width: 256,
            height: 88,
        });
    });
    it("draws any other object as its area", () => {
        const box = { x: 10, y: 20, width: 64, height: 64 };
        expect(highlightRect({ name: "lamp", ...box })).toEqual(box);
    });
    it("keeps a board's area too short to hold an aisle", () => {
        const box = { x: 0, y: 0, width: 96, height: 32 };
        expect(highlightRect({ name: "quanta:whiteboard:x", ...box })).toEqual(box);
    });
});
