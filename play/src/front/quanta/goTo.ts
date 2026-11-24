import { get } from "svelte/store";
import { AskPositionMessage_AskType, PositionMessage_Direction } from "@workadventure/messages";
import { gameManager } from "../Phaser/Game/GameManager";
import type { GameScene } from "../Phaser/Game/GameScene";
import { raisedHandSectionsStore } from "../Stores/PeerStore";
import { PathfindingManager, PathTileType } from "../Utils/PathfindingManager";
import { awaitAskedPosition } from "./goToPending";
import {
    AREA_FEET_OFFSET_Y,
    freeTile,
    listenerZonesOf,
    quietToStandIn,
    tileBeside,
    tileKey,
    type Facing,
    type Tile,
} from "./goToTile";

/** Someone to go to: by their space user id (a raised hand) or their user uuid (the people list). */
export type GoToTarget = { id?: string; uuid?: string };

function facingOf(direction: number): Facing {
    switch (direction) {
        case PositionMessage_Direction.UP:
            return "up";
        case PositionMessage_Direction.LEFT:
            return "left";
        case PositionMessage_Direction.RIGHT:
            return "right";
        default:
            return "down";
    }
}

/** A space user id is `${roomUrl}_${userId}`. */
function playerIdOf(spaceUserId: string): number | undefined {
    const id = Number(spaceUserId.slice(spaceUserId.lastIndexOf("_") + 1));
    return spaceUserId.includes("_") && Number.isInteger(id) ? id : undefined;
}

function uuidOf(spaceUserId: string): string | undefined {
    for (const section of get(raisedHandSectionsStore)) {
        const uuid = get(section.space.usersStore).get(spaceUserId)?.uuid;
        if (uuid) return uuid;
    }
    return undefined;
}

function walkBeside(scene: GameScene, at: { x: number; y: number }, direction: number, targetId?: number): void {
    const map = scene.getGameMapFrontWrapper();
    const { width, height } = map.getTileDimensions();
    const toTile = (point: { x: number; y: number }): Tile => ({
        x: Math.floor(point.x / width),
        y: Math.floor(point.y / height),
    });
    const toPixels = (tile: Tile) => ({ x: tile.x * width + width / 2, y: tile.y * height + height / 2 });
    const occupied = new Set([tileKey(toTile(at))]);
    for (const player of scene.MapPlayersByKey.values())
        if (player.userId !== targetId) occupied.add(tileKey(toTile(player)));
    const gameMapAreas = map.getGameMap().getWamFile()?.getGameMapAreas();
    const areasAt = (tile: Tile) => gameMapAreas?.getAreasOnPosition(toPixels(tile), AREA_FEET_OFFSET_Y) ?? [];
    const allowed = freeTile(map.getCollisionGrid({ emitMapChangedEvent: false }), occupied, (candidate) =>
        scene.isPositionAllowedForCurrentUser(toPixels(candidate)),
    );
    const targetZones = listenerZonesOf(gameMapAreas?.getAreasOnPosition(at, AREA_FEET_OFFSET_Y) ?? []);
    const tile = tileBeside(
        toTile(at),
        facingOf(direction),
        (candidate) => allowed(candidate) && quietToStandIn(areasAt(candidate)),
        (candidate) => listenerZonesOf(areasAt(candidate)) === targetZones,
    );
    // Rather stay put than land somewhere that broadcasts or opens something.
    if (!tile) return;
    void walkQuietlyTo(scene, toPixels(tile));
}

/**
 * Walks the player to a point. Crossing a megaphone, board or call on the way would open it for a moment: those are
 * walls for the route, apart from the ones the walk starts or ends in. Settles once the walk is over, whatever ended it.
 */
export function walkQuietlyTo(scene: GameScene, destination: { x: number; y: number }): Promise<void> {
    const map = scene.getGameMapFrontWrapper();
    const { width, height } = map.getTileDimensions();
    const toTile = (point: { x: number; y: number }): Tile => ({
        x: Math.floor(point.x / width),
        y: Math.floor(point.y / height),
    });
    const gameMapAreas = map.getGameMap().getWamFile()?.getGameMapAreas();
    const ends = [toTile(scene.CurrentPlayer), toTile(destination)];
    const grid = map.getCollisionGrid({ emitMapChangedEvent: false });
    const quietGrid = grid.map((row) => [...row]);
    for (const area of gameMapAreas?.getAreas().values() ?? []) {
        if (quietToStandIn([area])) continue;
        const x0 = Math.max(0, Math.floor(area.x / width));
        const x1 = Math.ceil((area.x + area.width) / width);
        const y0 = Math.max(0, Math.floor(area.y / height));
        const y1 = Math.min(quietGrid.length, Math.ceil((area.y + area.height) / height));
        if (ends.some((end) => end.x >= x0 && end.x < x1 && end.y >= y0 && end.y < y1)) continue;
        for (let row = y0; row < y1; row++) quietGrid[row].fill(PathTileType.Collider, x0, x1);
    }
    return walkThere(scene, destination, [quietGrid, grid]).catch((error: unknown) => {
        console.warn("Go to could not walk, teleporting", error);
        scene.CurrentPlayer.teleportTo(destination.x, destination.y);
    });
}

// A walk, never a jump, at running pace (WOKA_SPEED 9 walks 180 px a second, Shift runs 450): it gets going and stops
// in a moment, so crossing a classroom takes under two seconds. A long walk across a big map is sped up to end
// within WALK_SECONDS_MAX.
const WALK_PX_PER_SECOND = 480;
const WALK_RAMP_SECONDS = 0.2;
const WALK_SECONDS_MAX = 3;

/** Walks the player there along the first grid with a route. Where none has one, a straight walk would cross walls,
 * calls and megaphone spots (opening the microphone to them on the way): it lands on the quiet tile instead. */
async function walkThere(scene: GameScene, to: { x: number; y: number }, grids: number[][][]): Promise<void> {
    // Searched apart from the scene's own pathfinding: a click meanwhile neither cancels this search nor finds the
    // quiet grid left in place.
    const tiles = scene.getGameMapFrontWrapper().getTileDimensions();
    const from = { x: scene.CurrentPlayer.x, y: scene.CurrentPlayer.y };
    let path: { x: number; y: number }[] = [];
    for (const grid of grids) {
        const pathfinding = new PathfindingManager(grid, tiles);
        // One grid after the other, the quiet route first.
        // eslint-disable-next-line no-await-in-loop
        path = await pathfinding.findPathFromGameCoordinates(from, to);
        if (path.length > 1) break;
    }
    // The player walked off on their own while the route was searched: theirs wins.
    if (scene.CurrentPlayer.x !== from.x || scene.CurrentPlayer.y !== from.y) return;
    if (path.length <= 1) {
        scene.CurrentPlayer.teleportTo(to.x, to.y);
        return;
    }
    await walk(scene, path);
}

async function walk(scene: GameScene, path: { x: number; y: number }[]): Promise<void> {
    let length = 0;
    let at = { x: scene.CurrentPlayer.x, y: scene.CurrentPlayer.y };
    for (const point of path) {
        length += Math.hypot(point.x - at.x, point.y - at.y);
        at = point;
    }
    const cruise = Math.max(WALK_PX_PER_SECOND, length / (WALK_SECONDS_MAX - WALK_RAMP_SECONDS));
    // Character.followPath moves speed × 20 pixels a second; the speed stays for a route GameScene redoes on the way.
    await scene.CurrentPlayer.setPathToFollow(path, cruise / 20, { cruise, ramp: WALK_RAMP_SECONDS });
}

/**
 * Takes the local player next to someone in the room. Players this one sees are found on the map; anyone further
 * away is asked of the room's server. Someone who left is ignored.
 */
export function goTo(target: GoToTarget): void {
    const scene = gameManager.getCurrentGameScene();
    const userId = target.id ? playerIdOf(target.id) : undefined;
    const seen =
        userId !== undefined
            ? scene.MapPlayersByKey.get(userId)
            : [...scene.MapPlayersByKey.values()].find((player) => player.userUuid === target.uuid);
    if (seen) {
        walkBeside(scene, seen, seen.lastDirection, seen.userId);
        return;
    }
    const uuid =
        target.uuid ??
        (userId !== undefined ? scene.getRemotePlayersRepository().getPlayers().get(userId)?.userUuid : undefined) ??
        (target.id ? uuidOf(target.id) : undefined);
    if (!uuid || !scene.connection) return;
    awaitAskedPosition((position) => walkBeside(scene, position, position.direction, userId));
    scene.connection.emitAskPosition(uuid, scene.roomUrl, AskPositionMessage_AskType.MOVE, userId);
}
