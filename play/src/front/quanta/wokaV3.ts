/**
 * quanta: Quanta's own wokas (v3), built from parts, one sprite sheet per part, stacked in a fixed order. The parts
 * and their colours come from wokaV3Manifest.ts, which the art generator writes beside the sheets. Quanta web's
 * Settings page builds the same picks (web/src/lib/workadventure/woka-v3.ts): keep the two alike.
 *
 * A pick is texture ids bottom first, as WA stores and draws them: skin, eyes, shoes, bottoms, top, hair and,
 * optionally, glasses. Every style comes in every colour, so any combination is a valid pick.
 */
import { WOKA_V3_MANIFEST } from "./wokaV3Manifest";
import type { WokaV3ManifestOption } from "./wokaV3Manifest";

export type WokaV3Part = "skin" | "eyes" | "shoes" | "bottoms" | "top" | "hair" | "glasses";
export interface WokaV3Pick {
    style: string;
    colour: string;
}
export type WokaV3Look = Record<WokaV3Part, WokaV3Pick | null>;

export interface WokaV3Layer {
    /** The catalogue's layer key (quantaSkin, quantaEyes, ...). */
    key: string;
    part: WokaV3Part;
    label: string;
    optional: boolean;
    styles: WokaV3ManifestOption[];
    colours: WokaV3ManifestOption[];
}

export const WOKA_V3_LAYERS = WOKA_V3_MANIFEST.layers as WokaV3Layer[];
export const WOKA_V3_PARTS: WokaV3Part[] = WOKA_V3_LAYERS.map((l) => l.part);
const LAYER = Object.fromEntries(WOKA_V3_LAYERS.map((l) => [l.part, l])) as Record<WokaV3Part, WokaV3Layer>;

export const WOKA_V3_URL_PREFIX = "resources/characters/quanta-v3/";

export function wokaV3Layer(part: WokaV3Part): WokaV3Layer {
    return LAYER[part];
}

export function v3TextureId(part: WokaV3Part, pick: WokaV3Pick): string {
    return part === "skin" ? `q3-skin-${pick.colour}` : `q3-${part}-${pick.style}-${pick.colour}`;
}

export function v3TextureUrl(part: WokaV3Part, pick: WokaV3Pick): string {
    return `${WOKA_V3_URL_PREFIX}${part}/${part === "skin" ? pick.colour : `${pick.style}-${pick.colour}`}.png`;
}

function known(part: WokaV3Part, pick: WokaV3Pick): boolean {
    const layer = LAYER[part];
    return (
        !!layer && layer.styles.some((s) => s.id === pick.style) && layer.colours.some((c) => c.id === pick.colour)
    );
}

/** The pick's ids, bottom layer first. */
export function lookToIds(look: WokaV3Look): string[] {
    return WOKA_V3_PARTS.flatMap((part) => {
        const pick = look[part];
        return pick ? [v3TextureId(part, pick)] : [];
    });
}

/** A v3 pick back into its parts; null when it is not one (a stock woka, an older layered one, a gap). */
export function idsToLook(ids: readonly string[]): WokaV3Look | null {
    const look = Object.fromEntries(WOKA_V3_PARTS.map((p) => [p, null])) as WokaV3Look;
    for (const id of ids) {
        const m = /^q3-(skin|eyes|shoes|bottoms|top|hair|glasses)-(?:([a-z]+)-)?([a-z]+)$/.exec(id);
        if (!m) return null;
        const part = m[1] as WokaV3Part;
        const pick = { style: part === "skin" ? "skin" : m[2] ?? "", colour: m[3] };
        if ((part === "skin") !== (m[2] === undefined) || !known(part, pick) || look[part]) return null;
        look[part] = pick;
    }
    return WOKA_V3_LAYERS.every((l) => l.optional || look[l.part]) ? look : null;
}

type Random = () => number;

function weighted(random: Random, weights: Record<string, number>): string {
    const entries = Object.entries(weights);
    let r = random() * entries.reduce((sum, [, w]) => sum + w, 0);
    for (const [value, w] of entries) {
        r -= w;
        if (r < 0) return value;
    }
    return entries[entries.length - 1][0];
}

function any<T>(random: Random, list: readonly T[]): T {
    return list[Math.floor(random() * list.length) % list.length];
}

const styleIds = (part: WokaV3Part) => LAYER[part].styles.map((s) => s.id);
const colourIds = (part: WokaV3Part) => LAYER[part].colours.map((c) => c.id);

// Curated so a random woka looks put together: mostly natural hair and eye colours, bottoms and shoes that go with
// the top, glasses now and then. The same rules as Quanta web's Randomize.
const EYE_COLOURS = { dark: 22, brown: 26, hazel: 14, amber: 8, green: 10, blue: 12, grey: 6, violet: 2 };
const HAIR_COLOURS = {
    black: 17,
    espresso: 17,
    brown: 15,
    chestnut: 10,
    auburn: 7,
    copper: 6,
    strawberry: 5,
    golden: 9,
    ash: 4,
    silver: 2,
    blue: 2,
    pink: 2,
    purple: 2,
    teal: 2,
};
const QUIET_TOPS = new Set(["white", "charcoal", "navy", "sky", "lavender", "pink", "mustard"]);
const PLAIN_BOTTOMS = ["denim", "darkdenim", "lightdenim", "black", "grey", "khaki", "navy"];
const BOLD_BOTTOMS = ["brown", "olive", "burgundy"];
const PLAIN_SHOES = { white: 34, black: 24, grey: 10, brown: 14 };
const BOLD_SHOES: Record<string, string[]> = {
    red: ["red", "burgundy", "pink"],
    navy: ["navy", "royal", "sky"],
    green: ["green", "olive", "teal"],
    pink: ["pink", "lavender", "red"],
};

export function randomLook(random: Random = Math.random): WokaV3Look {
    const top = { style: any(random, styleIds("top")), colour: any(random, colourIds("top")) };
    const bottomsColours = QUIET_TOPS.has(top.colour)
        ? [...PLAIN_BOTTOMS, ...BOLD_BOTTOMS]
        : PLAIN_BOTTOMS.filter((c) => c !== top.colour);
    const boldShoes = Object.keys(BOLD_SHOES).filter(
        (c) => QUIET_TOPS.has(top.colour) || BOLD_SHOES[c].includes(top.colour),
    );
    const shoeColour = boldShoes.length && random() < 0.2 ? any(random, boldShoes) : weighted(random, PLAIN_SHOES);
    return {
        skin: { style: "skin", colour: any(random, colourIds("skin")) },
        eyes: { style: any(random, styleIds("eyes")), colour: weighted(random, EYE_COLOURS) },
        shoes: { style: any(random, styleIds("shoes")), colour: shoeColour },
        bottoms: { style: any(random, styleIds("bottoms")), colour: any(random, bottomsColours) },
        top,
        hair: { style: any(random, styleIds("hair")), colour: weighted(random, HAIR_COLOURS) },
        glasses:
            random() < 0.22
                ? { style: any(random, styleIds("glasses")), colour: any(random, colourIds("glasses")) }
                : null,
    };
}
