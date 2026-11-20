// quanta: the dock's speaker-spot button for students. One press walks the player to the nearest free megaphone spot
// (they speak to the class from it), the next walks them back to where they came from. It works from the board,
// a full-screen camera or a screen share too, so nobody has to leave what they watch to find a spot on the map.
import { get, writable } from "svelte/store";
import { gameManager } from "../Phaser/Game/GameManager";
import { LONG_NOTIFICATION_MS, notificationPlayingStore } from "../Stores/NotificationStore";
import { QL } from "./i18n";
import { walkQuietlyTo } from "./goTo";
import { AREA_FEET_OFFSET_Y, freeTile, standTilesOf, tileKey, type Tile } from "./goToTile";
import { isMegaphoneSpot, lectureSpeakerZoneOf, onSpotStore } from "./megaphoneSpots";

type Trip = { from: { x: number; y: number }; arrived: boolean };

const trip = writable<Trip | undefined>(undefined);
/** Set from the press that walks to a spot until the player leaves the spot again, by the button or on foot. */
export const spotTripStore = { subscribe: trip.subscribe };

// Once there, stepping off the spot (by the button or on foot) ends the trip. On the way the route may brush the
// spot's edge first, so arriving is judged only when the walk is over.
onSpotStore.subscribe((onSpot) => {
    if (!onSpot && get(trip)?.arrived) trip.set(undefined);
});

export function goToNearestSpot(): void {
    const scene = gameManager.getCurrentGameScene();
    const map = scene.getGameMapFrontWrapper();
    const { width, height } = map.getTileDimensions();
    const toTile = (point: { x: number; y: number }): Tile => ({
        x: Math.floor(point.x / width),
        y: Math.floor(point.y / height),
    });
    const toPixels = (tile: Tile) => ({ x: tile.x * width + width / 2, y: tile.y * height + height / 2 });
    const gameMapAreas = map.getGameMap().getWamFile()?.getGameMapAreas();
    if (!gameMapAreas) return;
    const areas = [...gameMapAreas.getAreas().values()];
    const others = [...scene.MapPlayersByKey.values()];
    const occupied = new Set(others.map((player) => tileKey(toTile(player))));
    const free = freeTile(map.getCollisionGrid({ emitMapChangedEvent: false }), occupied, (tile) =>
        scene.isPositionAllowedForCurrentUser(toPixels(tile)),
    );
    const inArea = (area: { x: number; y: number; width: number; height: number }, point: { x: number; y: number }) =>
        point.x >= area.x &&
        point.x <= area.x + area.width &&
        point.y + AREA_FEET_OFFSET_Y >= area.y &&
        point.y + AREA_FEET_OFFSET_Y <= area.y + area.height;
    const me = { x: scene.CurrentPlayer.x, y: scene.CurrentPlayer.y };

    let best: { tile: Tile; distance: number } | undefined;
    for (const spot of areas) {
        if (!isMegaphoneSpot(spot) || !lectureSpeakerZoneOf(spot, areas)) continue;
        // Someone already speaks from it: two on one spot reads as a mistake.
        if (others.some((player) => inArea(spot, player))) continue;
        const centre = { x: spot.x + spot.width / 2, y: spot.y + spot.height / 2 };
        // The marked tile first (spotMarks.ts), else the next free one in the spot.
        const spotTile = standTilesOf(spot, width, height).find(free);
        if (!spotTile) continue;
        const distance = Math.hypot(centre.x - me.x, centre.y - me.y);
        if (!best || distance < best.distance) best = { tile: spotTile, distance };
    }
    if (!best) {
        notificationPlayingStore.playNotification(get(QL).noFreeSpot(), "megaphone", undefined, LONG_NOTIFICATION_MS);
        return;
    }
    const started: Trip = { from: me, arrived: false };
    trip.set(started);
    void walkQuietlyTo(scene, toPixels(best.tile)).then(() => {
        // Turned round on the way, or walked off by hand before getting there.
        if (get(trip) !== started) return;
        trip.set(get(onSpotStore) ? { ...started, arrived: true } : undefined);
    });
}

export function comeBackFromSpot(): void {
    const current = get(trip);
    if (!current) return;
    // Back on foot ends the trip as the spot is left; a press while still on the way just turns round.
    if (!current.arrived) trip.set(undefined);
    void walkQuietlyTo(gameManager.getCurrentGameScene(), current.from);
}

export function forgetSpotTrip(): void {
    trip.set(undefined);
}
