import * as Phaser from "phaser";
globalThis.Phaser = Phaser;

import { describe, expect, it } from "vitest";
import { PathTileType } from "../../../Utils/PathfindingManager";
import { GameMapFrontWrapper } from "./GameMapFrontWrapper";

const WIDTH = 3;
const HEIGHT = 2;

function layer(name: string, visible: boolean, colliding: Array<[number, number]>) {
    const data = Array.from({ length: HEIGHT }, (_, y) =>
        Array.from({ length: WIDTH }, (_, x) => ({
            index: colliding.some(([cx, cy]) => cx === x && cy === y) ? 1 : -1,
            properties: colliding.some(([cx, cy]) => cx === x && cy === y) ? { collides: true } : {},
        })),
    );
    let shown = visible;
    return {
        layerIndex: name.length,
        layer: { name, data, properties: [] },
        get visible() {
            return shown;
        },
        setVisible(value: boolean) {
            shown = value;
            return this;
        },
        setCollisionByProperty() {
            return this;
        },
    };
}

// The wrapper with only what the collision grid reads: its map and tile layers.
function wrapperWith(layers: ReturnType<typeof layer>[]): GameMapFrontWrapper {
    const wrapper = Object.create(GameMapFrontWrapper.prototype) as GameMapFrontWrapper;
    Object.assign(wrapper, {
        gameMap: { getMap: () => ({ width: WIDTH, height: HEIGHT }), getWamFile: () => undefined },
        phaserLayers: layers,
        collisionGridDirty: true,
        areasCollisionLayerDirty: false,
        perLayerCollisionGridCache: new Map(),
        dirtyLayerIndices: new Set(),
        collisionsOffLayers: new Set(),
        mapChangedSubject: { next: () => undefined },
    });
    return wrapper;
}

describe("GameMapFrontWrapper collision grid", () => {
    it("keeps the walls of a collisions layer hidden in the map file, as the player's body collides with them", () => {
        const wrapper = wrapperWith([layer("floor", true, []), layer("collisions", false, [[0, 0]])]);
        expect(wrapper.getCollisionGrid({ emitMapChangedEvent: false })[0][0]).toBe(PathTileType.Collider);
    });

    it("drops the walls of a layer a script hides, and takes them back when it shows the layer again", () => {
        const wrapper = wrapperWith([layer("floor", true, []), layer("door", true, [[1, 1]])]);
        wrapper.setLayerVisibility("door", false);
        expect(wrapper.getCollisionGrid({ emitMapChangedEvent: false })[1][1]).toBe(PathTileType.Walkable);
        wrapper.setLayerVisibility("door", true);
        expect(wrapper.getCollisionGrid({ emitMapChangedEvent: false })[1][1]).toBe(PathTileType.Collider);
    });
});
