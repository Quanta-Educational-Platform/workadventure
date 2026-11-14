import { describe, expect, it } from "vitest";
import { pipWindowHeight } from "./pipHeight";

describe("pipWindowHeight", () => {
    it("is one video tall for one stream or two", () => {
        expect(pipWindowHeight(1, 1000)).toBe(385);
        expect(pipWindowHeight(2, 1000)).toBe(385);
    });

    it("stops at two videos however many people are in the call", () => {
        expect(pipWindowHeight(3, 1000)).toBe(612);
        expect(pipWindowHeight(40, 1000)).toBe(612);
    });

    it("never outgrows a short screen", () => {
        expect(pipWindowHeight(40, 500)).toBe(500);
        expect(pipWindowHeight(40, undefined)).toBe(612);
    });
});
