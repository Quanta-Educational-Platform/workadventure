// quanta: a hand raised in the room itself, not only in a conversation (QUANTA_UI). Outside any bubble, meeting area
// or listener zone, the raise-hand button raises it in the room's world space, which everyone in the room is in:
// its queue shows to everyone, and only admins lower it (RaiseHandManager). The world space syncs no media, so the
// request is sent from here rather than by its SpacePeerManager; being lowered by someone else is noticed there
// (watchRaiseHandState), as in any space.
import { get, writable, type Readable } from "svelte/store";
import { requestedHandRaiseState } from "../Stores/RaiseHandStore";
import type { SpaceInterface } from "../Space/SpaceInterface";

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
