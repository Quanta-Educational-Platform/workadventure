import { get, writable } from "svelte/store";
import { QUANTA_UI } from "../Enum/EnvironmentVariable";
import { videoStreamElementsStore } from "./PeerStore";
import { isLiveStreamingStore } from "./IsStreamingStore";
import { focusStore } from "./FocusStore";
import { visibilityStore } from "./VisibilityStore";

// quanta: in the platform's frame the user hasn't left when focus goes to the platform's page beside the room (or
// to its minimized room card): the room only counts as left when the tab is hidden.
const presenceStore = QUANTA_UI && window.parent !== window ? visibilityStore : focusStore;

/**
 * A store that contains "true" if the webcam should be stopped for privacy reasons - i.e. if the user leaves the page while not in a discussion.
 */
function createPrivacyShutdownStore() {
    let privacyEnabled = false;

    const { subscribe, set } = writable(privacyEnabled);

    // It is ok to not unsubscribe to this store because it is a singleton.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    presenceStore.subscribe((hasFocus) => {
        const peerCount = get(videoStreamElementsStore).length;
        const isLiveStreaming = get(isLiveStreamingStore);

        if (!hasFocus && peerCount === 0 && !isLiveStreaming) {
            privacyEnabled = true;
            set(true);
        }
        if (hasFocus) {
            privacyEnabled = false;
            set(false);
        }
    });

    // It is ok to not unsubscribe to this store because it is a singleton.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    videoStreamElementsStore.subscribe((peerElements) => {
        const hasFocus = get(presenceStore);
        const isLiveStreaming = get(isLiveStreamingStore);
        if (peerElements.length === 0 && hasFocus === false && !isLiveStreaming) {
            privacyEnabled = true;
            set(true);
        }
    });

    return {
        subscribe,
    };
}

export const privacyShutdownStore = createPrivacyShutdownStore();
