import type { ITiledMap } from "@workadventure/tiled-map-type-guard";
import type { QLStrings } from "./i18n";

export interface MapCredits {
    name: string;
    link: string;
    description: string;
    /** Undefined when the map declares none. */
    mapCopyright: string | undefined;
    tilesets: string[];
    audio: string[];
}

// The room editor's furniture is placed as entities, not tiles, so the map names none of it.
export function quantaAssetCredits(ql: Pick<QLStrings, "creditLimeZu" | "creditWorkAdventure">): string[] {
    return [ql.creditLimeZu(), ql.creditWorkAdventure()];
}

type Properties = { name: string; value?: unknown }[] | undefined;

function stringProperty(properties: Properties, name: string): string | undefined {
    const value = properties?.find((property) => property.name === name)?.value;
    return typeof value === "string" ? value : undefined;
}

/** The credits WA's "Credit" menu page shows, read from the map's, its tilesets' and its tile layers' properties. */
export function mapCredits(
    map: Pick<ITiledMap, "properties" | "tilesets" | "layers">,
    assetCredits: readonly string[],
): MapCredits {
    const tilesets = new Set<string>();
    for (const tileset of map.tilesets) {
        const copyright = "properties" in tileset ? stringProperty(tileset.properties, "tilesetCopyright") : undefined;
        if (copyright !== undefined) tilesets.add(copyright);
    }
    for (const credit of assetCredits) tilesets.add(credit);

    const audio = new Set<string>();
    for (const layer of map.layers) {
        if (layer.type !== "tilelayer") continue;
        const copyright = stringProperty(layer.properties, "audioCopyright");
        if (copyright !== undefined) audio.add(copyright);
    }

    return {
        name: stringProperty(map.properties, "mapName") ?? "",
        link: stringProperty(map.properties, "mapLink") ?? "",
        description: stringProperty(map.properties, "mapDescription") ?? "",
        mapCopyright: stringProperty(map.properties, "mapCopyright"),
        tilesets: [...tilesets],
        audio: [...audio],
    };
}
