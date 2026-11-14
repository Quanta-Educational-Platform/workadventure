// quanta: on air in the class lecture from the podium or a megaphone spot. Whoever is on air can stop it themselves
// (the dock's megaphone button): the zones they stand on stay silent until they step off and back on. Staff can also
// go on air from anywhere with the same button, in the podium's lecture.
import { derived, writable } from "svelte/store";
import { currentLiveStreamingSpaceStore } from "../Stores/MegaphoneStore";
import { effectiveMicrophoneStateStore } from "../Stores/MediaStore";

// On air in the lecture: from the podium, a megaphone spot, or a floor given.
export const selfOnAirStore = derived<typeof currentLiveStreamingSpaceStore, boolean>(
    currentLiveStreamingSpaceStore,
    (live, set) => (live ? live.isStreamingAudioStore.subscribe(set) : set(false)),
    false,
);

// On a megaphone spot or the podium with the microphone off: on air, but the class hears nothing. The microphone is only
// watched while on air: watching it is what starts the device chain (Stores/MediaStore.ts).
export const selfOnAirMutedStore = derived<typeof selfOnAirStore, boolean>(
    selfOnAirStore,
    (onAir, set) => (onAir ? effectiveMicrophoneStateStore.subscribe((open) => set(!open)) : set(false)),
    false,
);

const stopListeners = new Set<() => void>();

export function stopSpeakingToClass(): void {
    for (const listener of stopListeners) listener();
}

export function onStopSpeakingToClass(listener: () => void): () => void {
    stopListeners.add(listener);
    return () => stopListeners.delete(listener);
}

/** The room has a lecture that staff can speak in from anywhere (AreasPropertiesListener). */
export const classLectureAvailableStore = writable(false);

const speakListeners = new Set<() => void>();

export function speakToClass(): void {
    for (const listener of speakListeners) listener();
}

export function onSpeakToClass(listener: () => void): () => void {
    speakListeners.add(listener);
    return () => speakListeners.delete(listener);
}
