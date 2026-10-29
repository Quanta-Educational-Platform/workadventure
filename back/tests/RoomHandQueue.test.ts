import { describe, expect, it, vi } from "vitest";
import { Subject } from "rxjs";
import { FilterType, SpaceUser } from "@workadventure/messages";
import type { SpaceState } from "@workadventure/shared-utils";
import { emptySpaceState } from "@workadventure/shared-utils";
import type { SpaceStateHost } from "../src/Model/SpaceStateHost";
import { RaiseHandManager } from "../src/Model/RaiseHandManager";
vi.mock("../src/Enum/EnvironmentVariable", () => ({ MODERATION_ADMINS_ONLY: true }));

function fakeSpace(filterType: SpaceStateHost["filterType"], ...partialUsers: Partial<SpaceUser>[]) {
    const users = partialUsers.map((user) => SpaceUser.fromPartial(user));
    const userRemoved$ = new Subject<SpaceUser>();
    const userUpdated$ = new Subject<{ user: SpaceUser; previous: SpaceUser }>();
    let state: SpaceState = emptySpaceState();
    const host: SpaceStateHost = {
        filterType,
        userRemoved$,
        userUpdated$,
        getUser: (spaceUserId) => users.find((user) => user.spaceUserId === spaceUserId),
        getState: () => state,
        updateState: (mutate) => {
            const next = structuredClone(state);
            mutate(next);
            state = next;
        },
    };
    const user = (spaceUserId: string): SpaceUser => {
        const found = host.getUser(spaceUserId);
        if (!found) throw new Error(`no user ${spaceUserId}`);
        return found;
    };
    // What Space.updateUser does: merge the change, then tell what the user looked like before.
    const updateUser = (spaceUserId: string, changes: Partial<SpaceUser>) => {
        const updated = user(spaceUserId);
        const previous = { ...updated };
        Object.assign(updated, changes);
        userUpdated$.next({ user: updated, previous });
    };
    return { host, userRemoved$, user, updateUser, state: () => state };
}

describe("room hand queue with staff-only moderation", () => {
    it("keeps order, rejects student moderation, allows admin lower-one and lower-all, and removes leavers", () => {
        const { host, user, state, userRemoved$ } = fakeSpace(
            FilterType.ALL_USERS,
            { spaceUserId: "teacher", tags: ["admin"] },
            { spaceUserId: "a", name: "Same" },
            { spaceUserId: "b", name: "Same", megaphoneState: true },
        );
        const manager = new RaiseHandManager(host);
        manager.raiseHand(user("b"), true);
        manager.raiseHand(user("a"), true);
        manager.raiseHand(user("b"), true);
        expect(state().raisedHands.map((h) => h.spaceUserId)).toEqual(["b", "a"]);
        for (const id of ["a", "b"]) {
            expect(() => manager.lowerHand(user(id), "a")).toThrow();
            expect(() => manager.giveFloor(user(id), "a")).toThrow();
        }
        expect(state().raisedHands).toHaveLength(2);
        manager.lowerHand(user("teacher"), "b");
        expect(state().raisedHands.map((h) => h.spaceUserId)).toEqual(["a"]);
        manager.raiseHand(user("b"), true);
        for (const hand of state().raisedHands) manager.lowerHand(user("teacher"), hand.spaceUserId);
        expect(state().raisedHands).toEqual([]);
        manager.raiseHand(user("a"), true);
        userRemoved$.next(user("a"));
        expect(state().raisedHands).toEqual([]);
        manager.destroy();
    });
});
