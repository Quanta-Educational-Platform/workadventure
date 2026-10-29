// quanta: the world space keeps the queue independent of media and conversation membership.
import { get, writable, type Readable } from "svelte/store";
import { QUANTA_UI } from "../Enum/EnvironmentVariable";
import { requestedHandRaiseState } from "../Stores/RaiseHandStore";
import type { SpaceInterface } from "../Space/SpaceInterface";

export const ROOM_HAND_SPACE_NAME = "allWorldUser";

const roomSpace = writable<SpaceInterface | undefined>(undefined);

/** The room's world space, once joined, where a hand can be raised under QUANTA_UI. */
export const roomHandSpaceStore: Readable<SpaceInterface | undefined> = roomSpace;

export function startRoomHand(space: SpaceInterface): () => void {
    roomSpace.set(space);
    const unsubscribe = requestedHandRaiseState.subscribe((raisedIn) => {
        const wantsRaised = raisedIn.has(space.getName());
        const isRaised = get(space.state.raisedHandsStore).some((entry) => entry.spaceUserId === space.mySpaceUserId);
        if (wantsRaised !== isRaised) {
            space.state.raiseHand(wantsRaised).catch((error) => console.error(error));
        }
    });
    return () => {
        unsubscribe();
        requestedHandRaiseState.lower(space.getName());
        roomSpace.update((current) => (current === space ? undefined : current));
    };
}

export function onHandConversationChanged(inConversation: boolean): void {
    // The room queue outlives media conversations, including silent-zone transitions.
    if (!QUANTA_UI && !inConversation) {
        requestedHandRaiseState.lowerAll();
    }
}
