// quanta: what speaking to the whole class looks like. The speaker sees whether the class hears them (OnAirStrip.svelte);
// staff see who is on air and whether sound comes through, from the audio they receive.
import { derived, readable, type Readable } from "svelte/store";
import type { SpaceInterface } from "../Space/SpaceInterface";
import type { Streamable } from "../Space/Streamable";
import { heldTalking } from "./talkingIndicator";

/** Three bars from WA's seven volume bands (0 to 1 each), like the level Meet shows. */
export function micLevels(bands: number[] | undefined): number[] {
    const all = bands ?? [];
    return [0, 1, 2].map((i) => {
        const slice = all.slice(i * 2, i * 2 + 3);
        const average = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
        return Math.min(1, average / 120);
    });
}

// Above room noise: about what WA's own voice indicator needs.
const SOUND_LEVEL = 0.12;

export function sounding(bands: number[] | undefined): boolean {
    return micLevels(bands).some((level) => level >= SOUND_LEVEL);
}

/** With no sound at all for this long, the microphone is likely the wrong one. Pausing to listen or write is not. */
export const QUIET_MS = 15000;

/** True once `talking` has not come on for `ms` from the start; once it has, silence no longer counts. */
export function quietFor(talking: Readable<boolean>, ms = QUIET_MS): Readable<boolean> {
    return readable(false, (set) => {
        let heard = false;
        const timer = setTimeout(() => {
            if (!heard) set(true);
        }, ms);
        const unsubscribe = talking.subscribe((on) => {
            if (!on) return;
            heard = true;
            clearTimeout(timer);
            set(false);
        });
        return () => {
            unsubscribe();
            clearTimeout(timer);
        };
    });
}

export type OnAirPrompt = "heard" | "quiet" | "micOff" | "micBlocked";

/**
 * What the speaker is told while on air. The browser blocking the microphone needs a different fix from a microphone
 * turned off; a microphone on that picks up nothing for a while is most often the wrong device.
 */
export function onAirPrompt(mic: { on: boolean; denied: boolean; quiet: boolean }): OnAirPrompt {
    if (mic.denied) return "micBlocked";
    if (!mic.on) return "micOff";
    return mic.quiet ? "quiet" : "heard";
}

export type SpeakerStatus = "talking" | "quiet" | "micOff" | "on";

/** A speaker as staff see them: `talking` and `quiet` are known only for the lecture's speakers. */
export function speakerStatus(speaker: { muted?: boolean; talking?: boolean; quiet?: boolean }): SpeakerStatus {
    if (speaker.muted) return "micOff";
    if (speaker.talking) return "talking";
    return speaker.quiet ? "quiet" : "on";
}

/** Whom the class can hear: a microphone that is off or silent reaches nobody, and that speaker is told themselves. */
export function audibleSpeakers<T extends { muted?: boolean; talking?: boolean; quiet?: boolean }>(speakers: T[]): T[] {
    return speakers.filter((speaker) => {
        const status = speakerStatus(speaker);
        return status === "talking" || status === "on";
    });
}

/** The first `max` speakers, the rest counted: more than a few rows would cover the room. */
export function visibleSpeakers<T>(speakers: T[], max = 3): { shown: T[]; more: number } {
    if (speakers.length <= max) return { shown: speakers, more: 0 };
    return { shown: speakers.slice(0, max - 1), more: speakers.length - (max - 1) };
}

/** Sound arrives from this stream: LiveKit's speaking flag, or the level of a peer-to-peer stream. */
export function streamableSounding(streamable: Pick<Streamable, "showVoiceIndicator" | "volumeStore">) {
    const volume = streamable.volumeStore ?? readable<number[] | undefined>(undefined);
    return derived([streamable.showVoiceIndicator, volume], ([speaking, bands]) => speaking || sounding(bands));
}

export type SpeakerSound = { talking: boolean; quiet: boolean };

/**
 * Whether sound from each of `ids` reaches this user in `space`: what the class hears from them. Only those ids are
 * listened to (a peer-to-peer stream's level is measured only while asked for). Talking is held over short gaps;
 * quiet means nothing has come at all for QUIET_MS.
 */
export function speakerSoundStore(
    space: Pick<SpaceInterface, "videoStreamStore"> | undefined,
    ids: string[],
): Readable<Map<string, SpeakerSound>> {
    if (!space?.videoStreamStore || ids.length === 0) return readable(new Map());
    const perSpeaker = ids.map((id) => {
        const arriving = derived<typeof space.videoStreamStore, boolean>(
            space.videoStreamStore,
            (boxes, set) => {
                const box = boxes.get(id);
                if (!box) {
                    set(false);
                    return;
                }
                let stopSound: (() => void) | undefined;
                const stopStreamable = box.streamable.subscribe((streamable) => {
                    stopSound?.();
                    stopSound = undefined;
                    if (streamable) stopSound = streamableSounding(streamable).subscribe(set);
                    else set(false);
                });
                return () => {
                    stopStreamable();
                    stopSound?.();
                };
            },
            false,
        );
        return derived([heldTalking(arriving), quietFor(arriving)], ([talking, quiet]) => ({ talking, quiet }));
    });
    return derived(perSpeaker, (sounds) => new Map(ids.map((id, index) => [id, sounds[index]])));
}
