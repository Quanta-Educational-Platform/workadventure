import { expect, it } from "vitest";
import { GameMapAreas, type AreaData, type WAMFileFormat } from "@workadventure/map-editor";
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

// 0 walkable, 1 wall, 2 exit, 3 start, 4 meeting room, 5 personal desk.
const open = (width: number, height: number) => Array.from(Array(height), () => Array(width).fill(0));

it("stands on the tile the target faces", () => {
    const free = freeTile(open(5, 5), new Set(["2,2"]));
    expect(tileBeside({ x: 2, y: 2 }, "down", free)).toEqual({ x: 2, y: 3 });
    expect(tileBeside({ x: 2, y: 2 }, "up", free)).toEqual({ x: 2, y: 1 });
    expect(tileBeside({ x: 2, y: 2 }, "left", free)).toEqual({ x: 1, y: 2 });
    expect(tileBeside({ x: 2, y: 2 }, "right", free)).toEqual({ x: 3, y: 2 });
});

it("goes beside, then behind, then to a corner when the tiles before are walls or taken", () => {
    const grid = open(5, 5);
    grid[3][2] = 1;
    expect(tileBeside({ x: 2, y: 2 }, "down", freeTile(grid, new Set()))).toEqual({ x: 3, y: 2 });
    expect(tileBeside({ x: 2, y: 2 }, "down", freeTile(grid, new Set(["3,2"])))).toEqual({ x: 1, y: 2 });
    grid[2][1] = 1;
    grid[2][3] = 2;
    expect(tileBeside({ x: 2, y: 2 }, "down", freeTile(grid, new Set()))).toEqual({ x: 2, y: 1 });
    grid[1][2] = 1;
    expect(tileBeside({ x: 2, y: 2 }, "down", freeTile(grid, new Set(["3,3"])))).toEqual({ x: 1, y: 3 });
});

it("stays inside the map and keeps out of areas the user may not enter", () => {
    const free = freeTile(open(3, 3), new Set(), (tile) => tile.x !== 1);
    expect(tileBeside({ x: 0, y: 0 }, "up", free)).toEqual({ x: 0, y: 1 });
    expect(tileBeside({ x: 0, y: 0 }, "left", free)).toEqual({ x: 0, y: 1 });
});

it("finds nothing when nothing around is free", () => {
    const grid = [
        [1, 1, 1],
        [1, 0, 1],
        [1, 1, 1],
    ];
    expect(tileBeside({ x: 1, y: 1 }, "down", freeTile(grid, new Set()))).toBeUndefined();
});

it("accepts start, meeting room and desk tiles", () => {
    for (const type of [3, 4, 5]) expect(freeTile([[type]], new Set())({ x: 0, y: 0 })).toBe(true);
    expect(freeTile([[0]], new Set([tileKey({ x: 0, y: 0 })]))({ x: 0, y: 0 })).toBe(false);
});

it("reaches two tiles out, nearest first, when the ring next to the target is taken", () => {
    const taken = new Set(["2,2", "1,1", "2,1", "3,1", "1,2", "3,2", "1,3", "2,3", "3,3"]);
    expect(tileBeside({ x: 2, y: 2 }, "down", freeTile(open(5, 5), taken))).toEqual({ x: 2, y: 4 });
});

it("prefers tiles the caller prefers, else takes any free one", () => {
    const free = freeTile(open(5, 5), new Set(["2,2"]));
    expect(tileBeside({ x: 2, y: 2 }, "down", free, (tile) => tile.x === 1)).toEqual({ x: 1, y: 2 });
    expect(tileBeside({ x: 2, y: 2 }, "down", free, () => false)).toEqual({ x: 2, y: 3 });
});

// The Kvanta classroom (v18-podium): its collision layer ("#" a wall or desk) and its areas.
const CLASSROOM = `
###############################
###############################
###############################
##########...........##########
###.........................###
###..##...##...##...##...##.###
#.............................#
#.............................#
#.............................#
#.............................#
#....##...##...##...##...##...#
#.............................#
#.............................#
#.............................#
#.............................#
##..########.......########..##
#...########..###..########...#
#....##...##...##...##...##...#
#.............................#
#.............................#
#.............................#
#.............................#
#....##...##...##...##...##...#
#.............................#
#.............................#
#.............................#
#.............................#
###.........................###
###.........................###
###############################`
    .trim()
    .split("\n")
    .map((row) => [...row].map((cell) => (cell === "#" ? 1 : 0)));

const listener = { type: "listenerMegaphone", speakerZoneName: "podium", allowTalking: true };
const classroomAreas: AreaData[] = [
    {
        id: "podium",
        name: "Podium",
        x: 416,
        y: 448,
        width: 160,
        height: 96,
        properties: [
            { id: "speakerMegaphone", type: "speakerMegaphone", name: "classroom" },
            { id: "rights", type: "restrictedRightsPropertyData", writeTags: ["admin"], readTags: ["admin"] },
        ],
    },
    {
        id: "audience",
        name: "Listening to the teacher",
        x: 32,
        y: 96,
        width: 928,
        height: 352,
        properties: [{ id: "l1", ...listener }],
    },
    {
        id: "audience-mid",
        name: "Listening to the teacher",
        x: 32,
        y: 416,
        width: 928,
        height: 160,
        properties: [{ id: "l2", ...listener }],
    },
    {
        id: "audience-low",
        name: "Listening to the teacher",
        x: 32,
        y: 544,
        width: 928,
        height: 384,
        properties: [{ id: "l3", ...listener }],
    },
    ...[160, 320, 544, 704].flatMap((y, row) =>
        [128, 288, 448, 608, 768].map((x, column) => ({
            id: `megaphone-${row * 5 + column + 1}`,
            name: `quanta:megaphone:${row * 5 + column + 1}`,
            x,
            y,
            width: 32,
            height: 32,
            properties: [],
        })),
    ),
    {
        id: "main-whiteboard",
        name: "quanta:whiteboard:main",
        x: 128,
        y: 448,
        width: 256,
        height: 128,
        properties: [
            { id: "openWebsite", type: "openWebsite", link: "https://draw.example/#room=main", trigger: "onaction" },
        ],
    },
    {
        id: "second-whiteboard",
        name: "quanta:whiteboard:second",
        x: 608,
        y: 448,
        width: 256,
        height: 128,
        properties: [
            { id: "openWebsite", type: "openWebsite", link: "https://draw.example/#room=second", trigger: "onaction" },
        ],
    },
    {
        id: "entry",
        name: "",
        x: 480,
        y: 832,
        width: 32,
        height: 32,
        properties: [{ id: "start", type: "start", isDefault: true }],
    },
    {
        id: "editors",
        name: "quanta:room-editors",
        x: 0,
        y: 0,
        width: 992,
        height: 960,
        properties: [
            { id: "rights", type: "restrictedRightsPropertyData", writeTags: ["editor"], readTags: ["member"] },
        ],
    },
].map((area) => ({ visible: true, ...area }) as unknown as AreaData);

/** The tile a teacher's Go to lands on, as goTo picks it: same checks, the real area lookup. */
function goToTile(student: { x: number; y: number }, facing: Facing, others: Tile[] = []): Tile | undefined {
    const areas = new GameMapAreas({
        version: "1.0.0",
        mapUrl: "",
        entities: {},
        areas: classroomAreas,
    } as unknown as WAMFileFormat);
    const pixels = (tile: Tile) => ({ x: tile.x * 32 + 16, y: tile.y * 32 + 16 });
    const areasAt = (tile: Tile) => areas.getAreasOnPosition(pixels(tile), AREA_FEET_OFFSET_Y);
    const target = { x: Math.floor(student.x / 32), y: Math.floor(student.y / 32) };
    const allowed = freeTile(CLASSROOM, new Set([tileKey(target), ...others.map(tileKey)]));
    const zones = listenerZonesOf(areas.getAreasOnPosition(student, AREA_FEET_OFFSET_Y));
    return tileBeside(
        target,
        facing,
        (tile) => allowed(tile) && quietToStandIn(areasAt(tile)),
        (tile) => listenerZonesOf(areasAt(tile)) === zones,
    );
}

const landsOn = (tile: Tile) => {
    const areas = new GameMapAreas({
        version: "1.0.0",
        mapUrl: "",
        entities: {},
        areas: classroomAreas,
    } as unknown as WAMFileFormat);
    return areas
        .getAreasOnPosition({ x: tile.x * 32 + 16, y: tile.y * 32 + 16 }, AREA_FEET_OFFSET_Y)
        .map((a) => a.name);
};

it("never lands the teacher on a table megaphone spot (the seats QA reported)", () => {
    for (const student of [
        { x: 768, y: 260 },
        { x: 448, y: 260 },
        { x: 608, y: 680 },
        { x: 128, y: 600 },
    ]) {
        for (const facing of ["down", "up", "left", "right"] as const) {
            const tile = goToTile(student, facing);
            expect(tile, `${student.x},${student.y} ${facing}`).toBeDefined();
            const names = landsOn(tile!);
            expect(
                names.filter((name) => name.startsWith("quanta:megaphone:")),
                `${student.x},${student.y}`,
            ).toEqual([]);
            expect(names).not.toContain("Podium");
            expect(names.filter((name) => name.startsWith("quanta:whiteboard:"))).toEqual([]);
            expect(names).toContain("Listening to the teacher");
        }
    }
    // The tile the old choice took, right above spot 10: its feet are on the spot's edge.
    expect(landsOn({ x: 24, y: 9 })).toContain("quanta:megaphone:10");
    expect(goToTile({ x: 768, y: 260 }, "down")).toEqual({ x: 25, y: 8 });
});

it("never lands on any spot, the podium or a board from anywhere a student can stand", () => {
    for (let y = 0; y < CLASSROOM.length; y++)
        for (let x = 0; x < CLASSROOM[0].length; x++) {
            if (CLASSROOM[y][x] !== 0) continue;
            const tile = goToTile({ x: x * 32 + 16, y: y * 32 + 16 }, "down");
            if (!tile) continue;
            expect(
                quietToStandIn(landsOn(tile).map((name) => classroomAreas.find((a) => a.name === name)!)),
                `${x},${y}`,
            ).toBe(true);
            expect(CLASSROOM[tile.y][tile.x]).toBe(0);
        }
});

it("goes beside a student standing on a spot, not onto the spot", () => {
    const tile = goToTile({ x: 784, y: 320 }, "down");
    expect(tile).toBeDefined();
    expect(landsOn(tile!).some((name) => name.startsWith("quanta:megaphone:"))).toBe(false);
});

it("treats spots, speaker zones, boards and other triggers as not quiet; listener zones and rights as quiet", () => {
    expect(quietToStandIn([{ name: "quanta:megaphone:4", properties: [] }])).toBe(false);
    expect(quietToStandIn([{ name: "Podium", properties: [{ type: "speakerMegaphone" }] }])).toBe(false);
    expect(quietToStandIn([{ name: "quanta:whiteboard:main", properties: [] }])).toBe(false);
    for (const type of [
        "jitsiRoomProperty",
        "livekitRoomProperty",
        "playAudio",
        "exit",
        "openWebsite",
        "silent",
        "focusable",
    ])
        expect(quietToStandIn([{ name: "x", properties: [{ type }] }]), type).toBe(false);
    expect(
        quietToStandIn([
            { name: "Listening to the teacher", properties: [{ type: "listenerMegaphone" }] },
            { name: "quanta:room-editors", properties: [{ type: "restrictedRightsPropertyData" }] },
        ]),
    ).toBe(true);
});
