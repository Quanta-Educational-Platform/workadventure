// quanta: new woka sheets, 8 columns by 9 rows of 32 x 32 frames. Rows follow FACINGS, then one seated row. Columns:
// a breath, the still (frame 1 stays the front-facing still that snapshots take), then six walking frames. The seated
// row: front breath, front still, back breath, back still, then the turned views' stills (front-right, right,
// back-right), drawn facing right and mirrored for the left. Sheets drawn before the turned views leave those empty.
// Older sheets are 3 x 4; a character with any such layer plays them all the old way.
// Quanta's own sheets come at 2x too: the same grid of 64 x 64 frames (512 x 576), drawn at the room's 32 x 32.
import type * as Phaser from "phaser";
import type { Facing } from "../../quanta/wokaFacing";
import { FACINGS } from "../../quanta/wokaFacing";
import type { AnimationData } from "./Animation";
import { getPlayerAnimations, PlayerAnimationTypes } from "./Animation";

const COLUMNS = 8;
const STILL_COLUMN = 1;
const WALK_COLUMNS = [2, 3, 4, 5, 6, 7];
const WALK_FRAME_RATE = 15;
const SEATED_ROW = FACINGS.length;
export const SHEET_FRAMES = COLUMNS * (SEATED_ROW + 1);
const SHEET_WIDTH = COLUMNS * 32;

/** A sheet's frame size from its width: 64 for a 2x sheet (512 wide), 32 for every other (ours at 1x, WA's 3 x 4). */
export function frameSizeOf(imageWidth: number): number {
    return imageWidth >= SHEET_WIDTH * 2 ? 64 : 32;
}

// Phaser.Textures.FilterMode: this module only imports Phaser's types.
const LINEAR = 0;
const NEAREST = 1;
const denser = new Set<Phaser.Textures.Texture>();
let denserFilter = LINEAR;

/** What a baked woka sheet (Entity/WokaBaker.ts) carries: it comes cut into frames and keeps no image to read. */
export type BakedSheetData = { wokaFrameSize: number; wokaSeatedColumns: number };

function bakedSheetData(texture: Phaser.Textures.Texture): BakedSheetData | undefined {
    const data = texture.customData;
    if (!("wokaFrameSize" in data) || !("wokaSeatedColumns" in data)) return undefined;
    const { wokaFrameSize, wokaSeatedColumns } = data;
    if (typeof wokaFrameSize !== "number" || typeof wokaSeatedColumns !== "number") return undefined;
    return { wokaFrameSize, wokaSeatedColumns };
}

/**
 * Sets a texture's filter on its GL texture in place. Phaser's setFilter uploads the whole texture again from its
 * source: every woka sheet on each zoom change, and a baked sheet keeps no source to upload.
 */
export function setFilterInPlace(texture: Phaser.Textures.Texture, filter: number): void {
    // A removed texture has no manager; a headless game no renderer.
    const game = texture.manager?.game;
    const renderer = game?.renderer && "gl" in game.renderer ? game.renderer : undefined;
    const gl = renderer?.gl;
    for (const source of texture.source) {
        source.scaleMode = filter;
        const wrapper = source.glTexture;
        if (!gl || !renderer || !wrapper) continue;
        const glFilter = filter === LINEAR ? gl.LINEAR : gl.NEAREST;
        if (wrapper.minFilter === glFilter && wrapper.magFilter === glFilter) continue;
        // Kept on the wrapper too: a restored context re-creates the texture with them.
        wrapper.minFilter = glFilter;
        wrapper.magFilter = glFilter;
        const units = renderer.glTextureUnits;
        const current = units.units[0];
        units.bind(wrapper, 0);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, glFilter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, glFilter);
        if (current) units.bind(current, 0);
    }
}

/** A woka texture about to be removed: no longer filtered on zoom changes. */
export function forgetWokaTexture(texture: Phaser.Textures.Texture): void {
    denser.delete(texture);
}

/**
 * Every woka sheet is loaded as 32 x 32 frames; a 2x sheet is cut into its own 64 x 64 frames here, once, and filtered
 * for the room's zoom (setWokaTexturesZoom). Returns the sheet's frame size; the sprites showing it are drawn at
 * 32 / size.
 */
export function sliceWokaSheet(texture: Phaser.Textures.Texture): number {
    const baked = bakedSheetData(texture)?.wokaFrameSize;
    if (baked) {
        if (baked !== 32 && !denser.has(texture)) {
            denser.add(texture);
            setFilterInPlace(texture, denserFilter);
        }
        return baked;
    }
    const source = texture.source[0];
    const size = source ? frameSizeOf(source.width) : 32;
    if (size === 32) return 32;
    if (texture.get(0).width !== size) {
        for (const name of texture.getFrameNames()) texture.remove(name);
        let index = 0;
        for (let y = 0; y + size <= source.height; y += size)
            for (let x = 0; x + size <= source.width; x += size) texture.add(index++, 0, x, y, size, size);
    }
    if (!denser.has(texture)) {
        denser.add(texture);
        setFilterInPlace(texture, denserFilter);
    }
    return size;
}

/**
 * The zoom the room is drawn at. At an even whole zoom a 2x sheet's texels land on whole canvas pixels and stay crisp
 * (nearest); at any other (1, 3, a zoom animation) nearest would drop or double texels unevenly, so they are filtered
 * (linear: at zoom 1 an exact average of each 2 x 2).
 */
export function setWokaTexturesZoom(zoom: number): void {
    const filter = zoom >= 2 && Number.isInteger(zoom / 2) ? NEAREST : LINEAR;
    if (filter === denserFilter) return;
    denserFilter = filter;
    for (const texture of denser) {
        if (!texture.source.length || !texture.manager.exists(texture.key)) {
            denser.delete(texture);
            continue;
        }
        setFilterInPlace(texture, filter);
    }
}

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
    const baked = bakedSheetData(textures.get(key))?.wokaSeatedColumns;
    if (baked !== undefined) return baked;
    const known = seatedColumns.get(key);
    if (known !== undefined) return known;
    // Unreadable: the front and back frames every new sheet has.
    let drawn = (1 << 1) | (1 << 3);
    try {
        const image = textures.get(key).getSourceImage() as HTMLImageElement | HTMLCanvasElement;
        const size = frameSizeOf((image as HTMLImageElement).naturalWidth || image.width);
        const width = COLUMNS * size;
        probe ??= document.createElement("canvas").getContext("2d", { willReadFrequently: true });
        if (probe) {
            probe.canvas.width = width;
            probe.canvas.height = size;
            probe.clearRect(0, 0, width, size);
            probe.drawImage(image, 0, SEATED_ROW * size, width, size, 0, 0, width, size);
            const alpha = probe.getImageData(0, 0, width, size).data;
            drawn = 0;
            for (let i = 3; i < alpha.length; i += 4)
                if (alpha[i] > 0) drawn |= 1 << Math.floor(((i >> 2) % width) / size);
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

/** Every animation a woka texture gets (Character.addTextures), to remove with it. */
export function wokaAnimationKeys(texture: string): string[] {
    return [...getPlayerAnimations(texture), ...getSheetAnimations(texture)].map((d) => d.key);
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
