// quanta: furniture one can be behind or in front of, such as a chair's back, can't be on the layers below or above
// every woka. A tile layer with the map property quantaDepth is drawn at that depth instead: a woka's depth is its feet,
// so whoever's feet are above that line passes behind the layer, and whoever's feet are below it passes in front.
export const LAYER_DEPTH_PROPERTY = "quantaDepth";

export function tileLayerDepth(
    properties: ReadonlyArray<{ name: string; value?: unknown }> | undefined,
    fallback: number,
): number {
    const value = properties?.find((property) => property.name === LAYER_DEPTH_PROPERTY)?.value;
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
