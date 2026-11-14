import { describe, expect, it } from "vitest";
import type { ITiledMap } from "@workadventure/tiled-map-type-guard";
import { mapCredits, quantaAssetCredits } from "./mapCredits";

type Map = Pick<ITiledMap, "properties" | "tilesets" | "layers">;

const tileset = (copyright?: string) =>
    ({
        name: "t",
        firstgid: 1,
        ...(copyright === undefined
            ? {}
            : { properties: [{ name: "tilesetCopyright", type: "string", value: copyright }] }),
    }) as unknown as Map["tilesets"][number];

const layer = (type: string, copyright?: string) =>
    ({
        type,
        name: "l",
        ...(copyright === undefined
            ? {}
            : { properties: [{ name: "audioCopyright", type: "string", value: copyright }] }),
    }) as unknown as Map["layers"][number];

describe("mapCredits", () => {
    it("reads the map's own properties", () => {
        const credits = mapCredits(
            {
                properties: [
                    { name: "mapName", type: "string", value: "Classroom" },
                    { name: "mapLink", type: "string", value: "https://example.org/map" },
                    { name: "mapDescription", type: "string", value: "A room" },
                    { name: "mapCopyright", type: "string", value: "CC-BY-SA 3.0" },
                ],
                tilesets: [],
                layers: [],
            } as unknown as Map,
            [],
        );
        expect(credits).toEqual({
            name: "Classroom",
            link: "https://example.org/map",
            description: "A room",
            mapCopyright: "CC-BY-SA 3.0",
            tilesets: [],
            audio: [],
        });
    });

    it("leaves the map's copyright undefined when the map declares none, or not as text", () => {
        const credits = mapCredits(
            {
                properties: [{ name: "mapCopyright", type: "int", value: 3 }],
                tilesets: [],
                layers: [],
            } as unknown as Map,
            [],
        );
        expect(credits.mapCopyright).toBeUndefined();
        expect(credits.name).toBe("");
    });

    it("lists each tileset's and tile layer's copyright once, in map order", () => {
        const credits = mapCredits(
            {
                properties: undefined,
                tilesets: [tileset("A"), tileset(), tileset("B"), tileset("A")],
                layers: [layer("tilelayer", "Music"), layer("objectgroup", "Ignored"), layer("tilelayer", "Music")],
            } as unknown as Map,
            [],
        );
        expect(credits.tilesets).toEqual(["A", "B"]);
        expect(credits.audio).toEqual(["Music"]);
    });

    it("adds the room editor's asset credits in Quanta, without repeating one the map already names", () => {
        const assets = quantaAssetCredits({ creditLimeZu: () => "LimeZu", creditWorkAdventure: () => "WorkAdventure" });
        expect(assets).toEqual(["LimeZu", "WorkAdventure"]);
        const credits = mapCredits(
            {
                properties: [],
                tilesets: [tileset("A"), tileset(assets[0])],
                layers: [],
            } as unknown as Map,
            assets,
        );
        expect(credits.tilesets).toEqual(["A", ...assets]);
    });
});
