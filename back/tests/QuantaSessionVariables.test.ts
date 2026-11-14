import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ITiledMap } from "@workadventure/tiled-map-type-guard";

const redis = vi.hoisted(() => {
    const values = new Map<string, string>();
    const ttls = new Map<string, number>();
    const control = { fail: false };
    const client = {
        hGetAll: vi.fn(() => Promise.resolve({})),
        hSet: vi.fn(() => Promise.resolve(1)),
        get: vi.fn((key: string) =>
            control.fail ? Promise.reject(new Error("Redis read failed")) : Promise.resolve(values.get(key) ?? null),
        ),
        set: vi.fn((key: string, value: string, options: { expiration: { value: number } }) => {
            values.set(key, value);
            ttls.set(key, options.expiration.value);
            return Promise.resolve("OK");
        }),
        del: vi.fn((key: string) => Promise.resolve(values.delete(key) ? 1 : 0)),
        pExpire: vi.fn((key: string, ttl: number) => {
            if (values.has(key)) ttls.set(key, ttl);
            return Promise.resolve(values.has(key));
        }),
    };
    return { values, ttls, control, client };
});
vi.mock("../src/Services/RedisClient", () => ({ getRedisClient: () => Promise.resolve(redis.client) }));

import { VariablesManager } from "../src/Services/VariablesManager";
import {
    EMPTY_ROOM_VARIABLE_TTL_MS,
    expireSessionVariables,
    SESSION_VARIABLE_TTL_MS,
} from "../src/Services/QuantaSessionVariables";

const ROOM = "https://play.test/@/org/world/class";
const KEY = `quanta:room-variable:${ROOM}:presentedBoard`;
const BOARD = JSON.stringify({ url: "https://draw.qed.world/#room=abc,key", drawers: ["student"] });

function map(persist?: boolean): ITiledMap {
    const properties = [{ name: "writableBy", type: "string", value: "admin" }];
    if (persist !== undefined) properties.push({ name: "persist", type: "bool", value: persist } as never);
    return {
        layers: [
            {
                type: "objectgroup",
                name: "variables",
                objects: [{ id: 1, name: "presentedBoard", type: "variable", x: 0, y: 0, properties }],
            },
        ],
    } as unknown as ITiledMap;
}
const flush = () =>
    new Promise((resolve) => {
        setTimeout(resolve, 0);
    });

beforeEach(() => {
    redis.values.clear();
    redis.ttls.clear();
    redis.control.fail = false;
    vi.clearAllMocks();
});

describe("the presented board across a restart", () => {
    it("comes back, drawers included, in the room the next back process opens", async () => {
        const before = await (await VariablesManager.create(ROOM, map())).init();
        before.setVariable("presentedBoard", BOARD, "RoomApi");
        await flush();
        expect(redis.ttls.get(KEY)).toBe(SESSION_VARIABLE_TTL_MS);

        const after = await (await VariablesManager.create(ROOM, map())).init();
        expect(after.getVariablesForTags(["admin"]).get("presentedBoard")).toBe(BOARD);
    });

    it("lapses soon after the room empties, and is renewed when it fills again in time", async () => {
        const room = await (await VariablesManager.create(ROOM, map())).init();
        room.setVariable("presentedBoard", BOARD, "RoomApi");
        await flush();
        expireSessionVariables(ROOM, room.sessionVariables(), EMPTY_ROOM_VARIABLE_TTL_MS);
        await flush();
        expect(redis.ttls.get(KEY)).toBe(EMPTY_ROOM_VARIABLE_TTL_MS);
        await (await VariablesManager.create(ROOM, map())).init();
        await flush();
        expect(redis.ttls.get(KEY)).toBe(SESSION_VARIABLE_TTL_MS);
    });

    it("forgets a board staff stopped presenting", async () => {
        const room = await (await VariablesManager.create(ROOM, map())).init();
        room.setVariable("presentedBoard", BOARD, "RoomApi");
        room.setVariable("presentedBoard", "null", "RoomApi");
        await flush();
        expect(redis.values.has(KEY)).toBe(false);
    });

    it("leaves a variable the map persists itself to WorkAdventure's own storage", async () => {
        const room = await (await VariablesManager.create(ROOM, map(true))).init();
        room.setVariable("presentedBoard", BOARD, "RoomApi");
        await flush();
        expect(redis.values.has(KEY)).toBe(false);
        expect(redis.client.hSet).toHaveBeenCalled();
    });

    it("opens the room without it when Redis can't be read", async () => {
        redis.control.fail = true;
        const room = await (await VariablesManager.create(ROOM, map())).init();
        expect(room.getVariablesForTags(["admin"]).has("presentedBoard")).toBe(false);
    });
});
