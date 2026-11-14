import { describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";
import type { GameScene } from "../Phaser/Game/GameScene";
import { gameSceneStore } from "../Stores/GameSceneStore";
import { tableChatStore } from "./chatAudience";

vi.mock("../Phaser/Game/GameManager", () => ({ gameManager: {} }));

function scene(names: string[], unread = false) {
    const users = new Map([["me", { spaceUserId: "me", name: "Me" }]]);
    names.forEach((name) => users.set(name, { spaceUserId: name, name }));
    const room = {
        isJoined: writable(true),
        spaceUsersStore: writable(users),
        hasUnreadMessages: writable(unread),
        getCurrentSpace: () => ({ mySpaceUserId: "me" }),
    };
    return {
        room,
        scene: { proximityChatRoomManager: { getDefaultRoom: () => room } } as unknown as GameScene,
    };
}

describe("the table's chat", () => {
    it("follows the scene a reconnection starts, while the side column stays open", () => {
        const values: unknown[] = [];
        const stop = tableChatStore.subscribe((value) => values.push(value));
        try {
            const before = scene(["Anna"]);
            gameSceneStore.set(before.scene);
            expect(get(tableChatStore)?.names).toEqual(["Anna"]);
            // The connection drops: the scene goes, and the next one has its own table.
            gameSceneStore.set(undefined);
            expect(get(tableChatStore)).toBeUndefined();
            const after = scene(["Max"]);
            gameSceneStore.set(after.scene);
            expect(get(tableChatStore)?.names).toEqual(["Max"]);
            after.room.hasUnreadMessages.set(true);
            expect(values.at(-1)).toMatchObject({ names: ["Max"], unread: true });
            before.room.hasUnreadMessages.set(true);
            expect(values.at(-1)).toMatchObject({ names: ["Max"], unread: true });
        } finally {
            stop();
            gameSceneStore.set(undefined);
        }
    });
});
