import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Subject } from "rxjs";
import { FilterType, SpaceUser } from "@workadventure/messages";
import type { SpaceState } from "@workadventure/shared-utils";
import { emptySpaceState } from "@workadventure/shared-utils";
import { HAND_REJOIN_MS, RaiseHandManager, type RaiseHandHost } from "../src/Model/RaiseHandManager";
import { parseSavedHands, type HandsStore, type SavedHands } from "../src/Services/QuantaHandsStore";
vi.mock("../src/Enum/EnvironmentVariable", () => ({ MODERATION_ADMINS_ONLY: true }));
// No Redis: RaiseHandManager keeps hands in memory unless a test gives it a store.
vi.mock("../src/Services/RedisClient", () => ({ getRedisClient: () => Promise.resolve(null) }));

/** Redis as the store sees it: one value per space, shared by every manager (process) created on it. */
function memoryStore() {
    const values = new Map<string, string>();
    let gate: Promise<void> | undefined;
    let failing = false;
    const store: HandsStore = {
        async load(space) {
            await gate;
            if (failing) throw new Error("Redis read failed");
            const raw = values.get(space);
            return raw ? parseSavedHands(raw) : undefined;
        },
        save(space, saved) {
            if (saved.hands.length || saved.floor.length) values.set(space, JSON.stringify(saved));
            else values.delete(space);
        },
    };
    return {
        store,
        saved: (): SavedHands | undefined => {
            const raw = values.get("world.lecture");
            return raw ? parseSavedHands(raw) : undefined;
        },
        hold: () => {
            let release!: () => void;
            gate = new Promise((resolve) => {
                release = resolve;
            });
            return () => {
                gate = undefined;
                release();
            };
        },
        fail: (value: boolean) => {
            failing = value;
        },
    };
}

/** A back process's space: users join and leave as the pushers tell it. */
function space(filterType: RaiseHandHost["filterType"], store: HandsStore) {
    const users: SpaceUser[] = [];
    const userAdded$ = new Subject<SpaceUser>();
    const userRemoved$ = new Subject<SpaceUser>();
    let state: SpaceState = emptySpaceState();
    const host: RaiseHandHost = {
        name: "world.lecture",
        filterType,
        userAdded$,
        userRemoved$,
        userUpdated$: new Subject(),
        getAllUsers: () => users,
        getUser: (spaceUserId) => users.find((user) => user.spaceUserId === spaceUserId),
        getState: () => state,
        updateState: (mutate) => {
            const next = structuredClone(state);
            mutate(next);
            state = next;
        },
    };
    const manager = new RaiseHandManager(host, store);
    const join = (spaceUserId: string, uuid: string, tags: string[] = []) => {
        const user = SpaceUser.fromPartial({ spaceUserId, uuid, name: uuid, tags });
        users.push(user);
        userAdded$.next(user);
        return user;
    };
    const leave = (spaceUserId: string) => {
        const index = users.findIndex((user) => user.spaceUserId === spaceUserId);
        const [user] = users.splice(index, 1);
        userRemoved$.next(user);
    };
    const hands = () => state.raisedHands.map((entry) => `${entry.spaceUserId}:${entry.name}`);
    const floor = () => state.floorHolders.map((entry) => `${entry.spaceUserId}:${entry.name}`);
    return { manager, join, leave, hands, floor, state: () => state };
}

const settle = () => vi.advanceTimersByTimeAsync(0);
// Hands raised a second apart, so their order is their time.
const later = () => vi.advanceTimersByTime(1000);

describe("raised hands and the floor across a restart", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("gives everyone back their place in the queue under their new ids, after a back restart", async () => {
        const redis = memoryStore();
        const before = space(FilterType.LIVE_STREAMING_USERS, redis.store);
        await settle();
        const teacher = before.join("1", "teacher", ["admin"]);
        const ann = before.join("2", "ann"),
            bob = before.join("3", "bob"),
            cat = before.join("4", "cat");
        before.manager.raiseHand(bob, true);
        later();
        before.manager.raiseHand(ann, true);
        later();
        before.manager.raiseHand(cat, true);
        before.manager.giveFloor(teacher, "4");
        // The back dies without anyone leaving; the new one numbers people as they come back.
        const after = space(FilterType.LIVE_STREAMING_USERS, redis.store);
        after.join("7", "ann");
        after.join("8", "teacher", ["admin"]);
        after.join("9", "cat");
        await settle();
        expect(after.hands()).toEqual(["7:ann"]);
        expect(after.floor()).toEqual(["9:cat"]);
        // Bob comes back last, and still goes before Ann, who raised her hand after him.
        after.join("10", "bob");
        expect(after.hands()).toEqual(["10:bob", "7:ann"]);
    });

    it("keeps hands through a play restart, when everyone leaves the space before rejoining", async () => {
        const redis = memoryStore();
        const before = space(FilterType.ALL_USERS, redis.store);
        await settle();
        const ann = before.join("1", "ann"),
            bob = before.join("2", "bob");
        before.manager.raiseHand(ann, true);
        later();
        before.manager.raiseHand(bob, true);
        before.leave("1");
        before.leave("2");
        before.manager.destroy();
        expect(redis.saved()?.hands.map((hand) => hand.uuid)).toEqual(["ann", "bob"]);
        const after = space(FilterType.ALL_USERS, redis.store);
        await settle();
        after.join("5", "bob");
        after.join("6", "ann");
        expect(after.hands()).toEqual(["6:ann", "5:bob"]);
    });

    it("forgets a hand its owner doesn't come back for in time, or that was lowered", async () => {
        const redis = memoryStore();
        const room = space(FilterType.ALL_USERS, redis.store);
        await settle();
        const teacher = room.join("1", "teacher", ["admin"]);
        const ann = room.join("2", "ann"),
            bob = room.join("3", "bob");
        room.manager.raiseHand(ann, true);
        room.manager.raiseHand(bob, true);
        room.manager.lowerHand(teacher, "3");
        room.leave("2");
        room.leave("3");
        vi.advanceTimersByTime(HAND_REJOIN_MS + 1);
        room.join("4", "ann");
        room.join("5", "bob");
        expect(room.hands()).toEqual([]);
        expect(redis.saved()).toBeUndefined();
    });

    it("keeps what happened while the saved queue was being read", async () => {
        const redis = memoryStore();
        const before = space(FilterType.ALL_USERS, redis.store);
        await settle();
        before.manager.raiseHand(before.join("1", "ann"), true);
        later();
        before.manager.raiseHand(before.join("2", "bob"), true);
        later();
        const release = redis.hold();
        const after = space(FilterType.ALL_USERS, redis.store);
        const ann = after.join("5", "ann");
        const cat = after.join("6", "cat");
        // Ann lowers her hand and Cat raises hers before Redis answers.
        after.manager.raiseHand(ann, false);
        after.manager.raiseHand(cat, true);
        after.join("7", "bob");
        release();
        await settle();
        expect(after.hands()).toEqual(["7:bob", "6:cat"]);
        expect(redis.saved()?.hands.map((hand) => hand.uuid)).toEqual(["bob", "cat"]);
    });

    it("works on memory alone when Redis can't be read", async () => {
        const redis = memoryStore();
        redis.fail(true);
        const room = space(FilterType.ALL_USERS, redis.store);
        await settle();
        room.manager.raiseHand(room.join("1", "ann"), true);
        expect(room.hands()).toEqual(["1:ann"]);
    });

    it("hands the place to the same account's other tab when one replaces the other", async () => {
        const redis = memoryStore();
        const room = space(FilterType.ALL_USERS, redis.store);
        await settle();
        room.manager.raiseHand(room.join("1", "ann"), true);
        room.join("2", "ann");
        room.leave("1");
        expect(room.hands()).toEqual(["2:ann"]);
    });
});
