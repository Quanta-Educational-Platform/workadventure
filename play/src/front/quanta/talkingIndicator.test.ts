import { afterEach, expect, it, vi } from "vitest";
import { writable } from "svelte/store";
import { heldTalking, voiceIndicatorWanted } from "./talkingIndicator";

afterEach(() => vi.useRealTimers());

it("shows talking at once and holds it over short gaps in speech", () => {
    vi.useFakeTimers();
    const volume = writable(false);
    const seen: boolean[] = [];
    const unsubscribe = heldTalking(volume, 800).subscribe((talking) => seen.push(talking));
    volume.set(true);
    volume.set(false);
    vi.advanceTimersByTime(500);
    volume.set(true);
    volume.set(false);
    vi.advanceTimersByTime(799);
    expect(seen).toEqual([false, true]);
    vi.advanceTimersByTime(1);
    expect(seen).toEqual([false, true, false]);
    unsubscribe();
    volume.set(true);
    expect(seen).toEqual([false, true, false]);
});

it("shows a class's talking in any conversation, WA's only on air", () => {
    expect(voiceIndicatorWanted(true, false, true)).toBe(true);
    expect(voiceIndicatorWanted(true, false, false)).toBe(false);
    expect(voiceIndicatorWanted(false, false, true)).toBe(false);
    expect(voiceIndicatorWanted(false, true, false)).toBe(true);
});
