import { afterEach, describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";
import type { SpaceInterface } from "../Space/SpaceInterface";
import { requestedHandRaiseState } from "../Stores/RaiseHandStore";
import { onHandConversationChanged, ROOM_HAND_SPACE_NAME, roomHandSpaceStore, startRoomHand } from "./roomHand";

const mode = vi.hoisted(() => ({ quanta: true }));
vi.mock("../Enum/EnvironmentVariable", () => ({
    get QUANTA_UI() {
        return mode.quanta;
    },
}));

afterEach(() => {
    requestedHandRaiseState.lowerAll();
    mode.quanta = true;
});

describe("room hand conversation lifecycle", () => {
    it("keeps the room hand and its timestamp across conversation exits and silent-zone transitions", () => {
        const hands = writable<{ spaceUserId: string; name: string; at: number }[]>([]);
        const raiseHand = vi.fn(async (raised: boolean) => {
            hands.set(raised ? [{ spaceUserId: "student", name: "Student", at: 123 }] : []);
        });
        const space = {
            getName: () => ROOM_HAND_SPACE_NAME,
            mySpaceUserId: "student",
            state: { raisedHandsStore: hands, raiseHand },
        } as unknown as SpaceInterface;
        const stopRoom = startRoomHand(space);
        const conversation = writable(false);
        const stopConversation = conversation.subscribe(onHandConversationChanged);
        try {
            conversation.set(true);
            requestedHandRaiseState.raise(ROOM_HAND_SPACE_NAME);
            const raised = get(hands);
            conversation.set(false);
            conversation.set(true);
            conversation.set(false);
            expect(get(requestedHandRaiseState).has(ROOM_HAND_SPACE_NAME)).toBe(true);
            expect(get(hands)).toBe(raised);
            expect(raiseHand.mock.calls).toEqual([[true]]);

            requestedHandRaiseState.lower(ROOM_HAND_SPACE_NAME);
            expect(get(hands)).toEqual([]);
            expect(raiseHand.mock.calls).toEqual([[true], [false]]);

            requestedHandRaiseState.raise(ROOM_HAND_SPACE_NAME);
            stopRoom();
            expect(get(requestedHandRaiseState).has(ROOM_HAND_SPACE_NAME)).toBe(false);
            expect(get(roomHandSpaceStore)).toBeUndefined();
        } finally {
            stopConversation();
            stopRoom();
        }
    });

    it("retains upstream conversation-scoped cleanup outside Quanta UI", () => {
        mode.quanta = false;
        requestedHandRaiseState.raise("bubble");
        onHandConversationChanged(true);
        expect(get(requestedHandRaiseState).has("bubble")).toBe(true);
        onHandConversationChanged(false);
        expect(get(requestedHandRaiseState).size).toBe(0);
    });
});
