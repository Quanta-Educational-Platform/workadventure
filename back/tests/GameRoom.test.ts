/* eslint-disable @typescript-eslint/no-unused-vars */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    AvailabilityStatus,
    JoinRoomMessage,
    LockGroupPromptMessage,
    PositionMessage_Direction,
    RoomJoinedMessage,
    SetPlayerDetailsMessage,
} from "@workadventure/messages";
import { LocalUrlError } from "@workadventure/map-editor/src/LocalUrlError";
import { mapFetcher } from "@workadventure/map-editor/src/MapFetcher";
import type { ITiledMap } from "@workadventure/tiled-map-type-guard";
import type { ConnectCallback, DisconnectCallback } from "../src/Model/GameRoom";
import { GameRoom, VARIABLE_MANAGER_RETRY_MAX_MS, VARIABLE_MANAGER_RETRY_MIN_MS } from "../src/Model/GameRoom";
import { Point } from "../src/Model/Websocket/MessageUserPosition";
import { Group } from "../src/Model/Group";
import type { User, UserSocket } from "../src/Model/User";
import type { RoomSocket, VariableSocket } from "../src/RoomManager";
import { socketManager } from "../src/Services/SocketManager";
import type { EmoteCallback, ZonePosition } from "../src/Model/Zone";
import { MapLoadingError } from "../src/Services/MapLoadingError";
import { VariableError } from "../src/Services/VariableError";

function createMockUser(userId: number): User {
    return {
        userId,
    } as unknown as User;
}

function createMockUserSocket() {
    const write = vi.fn().mockReturnValue(true);
    const end = vi.fn();

    return {
        socket: {
            write,
            end,
        } as unknown as UserSocket,
        write,
        end,
    };
}

function createJoinRoomMessage(uuid: string, x: number, y: number, tabId?: string): JoinRoomMessage {
    return JoinRoomMessage.fromPartial({
        userUuid: uuid,
        IPAddress: "10.0.0.2",
        name: "foo",
        positionMessage: {
            x,
            y,
            direction: PositionMessage_Direction.DOWN,
            moving: false,
        },
        tabId,
    } as const);
}

function flushPendingMessages(user: User): void {
    user.write({
        $case: "roomJoinedMessage",
        roomJoinedMessage: RoomJoinedMessage.fromPartial({
            currentUserId: user.id,
        }),
    });
}

function isServerMessageChunk(chunk: unknown): chunk is { message: { $case: string } } {
    return typeof chunk === "object" && chunk !== null && "message" in chunk;
}

function getWrittenMessageCases(socket: ReturnType<typeof createMockUserSocket>): string[] {
    return socket.write.mock.calls
        .map((call): unknown => call[0])
        .filter(isServerMessageChunk)
        .map((chunk) => chunk.message.$case);
}

const emote: EmoteCallback = (emoteEventMessage, listener): void => {};

const ROOM_URL = "https://play.workadventu.re/_/global/localhost/test.json";

function createMockVariableSocket(name: string) {
    const write = vi.fn().mockReturnValue(true);
    const end = vi.fn();

    return {
        socket: {
            request: { name, room: ROOM_URL },
            write,
            end,
        } as unknown as VariableSocket,
        write,
        end,
    };
}

function createWorld(): Promise<GameRoom> {
    return GameRoom.create(
        ROOM_URL,
        () => {},
        () => {},
        160,
        160,
        () => {},
        () => {},
        () => {},
        emote,
        () => {},
        () => {},
        () => {},
    );
}

describe("GameRoom", () => {
    it("should connect user1 and user2", async () => {
        let connectCalledNumber = 0;
        const connect: ConnectCallback = (user: User, group: Group): void => {
            connectCalledNumber++;
        };
        const disconnect: DisconnectCallback = (user: User, group: Group): void => {};

        const world = await GameRoom.create(
            "https://play.workadventu.re/_/global/localhost/test.json",
            connect,
            disconnect,
            160,
            160,
            () => {},
            () => {},
            () => {},
            emote,
            () => {},
            () => {},
            () => {},
        );

        const user1Socket = createMockUserSocket();
        const user1 = await world.join(user1Socket.socket, createJoinRoomMessage("1", 100, 100));

        const user2Socket = createMockUserSocket();
        const user2 = await world.join(user2Socket.socket, createJoinRoomMessage("2", 500, 100));

        world.updatePosition(user2, new Point(261, 100));

        expect(connectCalledNumber).toBe(0);

        world.updatePosition(user2, new Point(101, 100));

        expect(connectCalledNumber).toBe(2);

        world.updatePosition(user2, new Point(102, 100));
        expect(connectCalledNumber).toBe(2);
    });

    it("should connect users when one of them leaves a silent status without moving", async () => {
        let connectCalledNumber = 0;
        const connect: ConnectCallback = (): void => {
            connectCalledNumber++;
        };
        const world = await GameRoom.create(
            ROOM_URL,
            connect,
            () => {},
            160,
            160,
            () => {},
            () => {},
            () => {},
            emote,
            () => {},
            () => {},
            () => {},
        );

        const user1 = await world.join(createMockUserSocket().socket, createJoinRoomMessage("1", 100, 100));
        world.updatePlayerDetails(
            user1,
            SetPlayerDetailsMessage.fromPartial({ availabilityStatus: AvailabilityStatus.SOUND_BLOCKED }),
        );

        await world.join(createMockUserSocket().socket, createJoinRoomMessage("2", 101, 100));
        expect(connectCalledNumber).toBe(0);

        world.updatePlayerDetails(
            user1,
            SetPlayerDetailsMessage.fromPartial({ availabilityStatus: AvailabilityStatus.ONLINE }),
        );
        expect(connectCalledNumber).toBe(2);
    });

    it("should connect 3 users", async () => {
        let connectCalled = false;
        const connect: ConnectCallback = (user: User, group: Group): void => {
            connectCalled = true;
        };
        const disconnect: DisconnectCallback = (user: User, group: Group): void => {};

        const world = await GameRoom.create(
            "https://play.workadventu.re/_/global/localhost/test.json",
            connect,
            disconnect,
            160,
            160,
            () => {},
            () => {},
            () => {},
            emote,
            () => {},
            () => {},
            () => {},
        );

        const user1Socket = createMockUserSocket();
        const user1 = await world.join(user1Socket.socket, createJoinRoomMessage("1", 100, 100));

        const user2Socket = createMockUserSocket();
        const user2 = await world.join(user2Socket.socket, createJoinRoomMessage("2", 200, 100));

        expect(connectCalled).toBe(true);
        connectCalled = false;

        // baz joins at the outer limit of the group
        const user3Socket = createMockUserSocket();
        const user3 = await world.join(user3Socket.socket, createJoinRoomMessage("2", 311, 100));

        expect(connectCalled).toBe(false);

        world.updatePosition(user3, new Point(309, 100));

        expect(connectCalled).toBe(true);
    });

    describe("when a member of a group walks up to a user", () => {
        // user1 and user2 form a group centered on (150, 100). user3 stands 250px away, too far to join.
        // user2 then walks to (390, 100): the group center moves to (245, 100), 155px from user3.
        async function createGroupNextToUser3() {
            const world = await createWorld();
            const user1 = await world.join(createMockUserSocket().socket, createJoinRoomMessage("1", 100, 100));
            const user2 = await world.join(createMockUserSocket().socket, createJoinRoomMessage("2", 200, 100));
            const user3 = await world.join(createMockUserSocket().socket, createJoinRoomMessage("3", 400, 100));
            expect(user1.group).toBeDefined();
            expect(user3.group).toBeUndefined();
            return { world, user1, user2, user3 };
        }

        it("should pull the user in, even though the other members are met first", async () => {
            const { world, user1, user2, user3 } = await createGroupNextToUser3();

            world.updatePosition(user2, new Point(390, 100));

            expect(user3.group).toBe(user1.group);
        });

        it("should not pull the user in if the group is locked", async () => {
            const { world, user1, user2, user3 } = await createGroupNextToUser3();
            user1.group?.lock();

            world.updatePosition(user2, new Point(390, 100));

            expect(user3.group).toBeUndefined();
        });

        it("should not pull the user in while they walk, only once they stop", async () => {
            const { world, user1, user2, user3 } = await createGroupNextToUser3();
            world.updatePosition(user3, new Point(400, 100, "left", true));

            world.updatePosition(user2, new Point(390, 100));
            expect(user3.group).toBeUndefined();

            world.updatePosition(user3, new Point(400, 100));
            expect(user3.group).toBe(user1.group);
        });
    });

    it("should not leave a deleted locked group in the zone of the user who locked it", async () => {
        // What a pusher listening to every zone knows: the groups each zone announced and has not deleted since.
        const groupsByZone = new Map<string, Set<number>>();
        const groupsIn = (zone: ZonePosition): Set<number> => {
            const key = `${zone.x},${zone.y}`;
            const groups = groupsByZone.get(key) ?? new Set<number>();
            groupsByZone.set(key, groups);
            return groups;
        };
        const announce = (thing: unknown, zone: ZonePosition): void => {
            if (thing instanceof Group) groupsIn(zone).add(thing.getId());
        };
        const world = await GameRoom.create(
            ROOM_URL,
            () => {},
            () => {},
            160,
            160,
            announce,
            announce,
            (thing, zone) => {
                if (thing instanceof Group) groupsIn(zone).delete(thing.getId());
            },
            emote,
            (zone, groupId) => groupsIn(zone).add(groupId),
            () => {},
            () => {},
        );
        world.addZoneListener({} as RoomSocket, 0, 0);
        world.addZoneListener({} as RoomSocket, 1, 0);

        // Zones are 320px wide: user1 stands in zone (0,0) while the centre of the group, (350, 100), is in zone (1,0).
        const user1 = await world.join(createMockUserSocket().socket, createJoinRoomMessage("1", 300, 100));
        await world.join(createMockUserSocket().socket, createJoinRoomMessage("2", 400, 100));
        const group = user1.group;
        if (!group) throw new Error("user1 and user2 should share a group");

        socketManager.handleLockGroupPromptMessage(world, user1, LockGroupPromptMessage.fromPartial({ lock: true }));
        // The group moves onto user2, in zone (1,0), and is deleted there.
        world.leave(user1);

        for (const groups of groupsByZone.values()) {
            expect(groups.has(group.getId())).toBe(false);
        }
    });

    it("should disconnect user1 and user2", async () => {
        let connectCalled = false;
        let disconnectCallNumber = 0;
        const connect: ConnectCallback = (user: User, group: Group): void => {
            connectCalled = true;
        };
        const disconnect: DisconnectCallback = (user: User, group: Group): void => {
            disconnectCallNumber++;
        };

        const world = await GameRoom.create(
            "https://play.workadventu.re/_/global/localhost/test.json",
            connect,
            disconnect,
            160,
            160,
            () => {},
            () => {},
            () => {},
            emote,
            () => {},
            () => {},
            () => {},
        );

        const user1Socket = createMockUserSocket();
        const user1 = await world.join(user1Socket.socket, createJoinRoomMessage("1", 100, 100));

        const user2Socket = createMockUserSocket();
        const user2 = await world.join(user2Socket.socket, createJoinRoomMessage("2", 259, 100));

        expect(connectCalled).toBe(true);
        expect(disconnectCallNumber).toBe(0);

        world.updatePosition(user2, new Point(100 + 160 + 160 + 1, 100));

        expect(disconnectCallNumber).toBe(2);

        world.updatePosition(user2, new Point(262, 100));
        expect(disconnectCallNumber).toBe(2);
    });

    it("should not notify duplicate user when reconnecting from the same tab", async () => {
        const world = await GameRoom.create(
            "https://play.workadventu.re/_/global/localhost/test.json",
            () => {},
            () => {},
            160,
            160,
            () => {},
            () => {},
            () => {},
            emote,
            () => {},
            () => {},
            () => {},
        );

        const firstSocket = createMockUserSocket();
        await world.join(firstSocket.socket, createJoinRoomMessage("duplicate-user", 100, 100, "tab-1"));

        const secondSocket = createMockUserSocket();
        const reconnectedUser = await world.join(
            secondSocket.socket,
            createJoinRoomMessage("duplicate-user", 100, 100, "tab-1"),
        );

        expect(firstSocket.end).toHaveBeenCalledTimes(1);

        flushPendingMessages(reconnectedUser);

        expect(getWrittenMessageCases(secondSocket)).not.toContain("duplicateUserConnectedMessage");
    });

    it("should notify duplicate user when connecting from another tab", async () => {
        const world = await GameRoom.create(
            "https://play.workadventu.re/_/global/localhost/test.json",
            () => {},
            () => {},
            160,
            160,
            () => {},
            () => {},
            () => {},
            emote,
            () => {},
            () => {},
            () => {},
        );

        const firstSocket = createMockUserSocket();
        await world.join(firstSocket.socket, createJoinRoomMessage("duplicate-user", 100, 100, "tab-1"));

        const secondSocket = createMockUserSocket();
        const secondUser = await world.join(
            secondSocket.socket,
            createJoinRoomMessage("duplicate-user", 100, 100, "tab-2"),
        );

        expect(firstSocket.end).not.toHaveBeenCalled();

        flushPendingMessages(secondUser);

        expect(getWrittenMessageCases(secondSocket)).toContain("duplicateUserConnectedMessage");
    });

    it("should keep duplicate detection when tabId is missing", async () => {
        const world = await GameRoom.create(
            "https://play.workadventu.re/_/global/localhost/test.json",
            () => {},
            () => {},
            160,
            160,
            () => {},
            () => {},
            () => {},
            emote,
            () => {},
            () => {},
            () => {},
        );

        const firstSocket = createMockUserSocket();
        await world.join(firstSocket.socket, createJoinRoomMessage("duplicate-user", 100, 100));

        const secondSocket = createMockUserSocket();
        const secondUser = await world.join(secondSocket.socket, createJoinRoomMessage("duplicate-user", 100, 100));

        flushPendingMessages(secondUser);

        expect(getWrittenMessageCases(secondSocket)).toContain("duplicateUserConnectedMessage");
    });

    describe("variable listeners", () => {
        it("should not write to a listener that was removed", async () => {
            // Loading the map is irrelevant here: failing the fetch makes GameRoom fall back to a
            // permission-less variable manager, which is enough to dispatch a variable change.
            vi.spyOn(mapFetcher, "fetchMap").mockRejectedValue(new LocalUrlError("Local map"));

            const world = await createWorld();

            const removedListener = createMockVariableSocket("myVariable");
            const remainingListener = createMockVariableSocket("myVariable");
            world.addVariableListener(removedListener.socket);
            world.addVariableListener(remainingListener.socket);

            world.removeVariableListener(removedListener.socket);

            await world.setVariable("myVariable", JSON.stringify("new value"), "RoomApi");

            expect(removedListener.write).not.toHaveBeenCalled();
            expect(remainingListener.write).toHaveBeenCalledWith("new value");
        });

        it("should forget the variable name once its last listener is removed", async () => {
            const world = await createWorld();

            const listener = createMockVariableSocket("myVariable");
            world.addVariableListener(listener.socket);
            world.removeVariableListener(listener.socket);

            // isEmpty() drives cleanupRoomIfEmpty(): a leftover entry keeps the room alive forever.
            expect(world.isEmpty()).toBe(true);
        });

        it("should not register a variable name when removing an unknown listener", async () => {
            const world = await createWorld();

            world.removeVariableListener(createMockVariableSocket("neverListenedTo").socket);

            expect(world.isEmpty()).toBe(true);
        });
    });

    describe("when the map can't be loaded", () => {
        // A board variable only staff may change.
        const map = {
            layers: [
                {
                    type: "objectgroup",
                    name: "variables",
                    objects: [
                        {
                            id: 1,
                            name: "board",
                            type: "variable",
                            x: 0,
                            y: 0,
                            properties: [{ name: "writableBy", type: "string", value: "admin" }],
                        },
                    ],
                },
            ],
        } as unknown as ITiledMap;
        const student = { name: "student", tags: [] } as unknown as User;
        const teacher = { name: "teacher", tags: ["admin"] } as unknown as User;

        // Earlier tests leave mapFetcher spied on.
        beforeEach(() => vi.restoreAllMocks());
        afterEach(() => {
            vi.restoreAllMocks();
            vi.useRealTimers();
        });

        it("retries the load instead of keeping a variable manager that checks nothing", async () => {
            vi.useFakeTimers();
            const fetchMap = vi
                .spyOn(mapFetcher, "fetchMap")
                .mockRejectedValueOnce(new Error("map-storage is restarting"))
                .mockResolvedValue(map);
            const world = await createWorld();
            const listener = createMockVariableSocket("board");
            world.addVariableListener(listener.socket);

            await world.setVariable("board", JSON.stringify("open"), student);
            expect(listener.write).not.toHaveBeenCalled();
            expect(await world.getVariablesForTags([])).toEqual(new Map());
            await expect(world.setVariable("board", JSON.stringify("open"), "RoomApi")).rejects.toThrow(
                MapLoadingError,
            );
            expect(fetchMap).toHaveBeenCalledTimes(1);

            vi.advanceTimersByTime(VARIABLE_MANAGER_RETRY_MIN_MS);
            await expect(world.setVariable("board", JSON.stringify("open"), student)).rejects.toThrow(VariableError);
            expect(fetchMap).toHaveBeenCalledTimes(2);
            expect(listener.write).not.toHaveBeenCalled();

            await world.setVariable("board", JSON.stringify("open"), teacher);
            expect(listener.write).toHaveBeenCalledWith("open");
            expect(await world.getVariablesForTags([])).toEqual(new Map([["board", JSON.stringify("open")]]));
            expect(fetchMap).toHaveBeenCalledTimes(2);
        });

        it("sends the variables to the people who joined without them once the map loads", async () => {
            vi.useFakeTimers();
            const mapWithDefault = structuredClone(map);
            const layer = mapWithDefault.layers[0] as { objects: { properties: unknown[] }[] };
            layer.objects[0].properties.push({ name: "default", type: "string", value: "closed" });
            vi.spyOn(mapFetcher, "fetchMap")
                .mockRejectedValueOnce(new Error("map-storage is restarting"))
                .mockResolvedValue(mapWithDefault);
            const world = await createWorld();
            const earlySocket = createMockUserSocket();
            const early = await world.join(earlySocket.socket, createJoinRoomMessage("early", 100, 100));
            flushPendingMessages(early);
            expect(await world.getVariablesForTags(early.tags)).toEqual(new Map());

            vi.advanceTimersByTime(VARIABLE_MANAGER_RETRY_MIN_MS);
            const lateSocket = createMockUserSocket();
            const late = await world.join(lateSocket.socket, createJoinRoomMessage("late", 300, 300));
            flushPendingMessages(late);
            expect(await world.getVariablesForTags(late.tags)).toEqual(new Map([["board", JSON.stringify("closed")]]));
            vi.advanceTimersByTime(100);

            const sentVariables = (socket: ReturnType<typeof createMockUserSocket>) =>
                JSON.stringify(socket.write.mock.calls).match(/"variableMessage":\{[^}]*\}/g) ?? [];
            expect(sentVariables(earlySocket)).toEqual([
                `"variableMessage":{"name":"board","value":${JSON.stringify(JSON.stringify("closed"))}}`,
            ]);

            // Once loaded, a later load that works sends nothing again.
            earlySocket.write.mockClear();
            await world.getVariablesForTags([]);
            vi.advanceTimersByTime(100);
            expect(sentVariables(earlySocket)).toEqual([]);
        });

        it("waits longer after each failure, up to a bound, and starts over after a success", async () => {
            vi.useFakeTimers();
            const fetchMap = vi.spyOn(mapFetcher, "fetchMap").mockRejectedValue(new Error("map-storage is down"));
            const world = await createWorld();
            await world.getVariablesForTags([]);
            expect(fetchMap).toHaveBeenCalledTimes(1);

            const waits = [1000, 2000, 4000, 8000, 16000, VARIABLE_MANAGER_RETRY_MAX_MS, VARIABLE_MANAGER_RETRY_MAX_MS];
            for (const [index, wait] of waits.entries()) {
                vi.advanceTimersByTime(wait - 1);
                // eslint-disable-next-line no-await-in-loop
                await world.getVariablesForTags([]);
                expect(fetchMap).toHaveBeenCalledTimes(index + 1);
                vi.advanceTimersByTime(1);
                // eslint-disable-next-line no-await-in-loop
                await world.getVariablesForTags([]);
                expect(fetchMap).toHaveBeenCalledTimes(index + 2);
            }

            fetchMap.mockResolvedValue(map);
            vi.advanceTimersByTime(VARIABLE_MANAGER_RETRY_MAX_MS);
            await world.setVariable("board", JSON.stringify("open"), teacher);
            expect(fetchMap).toHaveBeenCalledTimes(waits.length + 2);

            // An unknown variable reloads the map, which fails again: the wait is back to the shortest.
            fetchMap.mockRejectedValue(new Error("map-storage is down"));
            vi.advanceTimersByTime(10_001);
            await world.setVariable("unknown", JSON.stringify(1), teacher);
            expect(fetchMap).toHaveBeenCalledTimes(waits.length + 3);
            vi.advanceTimersByTime(VARIABLE_MANAGER_RETRY_MIN_MS);
            await world.getVariablesForTags([]);
            expect(fetchMap).toHaveBeenCalledTimes(waits.length + 4);
        });
    });
});
