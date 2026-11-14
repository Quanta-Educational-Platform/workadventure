import { describe, expect, it } from "vitest";
import { FACINGS } from "../../quanta/wokaFacing";
import { PlayerAnimationTypes } from "./Animation";
import {
    getSheetAnimations,
    isSheetFrameCount,
    pictureCell,
    SEATED_BACK_FRAME,
    SEATED_FRONT_FRAME,
    sheetAnimationKey,
    SHEET_FRAMES,
} from "./WokaSheet";

describe("woka sheet format", () => {
    it("tells a new sheet from an old one by its frames", () => {
        expect(SHEET_FRAMES).toBe(72);
        expect(isSheetFrameCount(12)).toBe(false);
        expect(isSheetFrameCount(72)).toBe(true);
    });

    it("walks on six frames at 15 a second and stands on one still", () => {
        const animations = getSheetAnimations("t");
        expect(animations).toHaveLength(FACINGS.length * 2);
        const walk = animations.find((a) => a.key === sheetAnimationKey("t", "up-right", PlayerAnimationTypes.Walk));
        expect(walk?.frames).toEqual([42, 43, 44, 45, 46, 47]);
        expect(walk?.frameRate).toBe(15);
        const idle = animations.find((a) => a.key === sheetAnimationKey("t", "down", PlayerAnimationTypes.Idle));
        expect(idle?.frames).toEqual([1]);
    });

    it("keeps its seated frames in the last row", () => {
        expect(SEATED_FRONT_FRAME).toBe(65);
        expect(SEATED_BACK_FRAME).toBe(67);
    });

    it("draws pictures of old sheets as before, and of new ones from their still in the same four directions", () => {
        expect(pictureCell(96, 3, 0)).toEqual({ column: 0, row: 3 });
        expect(pictureCell(256, 0, 0)).toEqual({ column: 1, row: 0 });
        expect(pictureCell(256, 1, 0)).toEqual({ column: 1, row: 2 });
        expect(pictureCell(256, 2, 0)).toEqual({ column: 1, row: 6 });
        expect(pictureCell(256, 3, 0)).toEqual({ column: 1, row: 4 });
    });
});
