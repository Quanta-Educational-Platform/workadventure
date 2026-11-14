import { describe, expect, it } from "vitest";
import { PathfindingManager } from "./PathfindingManager";

const TILE = { width: 32, height: 32 };
// 6×4 tiles, nothing colliding: the map's edge tiles are walkable.
const OPEN = Array.from({ length: 4 }, () => Array<number>(6).fill(0));

function within(point: { x: number; y: number }, grid: number[][]): boolean {
    return point.x >= 0 && point.y >= 0 && point.x < grid[0].length * TILE.width && point.y < grid.length * TILE.height;
}

describe("PathfindingManager", () => {
    it.each([
        ["above", { x: 100, y: -200 }],
        ["below", { x: 100, y: 400 }],
        ["left of", { x: -300, y: 60 }],
        ["right of", { x: 900, y: 60 }],
        ["exactly on the right edge of", { x: 6 * 32, y: 60 }],
    ])("a target %s the map ends the path inside the map", async (_, target) => {
        const manager = new PathfindingManager(OPEN, TILE);
        const path = await manager.findPathFromGameCoordinates({ x: 80, y: 60 }, target, true);
        expect(path.length).toBeGreaterThan(1);
        for (const point of path) expect(within(point, OPEN)).toBe(true);
    });
});
