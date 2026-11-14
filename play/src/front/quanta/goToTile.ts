export type Tile = { x: number; y: number };
export type Facing = "up" | "down" | "left" | "right";

const AHEAD: Record<Facing, Tile> = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
};

/**
 * Where to stand next to someone: the tile they face, then their sides, behind them, then the corners, so the two
 * end up face to face where the map allows; then the ring around those. Tiles `preferred` says yes to come first.
 * Undefined when nothing around is free.
 */
export function tileBeside(
    target: Tile,
    facing: Facing,
    isFree: (tile: Tile) => boolean,
    preferred: (tile: Tile) => boolean = () => true,
): Tile | undefined {
    const ahead = AHEAD[facing];
    const side = { x: ahead.y, y: ahead.x };
    const steps: Tile[] = [
        ahead,
        side,
        { x: -side.x, y: -side.y },
        { x: -ahead.x, y: -ahead.y },
        { x: ahead.x + side.x, y: ahead.y + side.y },
        { x: ahead.x - side.x, y: ahead.y - side.y },
        { x: -ahead.x + side.x, y: -ahead.y + side.y },
        { x: -ahead.x - side.x, y: -ahead.y - side.y },
    ];
    const ring: Tile[] = [];
    for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) === 2) ring.push({ x: dx, y: dy });
    // Nearest first; ties go to the side the target faces.
    ring.sort(
        (a, b) =>
            Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y) ||
            b.x * ahead.x + b.y * ahead.y - (a.x * ahead.x + a.y * ahead.y),
    );
    const candidates = [...steps, ...ring]
        .map((step) => ({ x: target.x + step.x, y: target.y + step.y }))
        .filter(isFree);
    return candidates.find(preferred) ?? candidates[0];
}

/** Area properties that change nothing for whoever stands in them: rights are checked apart, by `allowed`. */
const NEUTRAL_PROPERTIES = new Set([
    "listenerMegaphone",
    "areaDescriptionProperties",
    "restrictedRightsPropertyData",
    "start",
    "highlight",
    "tooltipPropertyData",
    "entityDescriptionProperties",
]);

type StandArea = { name?: string; properties: ReadonlyArray<{ type: string }> };

/**
 * Whether arriving in these areas does nothing on its own: no table megaphone spot (the whole class would hear),
 * no podium or other speaker zone, no board, website, call, sound or exit.
 */
export function quietToStandIn(areas: ReadonlyArray<StandArea>): boolean {
    return areas.every(
        (area) =>
            !(area.name ?? "").startsWith("quanta:megaphone:") &&
            !(area.name ?? "").startsWith("quanta:whiteboard:") &&
            area.properties.every((property) => NEUTRAL_PROPERTIES.has(property.type)),
    );
}

/** The listener zones one hears the lecture in, as a comparable key. */
export function listenerZonesOf(
    areas: ReadonlyArray<{ properties: ReadonlyArray<{ type: string; speakerZoneName?: string }> }>,
): string {
    const zones = new Set<string>();
    for (const area of areas)
        for (const property of area.properties)
            if (property.type === "listenerMegaphone") zones.add(property.speakerZoneName ?? "");
    return [...zones].sort().join("|");
}

/** Areas trigger at a player's feet, this far below the centre of their sprite (GameMapAreas). */
export const AREA_FEET_OFFSET_Y = 16;

/** The tile types of the collision grid one may stand on (PathTileType): not a wall, not an exit to another map. */
const STANDABLE = new Set([0, 3, 4, 5]);

/** A free tile: inside the map, standable, nobody else on it, and allowed to the user (`allowed`). */
export function freeTile(
    grid: number[][],
    occupied: ReadonlySet<string>,
    allowed: (tile: Tile) => boolean = () => true,
): (tile: Tile) => boolean {
    return (tile) => {
        const type = grid[tile.y]?.[tile.x];
        return type !== undefined && STANDABLE.has(type) && !occupied.has(tileKey(tile)) && allowed(tile);
    };
}

export function tileKey(tile: Tile): string {
    return `${tile.x},${tile.y}`;
}
