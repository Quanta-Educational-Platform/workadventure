// quanta: when to tell someone that nobody hears them (notHeard.ts). The check only reads the browser's volume meter
// while the microphone is on and nobody is in earshot; nothing is recorded or sent. A microphone that is off isn't
// opened for it.
import { derived, readable, writable, type Unsubscriber } from "svelte/store";
import { chatNotificationStore } from "../Stores/ProximityNotificationStore";
import { coWebsites } from "../Stores/CoWebsiteStore";
import { currentPlayerGroupIdStore } from "../Stores/CurrentPlayerGroupStore";
import { isLiveStreamingAudioStore } from "../Stores/IsStreamingStore";
import { givenFloorSpaceStore } from "../Stores/MegaphoneStore";
import {
    effectiveMicrophoneStateStore,
    inLivekitStore,
    localVolumeStore,
    requestedMicrophoneState,
    silentStore,
} from "../Stores/MediaStore";
import { NotHeardHint } from "./notHeard";
import { selfOnAirStore } from "./speakingToClass";

/** Something of the dock's own is open above it: the hint waits rather than sit over it. */
export const notHeardBlockedStore = writable(false);

function browserStorage(): Storage | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

const heardStore = derived(
    [isLiveStreamingAudioStore, currentPlayerGroupIdStore, inLivekitStore, selfOnAirStore, givenFloorSpaceStore],
    ([$streaming, $group, $livekit, $onAir, $floor]) =>
        $streaming || $group !== undefined || $livekit || $onAir || $floor !== undefined,
);

const unheardStore = derived(
    [
        requestedMicrophoneState,
        effectiveMicrophoneStateStore,
        heardStore,
        silentStore,
        coWebsites,
        chatNotificationStore,
        notHeardBlockedStore,
    ],
    ([$requested, $capturing, $heard, $silent, $websites, $toasts, $blocked]) =>
        $requested && $capturing && !$heard && !$silent && $websites.length === 0 && $toasts.length === 0 && !$blocked,
);

const hint = new NotHeardHint(browserStorage());
const dismissed = writable(0);

export const notHeardHintStore = readable(false, (set) => {
    let stopMeter: Unsubscriber | undefined;
    const stopUnheard = unheardStore.subscribe((unheard) => {
        stopMeter?.();
        stopMeter = undefined;
        if (!unheard) {
            hint.update(Date.now(), false, undefined);
            set(false);
            return;
        }
        // Reading the meter only while someone may need telling. A hidden tab wouldn't show the hint anyway.
        stopMeter = localVolumeStore.subscribe((bands) => {
            if (document.visibilityState === "visible") set(hint.update(Date.now(), true, bands));
        });
    });
    const stopDismissed = dismissed.subscribe((count) => {
        if (count > 0) set(false);
    });
    return () => {
        stopMeter?.();
        stopUnheard();
        stopDismissed();
    };
});

export function dismissNotHeardHint(): void {
    hint.dismiss();
    dismissed.update((count) => count + 1);
}
