import { afterEach, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";
import {
    micLevels,
    onAirPrompt,
    quietFor,
    QUIET_MS,
    sounding,
    speakerSoundStore,
    speakerStatus,
    streamableSounding,
    visibleSpeakers,
} from "./onAir";

afterEach(() => vi.useRealTimers());

it("reads three bars from WA's volume bands and tells sound from room noise", () => {
    expect(micLevels(undefined)).toEqual([0, 0, 0]);
    expect(micLevels([120, 120, 120, 0, 0, 0, 0])).toEqual([1, 40 / 120, 0]);
    expect(sounding(undefined)).toBe(false);
    expect(sounding([5, 5, 5, 5, 5, 5, 5])).toBe(false);
    expect(sounding([60, 60, 60, 0, 0, 0, 0])).toBe(true);
});

it("tells the speaker on air what keeps the class from hearing them, the browser's block first", () => {
    expect(onAirPrompt({ on: true, denied: false, quiet: false })).toBe("heard");
    expect(onAirPrompt({ on: false, denied: false, quiet: false })).toBe("micOff");
    expect(onAirPrompt({ on: false, denied: true, quiet: false })).toBe("micBlocked");
    expect(onAirPrompt({ on: true, denied: false, quiet: true })).toBe("quiet");
});

it("turns quiet only when nothing has sounded since the start, and never once something has", () => {
    vi.useFakeTimers();
    const silent = writable(false);
    const seenSilent: boolean[] = [];
    const stopSilent = quietFor(silent, 1000).subscribe((quiet) => seenSilent.push(quiet));
    vi.advanceTimersByTime(1000);
    expect(seenSilent).toEqual([false, true]);
    silent.set(true);
    expect(seenSilent).toEqual([false, true, false]);
    stopSilent();

    const talking = writable(false);
    const seen: boolean[] = [];
    const stop = quietFor(talking, 1000).subscribe((quiet) => seen.push(quiet));
    vi.advanceTimersByTime(900);
    talking.set(true);
    talking.set(false);
    vi.advanceTimersByTime(5000);
    expect(seen).toEqual([false]);
    stop();
});

it("shows staff each speaker's state, the microphone first", () => {
    expect(speakerStatus({ muted: true, talking: true })).toBe("micOff");
    expect(speakerStatus({ talking: true, quiet: false })).toBe("talking");
    expect(speakerStatus({ talking: false, quiet: true })).toBe("quiet");
    expect(speakerStatus({})).toBe("on");
});

it("shows a few speakers and counts the rest", () => {
    expect(visibleSpeakers([1, 2, 3])).toEqual({ shown: [1, 2, 3], more: 0 });
    expect(visibleSpeakers([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2], more: 3 });
});

it("hears a stream by LiveKit's speaking flag or by a peer stream's level", () => {
    const speaking = writable(false);
    const volume = writable<number[] | undefined>(undefined);
    const sound = streamableSounding({ showVoiceIndicator: speaking, volumeStore: volume });
    expect(get(sound)).toBe(false);
    speaking.set(true);
    expect(get(sound)).toBe(true);
    speaking.set(false);
    volume.set([90, 90, 90, 0, 0, 0, 0]);
    expect(get(sound)).toBe(true);
    expect(get(streamableSounding({ showVoiceIndicator: writable(false), volumeStore: undefined }))).toBe(false);
});

it("follows the sound of each speaker on air through their stream, held over gaps, quiet after a while", () => {
    vi.useFakeTimers();
    const speaking = writable(false);
    const streamable = writable<unknown>(undefined);
    const boxes = writable(new Map([["s1", { streamable }]]));
    const sounds = speakerSoundStore({ videoStreamStore: boxes } as never, ["s1", "s2"]);
    const seen: Map<string, { talking: boolean; quiet: boolean }>[] = [];
    const unsubscribe = sounds.subscribe((value) => seen.push(value));
    expect(seen.at(-1)?.get("s1")).toEqual({ talking: false, quiet: false });
    streamable.set({ showVoiceIndicator: speaking, volumeStore: undefined });
    speaking.set(true);
    expect(seen.at(-1)?.get("s1")).toEqual({ talking: true, quiet: false });
    speaking.set(false);
    vi.advanceTimersByTime(QUIET_MS);
    expect(seen.at(-1)?.get("s1")).toEqual({ talking: false, quiet: true });
    // No stream from a speaker at all: quiet too.
    expect(seen.at(-1)?.get("s2")).toEqual({ talking: false, quiet: true });
    unsubscribe();
    expect(get(speakerSoundStore(undefined, ["s1"])).size).toBe(0);
});
