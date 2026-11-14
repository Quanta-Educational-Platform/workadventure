// quanta: a map shows its workspace's logo or name wherever an area is named quanta:logo, quanta:name (the short name)
// or quanta:fullname, and an office its owner's name where one is named quanta:owner, drawn to fit the area, so one
// marketplace map carries each workspace's own sign. quanta:sign is the whole sign in one area: the logo beside the
// short name (`name=full` for the full name), laid out as one piece and aligned in the area as one, so it sits where
// the area says whatever the name's length, and either part alone when the workspace has no logo or no name. The area's size
// sets the sign's, from a sticker on a desk to a whole wall; options follow the name as a query, e.g.
// `quanta:logo?tone=white&opacity=0.6` or `quanta:name?color=%23ffffff&weight=600`:
//  - tone: original (default), invert, white, dark: recolours a logo for a darker or lighter background;
//  - opacity: 0 to 1 (default 1);
//  - color: a name's colour as #rgb or #rrggbb (default dark ink, white with tone=white);
//  - weight: a name's font weight, 400 to 800 (default 800, 700 for the full name and the owner);
//  - align: left, center (default) or right;
//  - style: mounted (default) draws the sign as the room's own wall letters were drawn, at the map's pixel size with a
//    dark edge for thickness, a light from above and a soft shadow on the wall; flat draws it as it comes;
//  - case: a name is in capitals like wall lettering (default); as-is keeps it as written (the full name's and the
//    owner's default).
// The platform sends the logo and names (setWorkspaceBrand) and, for an office, its owner in the room's metadata
// (setRoomOwner); a room outside it shows nothing. The owner keeps to one line: smaller as it must, down to a legible
// size, then cut short with an ellipsis, never broken inside a word.
import type { AreaData } from "@workadventure/map-editor";
import type * as Phaser from "phaser";
import { writable, type Readable } from "svelte/store";

export type BrandKind = "logo" | "name" | "fullname" | "owner" | "sign";
export type BrandTone = "original" | "invert" | "white" | "dark";

export interface BrandSpec {
    kind: BrandKind;
    tone: BrandTone;
    opacity: number;
    color: string | undefined;
    weight: number;
    align: "left" | "center" | "right";
    style: "mounted" | "flat";
    upper: boolean;
    /** A sign's name: the full name instead of the short one. */
    full: boolean;
}

export interface WorkspaceBrand {
    logo: string | undefined;
    shortName: string | undefined;
    fullName: string | undefined;
}

const NAME_PATTERN = /^quanta:(logo|name|fullname|owner|sign)(?:\?(.*))?$/;
const COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
// The room's wall lettering: charcoal, not black.
const DARK_INK = "#26282f";
const MAX_NAME = 120;

export function parseBrandArea(name: string | undefined): BrandSpec | undefined {
    const match = NAME_PATTERN.exec((name ?? "").trim());
    if (!match) return undefined;
    const kind = match[1] as BrandKind;
    let options: URLSearchParams;
    try {
        options = new URLSearchParams(match[2] ?? "");
    } catch {
        options = new URLSearchParams();
    }
    const toneOption = options.get("tone");
    const tone: BrandTone =
        toneOption === "invert" || toneOption === "white" || toneOption === "dark" ? toneOption : "original";
    const opacityOption = Number(options.get("opacity") ?? "1");
    const opacity = Number.isFinite(opacityOption) ? Math.min(1, Math.max(0, opacityOption)) : 1;
    const colorOption = options.get("color") ?? undefined;
    const color = colorOption && COLOR_PATTERN.test(colorOption) ? colorOption : undefined;
    const weightOption = Math.round(Number(options.get("weight")) / 100) * 100;
    const weight =
        weightOption >= 400 && weightOption <= 800 ? weightOption : kind === "fullname" || kind === "owner" ? 700 : 800;
    const alignOption = options.get("align");
    const align = alignOption === "left" || alignOption === "right" ? alignOption : "center";
    const style = options.get("style") === "flat" ? "flat" : "mounted";
    const caseOption = options.get("case");
    const upper = caseOption === "upper" || (caseOption !== "as-is" && (kind === "name" || kind === "sign"));
    const full = kind === "sign" && options.get("name") === "full";
    return { kind, tone, opacity, color, weight, align, style, upper, full };
}

const brandStore = writable<WorkspaceBrand>({ logo: undefined, shortName: undefined, fullName: undefined });
export const workspaceBrandStore: Readable<WorkspaceBrand> = brandStore;

const ownerStore = writable<string | undefined>(undefined);
export const roomOwnerStore: Readable<string | undefined> = ownerStore;

/** A name as a sign shows it: trimmed and at most MAX_NAME characters; anything else is none. */
export const brandText = (value: unknown) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_NAME) : undefined;

/** A logo address a sign loads: https only, and no longer than 2048 characters. */
export function brandLogoUrl(value: unknown): string | undefined {
    if (typeof value !== "string" || value.length > 2048) return undefined;
    try {
        return new URL(value).protocol === "https:" ? value : undefined;
    } catch {
        return undefined;
    }
}

/** From the platform's message: an https logo and the workspace's names, anything else dropped. */
export function setWorkspaceBrand(data: unknown): void {
    const brand = (data ?? {}) as { logo?: unknown; shortName?: unknown; fullName?: unknown };
    brandStore.set({
        logo: brandLogoUrl(brand.logo),
        shortName: brandText(brand.shortName),
        fullName: brandText(brand.fullName),
    });
}

/** An office's owner, from the room's metadata as the platform's map endpoint sends it (`quanta.ownerName`). */
export function setRoomOwner(metadata: unknown): void {
    const quanta = (metadata as { quanta?: unknown } | null | undefined)?.quanta;
    ownerStore.set(
        quanta && typeof quanta === "object" ? brandText((quanta as { ownerName?: unknown }).ownerName) : undefined,
    );
}

const INK: Partial<Record<BrandTone, [number, number, number]>> = { white: [255, 255, 255], dark: [31, 41, 55] };

/**
 * Logos usually come with their own light background. White and dark keep the logo's marks as one colour of ink, how
 * dark each pixel is setting how opaque; invert swaps light and dark but keeps the hues. Either way a solid backdrop
 * the logo came with is dropped first, so it doesn't turn into a box.
 */
interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** The colour of a logo's own backdrop, when the four corners of where it was drawn are one opaque colour. */
function solidBackground(pixels: ImageData, logo: Box): [number, number, number] | undefined {
    const { data, width } = pixels;
    const left = Math.ceil(logo.x) + 1;
    const top = Math.ceil(logo.y) + 1;
    const right = Math.floor(logo.x + logo.width) - 2;
    const bottom = Math.floor(logo.y + logo.height) - 2;
    if (right <= left || bottom <= top) return undefined;
    const corners = [
        [left, top],
        [right, top],
        [left, bottom],
        [right, bottom],
    ].map(([x, y]) => (y * width + x) * 4);
    if (corners.some((offset) => data[offset + 3] < 230)) return undefined;
    const [first] = corners;
    const same = corners.every(
        (offset) =>
            Math.abs(data[offset] - data[first]) +
                Math.abs(data[offset + 1] - data[first + 1]) +
                Math.abs(data[offset + 2] - data[first + 2]) <
            36,
    );
    return same ? [data[first], data[first + 1], data[first + 2]] : undefined;
}

/**
 * A logo on the wall itself, as the room's own sign is: a solid backdrop it came with goes, and so do the near-white
 * fills inside it (a disc or a plate behind the mark), which on a cream wall only read as a sticker.
 */
function withoutBackdrop(canvas: HTMLCanvasElement, logo: Box): HTMLCanvasElement {
    const context = canvas.getContext("2d");
    if (!context) return canvas;
    let pixels: ImageData;
    try {
        pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
        return canvas;
    }
    const data = pixels.data;
    const background = solidBackground(pixels, logo);
    for (let i = 0; i < data.length; i += 4) {
        if (!data[i + 3]) continue;
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const lightness = (max + min) / 510;
        const saturation = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
        const backdrop = background
            ? 1 -
              Math.min(
                  1,
                  Math.max(
                      0,
                      (Math.hypot(r - background[0], g - background[1], b - background[2]) / 441 - 0.06) / 0.12,
                  ),
              )
            : 0;
        if (saturation < 0.25) {
            // Grey is ink blended with a white plate: keep only the ink, so its edges don't leave a pale halo.
            const ink = Math.min(1, Math.max(0, (1 - lightness) * 1.12));
            const dark = Math.round(Math.min(r, g, b) * 0.25);
            data[i] = data[i + 1] = data[i + 2] = Math.min(dark, 38);
            data[i + 3] = Math.round(data[i + 3] * ink * (1 - backdrop));
        } else {
            data[i + 3] = Math.round(data[i + 3] * (1 - backdrop));
        }
    }
    context.putImageData(pixels, 0, 0);
    return canvas;
}

function retone(canvas: HTMLCanvasElement, tone: BrandTone, logo: Box): HTMLCanvasElement {
    if (tone === "original") return canvas;
    const context = canvas.getContext("2d");
    if (!context) return canvas;
    let pixels: ImageData;
    try {
        pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
        return canvas;
    }
    const data = pixels.data;
    const ink = INK[tone];
    const background = solidBackground(pixels, logo);
    for (let i = 0; i < data.length; i += 4) {
        const lightness = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
        // Pixels of the logo's own backdrop fade out; a logo drawn on transparency keeps every pixel.
        const keep = background
            ? Math.min(
                  1,
                  Math.max(
                      0,
                      (Math.hypot(data[i] - background[0], data[i + 1] - background[1], data[i + 2] - background[2]) /
                          441 -
                          0.06) /
                          0.12,
                  ),
              )
            : 1;
        if (ink) {
            data[i + 3] = Math.round(data[i + 3] * keep * Math.min(1, Math.max(0, (1 - lightness) * 1.15)));
            [data[i], data[i + 1], data[i + 2]] = ink;
        } else {
            data[i + 3] = Math.round(data[i + 3] * keep);
        }
    }
    context.putImageData(pixels, 0, 0);
    if (ink) return canvas;
    const inverted = document.createElement("canvas");
    inverted.width = canvas.width;
    inverted.height = canvas.height;
    const invertedContext = inverted.getContext("2d");
    if (!invertedContext) return canvas;
    invertedContext.filter = "invert(1) hue-rotate(180deg)";
    invertedContext.drawImage(canvas, 0, 0);
    return inverted;
}

/** Over the floor, under every character (whose depth is its y), as the board highlight. */
const DEPTH = 1;
/** Twice the map's pixels: soft like the room's own art, still clean when the room is zoomed in. */
const RESOLUTION = 2;
export const MAX_TEXTURE = 2048;
/** A mounted sign's edge and shadow, in map pixels, inside the area. */
const MOUNT = { left: 1, top: 1, right: 3, bottom: 4 };

const images = new Map<string, Promise<HTMLImageElement>>();
/** One load per address, shared by every sign that shows it. */
export function loadImage(url: string): Promise<HTMLImageElement> {
    let image = images.get(url);
    if (!image) {
        image = new Promise((resolve, reject) => {
            const element = new Image();
            element.crossOrigin = "anonymous";
            element.decoding = "async";
            element.onload = () => resolve(element);
            element.onerror = () => reject(new Error(`Workspace logo failed to load`));
            element.src = url;
        });
        image.catch(() => images.delete(url));
        images.set(url, image);
    }
    return image;
}

interface SignCanvas {
    canvas: HTMLCanvasElement;
    scale: number;
    /** Where the sign itself goes: the whole canvas, less a mounted sign's edge and shadow. */
    inner: Box;
}

function canvasFor(area: Pick<AreaData, "width" | "height">, spec: BrandSpec): SignCanvas {
    const scale = Math.max(0.25, Math.min(RESOLUTION, MAX_TEXTURE / Math.max(area.width, area.height)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(area.width * scale));
    canvas.height = Math.max(1, Math.round(area.height * scale));
    const margin = spec.style === "mounted" ? MOUNT : { left: 0, top: 0, right: 0, bottom: 0 };
    const inner = {
        x: margin.left * scale,
        y: margin.top * scale,
        width: Math.max(1, canvas.width - (margin.left + margin.right) * scale),
        height: Math.max(1, canvas.height - (margin.top + margin.bottom) * scale),
    };
    return { canvas, scale, inner };
}

/** A copy of the sign in one colour, each pixel's alpha times `alpha`. */
function silhouette(sign: HTMLCanvasElement, rgb: string, alpha: number): HTMLCanvasElement {
    const out = document.createElement("canvas");
    out.width = sign.width;
    out.height = sign.height;
    const context = out.getContext("2d");
    if (!context) return out;
    context.globalAlpha = alpha;
    context.drawImage(sign, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-in";
    context.fillStyle = rgb;
    context.fillRect(0, 0, out.width, out.height);
    return out;
}

/**
 * The sign as the room's wall letters were drawn (golden-classroom art/letters.cjs): a soft shadow cast down and to the
 * right on the wall, a darker edge one to two pixels under the face for its thickness, and the face itself lit from
 * above, dark shapes a little lighter at the top and coloured parts keeping their hue.
 */
function mount(sign: HTMLCanvasElement, scale: number, depth = 1): HTMLCanvasElement {
    const out = document.createElement("canvas");
    out.width = sign.width;
    out.height = sign.height;
    const context = out.getContext("2d");
    const signContext = sign.getContext("2d");
    if (!context || !signContext) return sign;
    let face: ImageData;
    try {
        face = signContext.getImageData(0, 0, sign.width, sign.height);
    } catch {
        return sign;
    }
    const edge = new ImageData(new Uint8ClampedArray(face.data), face.width, face.height);
    const data = face.data;
    for (let y = 0; y < face.height; y++) {
        const light = 1.18 - 0.36 * (y / face.height);
        const tint = 0.92 + 0.12 * (1 - y / face.height);
        for (let x = 0; x < face.width; x++) {
            const i = (y * face.width + x) * 4;
            if (!data[i + 3]) continue;
            const dark = data[i] < 70 && data[i + 1] < 70 && data[i + 2] < 70;
            for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, data[i + c] * (dark ? light : tint));
            // Only the dark shapes and letters get an edge: the mark's thin coloured lines stay flat, as on the wall.
            if (dark) {
                edge.data[i] = 12;
                edge.data[i + 1] = 12;
                edge.data[i + 2] = 16;
            } else edge.data[i + 3] = 0;
        }
    }
    const layer = (pixels: ImageData) => {
        const canvas = document.createElement("canvas");
        canvas.width = pixels.width;
        canvas.height = pixels.height;
        canvas.getContext("2d")?.putImageData(pixels, 0, 0);
        return canvas;
    };
    // `depth` thins it all for small lettering, where a full edge would fill the gaps between letters.
    const unit = scale * depth;
    const shadow = silhouette(sign, "rgb(70, 55, 40)", 0.24);
    context.filter = `blur(${1.6 * unit}px)`;
    context.drawImage(shadow, 2 * unit, 3 * unit);
    context.filter = "none";
    const edgeLayer = layer(edge);
    context.drawImage(edgeLayer, 0, 2 * unit);
    context.drawImage(edgeLayer, 0, 1 * unit);
    context.drawImage(layer(face), 0, 0);
    return out;
}

export function drawLogo(image: HTMLImageElement, spec: BrandSpec, area: Pick<AreaData, "width" | "height">) {
    const { canvas, scale, inner } = canvasFor(area, spec);
    const context = canvas.getContext("2d");
    if (!context) return canvas;
    const width = image.naturalWidth || image.width || 1;
    const height = image.naturalHeight || image.height || 1;
    const fit = Math.min(inner.width / width, inner.height / height);
    const drawnWidth = width * fit;
    const drawnHeight = height * fit;
    const x =
        inner.x +
        (spec.align === "left"
            ? 0
            : spec.align === "right"
              ? inner.width - drawnWidth
              : (inner.width - drawnWidth) / 2);
    context.imageSmoothingQuality = "high";
    const logo = { x, y: inner.y + (inner.height - drawnHeight) / 2, width: drawnWidth, height: drawnHeight };
    context.drawImage(image, logo.x, logo.y, logo.width, logo.height);
    if (spec.style === "mounted" && spec.tone !== "invert") withoutBackdrop(canvas, logo);
    const toned = retone(canvas, spec.tone, logo);
    // A mark is drawn finer than lettering: half the letters' edge at most.
    const depth = Math.min(0.5, Math.max(0.25, Math.min(drawnWidth, drawnHeight) / scale / 80));
    return spec.style === "mounted" ? mount(toned, scale, depth) : toned;
}

// The room's own type (quanta-ui.css).
export const FONT_FAMILY = '"Fira Sans", "Inter", "Segoe UI", system-ui, -apple-system, sans-serif';

const LINE_HEIGHT = 1.15;

/** The text cut short at a word where it can, else a character, with an ellipsis, to fit `width` in `font`. */
function shortened(context: CanvasRenderingContext2D, text: string, width: number, font: string): string {
    context.font = font;
    const fits = (candidate: string) => context.measureText(candidate).width <= width;
    const words = text.split(/\s+/);
    for (let count = words.length - 1; count >= 1; count--) {
        const candidate = `${words.slice(0, count).join(" ")}…`;
        if (fits(candidate)) return candidate;
    }
    // By code point, so an emoji or other astral character is never split.
    const characters = Array.from(text);
    for (let length = characters.length - 1; length >= 1; length--) {
        const candidate = `${characters.slice(0, length).join("").trimEnd()}…`;
        if (fits(candidate)) return candidate;
    }
    return "…";
}

/** The name in as few lines as fit (a full name may take up to three), at the largest size that fills the area. */
export function drawName(text: string, spec: BrandSpec, area: Pick<AreaData, "width" | "height">) {
    const { canvas: sign, scale, inner } = canvasFor(area, spec);
    const context = sign.getContext("2d");
    if (!context) return sign;
    const value = spec.upper ? text.toLocaleUpperCase() : text;
    // The name is laid out in the inner box, then drawn at its offset.
    const canvas = { width: inner.width, height: inner.height };
    const words = value.split(/\s+/);
    const maxLines = spec.kind === "fullname" ? Math.min(3, words.length) : 1;
    // An owner's name stays readable: no smaller than this many map pixels, cut short instead.
    const smallest = spec.kind === "owner" ? Math.min(Math.floor(canvas.height / LINE_HEIGHT), 7 * scale) : 4;
    const font = (size: number) => `${spec.weight} ${size}px ${FONT_FAMILY}`;
    // Capitals read as lettering with a little air between them.
    context.letterSpacing = spec.upper ? "0.04em" : "0px";
    const lineHeight = LINE_HEIGHT;
    const wrap = (size: number, lines: number): string[] | undefined => {
        context.font = font(size);
        if (lines === 1) return context.measureText(value).width <= canvas.width ? [value] : undefined;
        const out: string[] = [];
        let line = "";
        for (const word of words) {
            const next = line ? `${line} ${word}` : word;
            if (context.measureText(next).width <= canvas.width) line = next;
            else {
                if (!line) return undefined;
                out.push(line);
                line = word;
            }
        }
        out.push(line);
        return out.length <= lines ? out : undefined;
    };
    let best: { size: number; lines: string[] } | undefined;
    for (let lines = 1; lines <= maxLines; lines++) {
        let low = smallest;
        let high = Math.floor(canvas.height / (lines * lineHeight));
        let fitted: string[] | undefined;
        while (low <= high) {
            const size = Math.floor((low + high) / 2);
            const wrapped = wrap(size, lines);
            if (wrapped) {
                fitted = wrapped;
                low = size + 1;
            } else high = size - 1;
        }
        if (fitted && (!best || high > best.size)) best = { size: high, lines: fitted };
    }
    if (!best && spec.kind === "owner") {
        best = { size: smallest, lines: [shortened(context, value, canvas.width, font(smallest))] };
    }
    if (!best) return sign;
    const color = spec.color ?? (spec.tone === "white" ? "#ffffff" : DARK_INK);
    context.font = font(best.size);
    context.fillStyle = color;
    context.textBaseline = "middle";
    context.textAlign = spec.align;
    const x = inner.x + (spec.align === "left" ? 0 : spec.align === "right" ? canvas.width : canvas.width / 2);
    const blockHeight = best.lines.length * best.size * lineHeight;
    best.lines.forEach((line, index) => {
        const y = inner.y + (canvas.height - blockHeight) / 2 + best.size * lineHeight * (index + 0.5);
        context.fillText(line, x, y);
    });
    // The wall's letters are about 28 map pixels tall; smaller lettering gets a proportionally thinner edge.
    const depth = Math.min(1, Math.max(0.25, best.size / scale / 28));
    return spec.style === "mounted" ? mount(sign, scale, depth) : sign;
}

/**
 * The part of a logo that shows: its file's transparent margins cut away, so a mark drawn small in a large canvas
 * stands as tall as the sign and as close to the name. The whole image when its pixels can't be read.
 */
function logoInk(image: HTMLImageElement): Box {
    const width = image.naturalWidth || image.width || 1;
    const height = image.naturalHeight || image.height || 1;
    const whole = { x: 0, y: 0, width, height };
    // Read at a modest size: enough to find the edges, cheap for a large logo.
    const step = Math.max(1, Math.max(width, height) / 256);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width / step));
    canvas.height = Math.max(1, Math.round(height / step));
    const context = canvas.getContext("2d");
    if (!context) return whole;
    let data: Uint8ClampedArray;
    try {
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    } catch {
        return whole;
    }
    let left = canvas.width;
    let right = -1;
    let top = canvas.height;
    let bottom = -1;
    for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
            if (data[(y * canvas.width + x) * 4 + 3] < 16) continue;
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
        }
    }
    if (right < left) return whole;
    const x = Math.max(0, (left - 1) * step);
    const y = Math.max(0, (top - 1) * step);
    return {
        x,
        y,
        width: Math.min(width, (right + 2) * step) - x,
        height: Math.min(height, (bottom + 2) * step) - y,
    };
}

/** A sign's capitals are this share of the logo's height, with this share of it between the two. */
const SIGN_TEXT = 0.5;
const SIGN_GAP = 0.28;

/**
 * The logo and the name as one sign: the logo as tall as the area, the name beside it, the pair aligned in the area as
 * one (centred by default) and smaller as a whole when it would not fit. With no logo the name stands alone at the size
 * it would have beside one, and with no name the logo does.
 */
export function drawSign(
    image: HTMLImageElement | undefined,
    text: string | undefined,
    spec: BrandSpec,
    area: Pick<AreaData, "width" | "height">,
) {
    const { canvas: sign, scale, inner } = canvasFor(area, spec);
    const context = sign.getContext("2d");
    const value = text ? (spec.upper ? text.toLocaleUpperCase() : text) : undefined;
    if (!context || (!image && !value)) return sign;
    const ink = image ? logoInk(image) : undefined;
    const imageWidth = ink ? ink.width : 0;
    const imageHeight = ink ? ink.height : 1;
    const font = (size: number) => `${spec.weight} ${size}px ${FONT_FAMILY}`;
    context.letterSpacing = spec.upper ? "0.04em" : "0px";
    const layout = (height: number) => {
        const size = Math.max(1, Math.floor(height * SIGN_TEXT));
        context.font = font(size);
        // The letters' ink, so the trailing letter spacing doesn't push the sign off its mark.
        const metrics = value ? context.measureText(value) : undefined;
        const textLeft = metrics ? metrics.actualBoundingBoxLeft : 0;
        const textWidth = metrics ? metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight : 0;
        const logoWidth = image ? (imageWidth * height) / imageHeight : 0;
        const gap = image && value ? height * SIGN_GAP : 0;
        return { height, size, textLeft, textWidth, logoWidth, gap, width: logoWidth + gap + textWidth };
    };
    let fitted = layout(inner.height);
    for (let tries = 0; fitted.width > inner.width && fitted.height > 4 && tries < 40; tries++) {
        // The font size steps in whole pixels, so shrink by the overshoot and check again.
        fitted = layout(Math.max(4, fitted.height * Math.min(0.97, inner.width / fitted.width)));
    }
    const { height, size, textLeft, logoWidth, gap, width } = fitted;
    const left =
        inner.x +
        (spec.align === "left" ? 0 : spec.align === "right" ? inner.width - width : (inner.width - width) / 2);
    const middle = inner.y + inner.height / 2;
    if (image && ink) {
        // The logo is cleaned and toned on its own layer, so the lettering keeps its ink.
        const layer = document.createElement("canvas");
        layer.width = sign.width;
        layer.height = sign.height;
        const logo = { x: left, y: middle - height / 2, width: logoWidth, height };
        const layerContext = layer.getContext("2d");
        if (layerContext) {
            layerContext.imageSmoothingQuality = "high";
            layerContext.drawImage(image, ink.x, ink.y, ink.width, ink.height, logo.x, logo.y, logo.width, logo.height);
            if (spec.style === "mounted" && spec.tone !== "invert") withoutBackdrop(layer, logo);
            context.drawImage(retone(layer, spec.tone, logo), 0, 0);
        }
    }
    if (value) {
        context.font = font(size);
        context.fillStyle = spec.color ?? (spec.tone === "white" ? "#ffffff" : DARK_INK);
        context.textBaseline = "middle";
        context.textAlign = "left";
        context.fillText(value, left + logoWidth + gap + textLeft, middle);
    }
    const depth = Math.min(1, Math.max(0.25, size / scale / 28));
    return spec.style === "mounted" ? mount(sign, scale, depth) : sign;
}

/** Keeps a sign in each brand area of the map, redrawn when an area or the workspace's brand changes. */
export class BrandAreas {
    private readonly shown = new Map<string, { key: string; image: Phaser.GameObjects.Image; texture: string }>();
    /** Signs being drawn, by area id: the key they were started for. */
    private readonly pending = new Map<string, string>();
    /** Keys whose sign could not be drawn (a logo that does not load): not tried again until something changes. */
    private readonly failed = new Set<string>();
    private brand: WorkspaceBrand = { logo: undefined, shortName: undefined, fullName: undefined };
    private destroyed = false;
    private owner: string | undefined;
    private readonly unsubscribe: () => void;
    private readonly unsubscribeOwner: () => void;
    private readonly timer: ReturnType<typeof setInterval>;

    constructor(
        private readonly scene: Phaser.Scene,
        private readonly areas: () => Iterable<AreaData>,
    ) {
        this.unsubscribe = workspaceBrandStore.subscribe((brand) => {
            this.brand = brand;
            this.sync();
        });
        this.unsubscribeOwner = roomOwnerStore.subscribe((owner) => {
            this.owner = owner;
            this.sync();
        });
        // The map editor moves, resizes and renames areas without telling scene code; a cheap look every few seconds.
        this.timer = setInterval(() => this.sync(), 3000);
    }

    private sync(): void {
        const wanted = new Map<string, { area: AreaData; spec: BrandSpec; key: string }>();
        for (const area of this.areas()) {
            const spec = parseBrandArea(area.name);
            if (!spec || area.width <= 0 || area.height <= 0) continue;
            const source = spec.kind === "sign" ? this.signSource(spec) : this.value(spec);
            if (!source) continue;
            const key = JSON.stringify([area.name, area.x, area.y, area.width, area.height, source]);
            wanted.set(area.id, { area, spec, key });
        }
        for (const [id, shown] of this.shown) {
            if (wanted.get(id)?.key !== shown.key) this.remove(id);
        }
        for (const id of this.pending.keys()) {
            if (!wanted.has(id)) this.pending.delete(id);
        }
        for (const [id, { area, spec, key }] of wanted) {
            if (this.shown.has(id) || this.pending.get(id) === key || this.failed.has(key)) continue;
            this.pending.set(id, key);
            this.draw(area, spec)
                .then((canvas) => {
                    if (this.pending.get(id) !== key) return;
                    this.pending.delete(id);
                    if (this.destroyed || this.shown.has(id)) return;
                    this.place(id, key, area, spec, canvas);
                })
                .catch((error) => {
                    if (this.pending.get(id) === key) this.pending.delete(id);
                    this.failed.add(key);
                    console.warn("Workspace sign not drawn", error);
                });
        }
    }

    private async draw(area: AreaData, spec: BrandSpec): Promise<HTMLCanvasElement> {
        if (spec.kind === "logo") {
            const image = await loadImage(this.brand.logo ?? "");
            return drawLogo(image, spec, area);
        }
        // A sign whose logo does not load still shows the name.
        const signLogo =
            spec.kind === "sign" && this.brand.logo
                ? await loadImage(this.brand.logo).catch(() => undefined)
                : undefined;
        await document.fonts?.load(`${spec.weight} 24px ${FONT_FAMILY}`).catch(() => undefined);
        await document.fonts?.ready;
        if (spec.kind === "sign") return drawSign(signLogo, this.value(spec), spec, area);
        return drawName(this.value(spec) ?? "", spec, area);
    }

    /** What a sign shows, as one key: nothing when the workspace has neither a logo nor the name. */
    private signSource(spec: BrandSpec): string | undefined {
        const name = this.value(spec);
        return this.brand.logo || name ? JSON.stringify([this.brand.logo ?? null, name ?? null]) : undefined;
    }

    private value(spec: BrandSpec): string | undefined {
        switch (spec.kind) {
            case "logo":
                return this.brand.logo;
            case "name":
                return this.brand.shortName;
            case "owner":
                return this.owner;
            case "sign":
                return spec.full ? (this.brand.fullName ?? this.brand.shortName) : this.brand.shortName;
            default:
                return this.brand.fullName ?? this.brand.shortName;
        }
    }

    private place(id: string, key: string, area: AreaData, spec: BrandSpec, canvas: HTMLCanvasElement): void {
        const texture = `quanta-brand-${id}-${Date.now()}`;
        // The room samples its pixel art nearest-pixel; a sign is enlarged three to four times, so it is smoothed
        // instead, or its curves and edges come out jagged (0 is Phaser's FilterMode.LINEAR).
        this.scene.textures.addCanvas(texture, canvas)?.setFilter(0);
        const image = this.scene.add.image(area.x + area.width / 2, area.y + area.height / 2, texture);
        image.setDisplaySize(area.width, area.height);
        image.setAlpha(spec.opacity);
        image.setDepth(DEPTH);
        this.shown.set(id, { key, image, texture });
        (this.scene as Phaser.Scene & { markDirty?: () => void }).markDirty?.();
    }

    private remove(id: string): void {
        const shown = this.shown.get(id);
        if (!shown) return;
        shown.image.destroy();
        this.scene.textures.remove(shown.texture);
        this.shown.delete(id);
    }

    destroy(): void {
        this.destroyed = true;
        this.pending.clear();
        clearInterval(this.timer);
        this.unsubscribe();
        this.unsubscribeOwner();
        for (const id of [...this.shown.keys()]) this.remove(id);
    }
}
