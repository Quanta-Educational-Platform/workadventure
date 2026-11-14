// quanta: new woka sheets, 8 columns by 9 rows of 32 x 32 frames. Rows follow FACINGS, then one seated row. Columns:
// a breath, the still (frame 1 stays the front-facing still that snapshots take), then six walking frames.
// Older sheets are 3 x 4; a character with any such layer plays them all the old way.
import type { Facing } from "../../quanta/wokaFacing";
import { FACINGS } from "../../quanta/wokaFacing";
import type { AnimationData } from "./Animation";
import { PlayerAnimationTypes } from "./Animation";

const COLUMNS = 8;
const STILL_COLUMN = 1;
const WALK_COLUMNS = [2, 3, 4, 5, 6, 7];
const WALK_FRAME_RATE = 15;
const SEATED_ROW = FACINGS.length;
export const SHEET_FRAMES = COLUMNS * (SEATED_ROW + 1);
const SHEET_WIDTH = COLUMNS * 32;

export const SEATED_FRONT_FRAME = SEATED_ROW * COLUMNS + 1;
export const SEATED_BACK_FRAME = SEATED_ROW * COLUMNS + 3;

export function isSheetFrameCount(frames: number): boolean {
    return frames >= SHEET_FRAMES;
}

export function sheetAnimationKey(texture: string, facing: Facing, type: PlayerAnimationTypes): string {
    return `${texture}-eight-${facing}-${type}`;
}

export function getSheetAnimations(texture: string): AnimationData[] {
    return FACINGS.flatMap((facing, row) => [
        {
            key: sheetAnimationKey(texture, facing, PlayerAnimationTypes.Walk),
            frameModel: texture,
            frames: WALK_COLUMNS.map((column) => row * COLUMNS + column),
            frameRate: WALK_FRAME_RATE,
            repeat: -1,
        },
        {
            // One still frame: every idle woka animating would keep the whole scene redrawing.
            key: sheetAnimationKey(texture, facing, PlayerAnimationTypes.Idle),
            frameModel: texture,
            frames: [row * COLUMNS + STILL_COLUMN],
            frameRate: 10,
            repeat: 1,
        },
    ]);
}

/** Where a picture of a woka takes its frame, for a row given in the old sheets' order: down, left, right, up. */
export function pictureCell(imageWidth: number, oldRow: number, oldColumn: number): { column: number; row: number } {
    if (imageWidth < SHEET_WIDTH) return { column: oldColumn, row: oldRow };
    const row = FACINGS.indexOf((["down", "left", "right", "up"] as const)[oldRow] ?? "down");
    return { column: STILL_COLUMN, row };
}
