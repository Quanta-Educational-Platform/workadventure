// quanta: starts the people list's volume for each person (personVolume.ts) on the room's own streams, apart from it
// so its rules are tested without the room's media stores.
import type { Unsubscriber } from "svelte/store";
import { streamableCollectionStore } from "../Stores/StreamableCollectionStore";
import { volumeProximityDiscussionStore } from "../Stores/PeerStore";
import { bindVoices, personVolumesStore, startVolumeBridge } from "./personVolume";

export function startPersonVolumes(): Unsubscriber {
    const stopVoices = bindVoices(streamableCollectionStore);
    const stopBridge = startVolumeBridge(personVolumesStore(volumeProximityDiscussionStore));
    return () => {
        stopVoices();
        stopBridge();
    };
}
