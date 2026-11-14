// quanta: new woka sheets, 8 columns by 9 rows of 32 x 32 frames. Rows follow FACINGS, then one seated row. Columns:
// a breath, the still (frame 1 stays the front-facing still that snapshots take), then six walking frames. The seated
// row: front breath, front still, back breath, back still, then the turned views' stills (front-right, right,
// back-right), drawn facing right and mirrored for the left. Sheets drawn before the turned views leave those empty.
// Older sheets are 3 x 4; a character with any such layer plays them all the old way.
import type * as Phaser from "phaser";
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

export function seatedFrame(column: number): number {
    return SEATED_ROW * COLUMNS + column;
}

export function stillFrame(facing: Facing): number {
    return FACINGS.indexOf(facing) * COLUMNS + STILL_COLUMN;
}

const seatedColumns = new Map<string, number>();
let probe: CanvasRenderingContext2D | null | undefined;

/** Which frames of a sheet's seated row are drawn, a bit per column; read once per texture. */
export function seatedColumnsOf(textures: Phaser.Textures.TextureManager, key: string): number {
    const known = seatedColumns.get(key);
    if (known !== undefined) return known;
    // Unreadable: the front and back frames every new sheet has.
    let drawn = (1 << 1) | (1 << 3);
    try {
        const image = textures.get(key).getSourceImage() as CanvasImageSource;
        probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
        if (probe) {
            probe.canvas.width = SHEET_WIDTH;
            probe.canvas.height = 32;
            probe.clearRect(0, 0, SHEET_WIDTH, 32);
            probe.drawImage(image, 0, SEATED_ROW * 32, SHEET_WIDTH, 32, 0, 0, SHEET_WIDTH, 32);
            const alpha = probe.getImageData(0, 0, SHEET_WIDTH, 32).data;
            drawn = 0;
            for (let i = 3; i < alpha.length; i += 4)
                if (alpha[i] > 0) drawn |= 1 << Math.floor(((i >> 2) % SHEET_WIDTH) / 32);
        }
    } catch (e) {
        console.warn("quanta: seated frames unreadable", key, e);
    }
    seatedColumns.set(key, drawn);
    return drawn;
}

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
