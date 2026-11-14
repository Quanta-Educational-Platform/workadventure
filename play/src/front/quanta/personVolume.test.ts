import { afterEach, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";

vi.mock("../Enum/EnvironmentVariable", () => ({ QUANTA_URL: "", QUANTA_UI: true }));

vi.mock("./studentView", () => ({
    studentViewStore: { subscribe: (run: (on: boolean) => void) => (run(false), () => undefined) },
    moderationInView: (canModerate: boolean) => canModerate,
}));
import type { VideoBox } from "../Space/VideoBox";
import type { Streamable } from "../Space/Streamable";
import { roomModerationStore } from "./moderationBridge";
import { resetPlatformOriginForTests } from "./platformOrigin";
import {
    bindVoices,
    clampVolume,
    personVolumesStore,
    resetPersonVolumesForTests,
    setPersonVolume,
    startVolumeBridge,
} from "./personVolume";

afterEach(() => {
    vi.unstubAllGlobals();
    resetPlatformOriginForTests();
    resetPersonVolumesForTests();
    roomModerationStore.set(undefined);
});

const room = {
    self: "me",
    canModerate: false,
    muted: [],
    removed: [],
    people: [
        { id: "me", name: "Me", staff: false },
        { id: "ann", name: "Ann", staff: false },
        { id: "teacher", name: "T", staff: true },
    ],
};

function voice(volume = 1, videoType: Streamable["videoType"] = "video") {
    return { videoType, volume: writable(volume) } as unknown as Streamable;
}

function box(uuid: string, streamable: Streamable) {
    return { spaceUser: { uuid }, streamable: writable(streamable) } as unknown as VideoBox & {
        streamable: ReturnType<typeof writable<Streamable | undefined>>;
    };
}

it("keeps a person's voice at the chosen volume, through a new stream, and takes a tile's change as the choice", () => {
    roomModerationStore.set(room);
    const volumes = personVolumesStore(writable(0.8));
    expect(get(volumes)).toEqual({ ann: 0.8, teacher: 0.8 });
    setPersonVolume("ann", 0.3);
    const first = voice(1);
    const ann = box("ann", first);
    const screen = voice(1, "screenSharing");
    const boxes = writable(
        new Map<string, VideoBox>([
            ["ann", ann],
            ["ann-screen", box("ann", screen)],
        ]),
    );
    const stop = bindVoices(boxes);
    expect(get(first.volume)).toBe(0.3);
    // A screen share's sound is not their voice.
    expect(get(screen.volume)).toBe(1);
    first.volume.set(0.6);
    expect(get(volumes).ann).toBe(0.6);
    const reconnected = voice(1);
    ann.streamable.set(reconnected);
    expect(get(reconnected.volume)).toBe(0.6);
    setPersonVolume("ann", 0);
    expect(get(reconnected.volume)).toBe(0);
    expect(get(first.volume)).toBe(0.6);
    stop();
    setPersonVolume("ann", 1);
    expect(get(reconnected.volume)).toBe(0);
});

it("follows a box replaced under the same key, and leaves the old one", () => {
    roomModerationStore.set(room);
    setPersonVolume("ann", 0.2);
    const old = voice(1);
    const boxes = writable(new Map<string, VideoBox>([["ann", box("ann", old)]]));
    const stop = bindVoices(boxes);
    expect(get(old.volume)).toBe(0.2);
    // A move between spaces: the same person, a new box under the same key.
    const moved = voice(1);
    boxes.set(new Map<string, VideoBox>([["ann", box("ann", moved)]]));
    expect(get(moved.volume)).toBe(0.2);
    setPersonVolume("ann", 0.5);
    expect(get(moved.volume)).toBe(0.5);
    expect(get(old.volume)).toBe(0.2);
    stop();
});

it("takes only the viewer's changes as a choice, not a stream's starting volume", () => {
    roomModerationStore.set(room);
    const volumes = personVolumesStore(writable(1));
    // A stream that starts quiet (the general listening volume at the time) is not a choice for that person.
    const quiet = voice(0);
    const stop = bindVoices(writable(new Map<string, VideoBox>([["ann", box("ann", quiet)]])));
    expect(get(volumes).ann).toBe(1);
    quiet.volume.set(0.4);
    expect(get(volumes).ann).toBe(0.4);
    stop();
});

it("clamps to 0..1 and refuses what is not a number", () => {
    expect(clampVolume(1.7)).toBe(1);
    expect(clampVolume(-2)).toBe(0);
    expect(clampVolume(0.25)).toBe(0.25);
    expect(clampVolume(Number.NaN)).toBeUndefined();
    expect(clampVolume("1")).toBeUndefined();
});

it("reports volumes to the platform and takes its changes only for someone else in the room", () => {
    const parent = { postMessage: vi.fn() };
    const events = new EventTarget();
    vi.stubGlobal("window", {
        parent,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
    });
    vi.stubGlobal("document", { referrer: "https://school.quanta.world/eng/courses/c" });
    roomModerationStore.set(room);
    const volumes = personVolumesStore(writable(1));
    const stop = startVolumeBridge(volumes);
    const origin = "https://school.quanta.world";
    expect(parent.postMessage).toHaveBeenLastCalledWith(
        { type: "quanta_wa_volumes", volumes: { ann: 1, teacher: 1 } },
        origin,
    );
    const send = (data: unknown, from = origin, source: unknown = parent) => {
        const event = new Event("message");
        Object.assign(event, { source, data, origin: from });
        events.dispatchEvent(event);
    };
    send({ type: "quanta_wa_set_volume", id: "ann", volume: 0.4 }, "https://evil.example");
    send({ type: "quanta_wa_set_volume", id: "ann", volume: 0.4 }, origin, {});
    send({ type: "quanta_wa_set_volume", id: "me", volume: 0.4 });
    send({ type: "quanta_wa_set_volume", id: "stranger", volume: 0.4 });
    send({ type: "quanta_wa_set_volume", id: "ann", volume: "0.4" });
    expect(get(volumes)).toEqual({ ann: 1, teacher: 1 });
    send({ type: "quanta_wa_set_volume", id: "ann", volume: 3 });
    expect(get(volumes).ann).toBe(1);
    send({ type: "quanta_wa_set_volume", id: "teacher", volume: 0.25 });
    expect(parent.postMessage).toHaveBeenLastCalledWith(
        { type: "quanta_wa_volumes", volumes: { ann: 1, teacher: 0.25 } },
        origin,
    );
    parent.postMessage.mockClear();
    send({ type: "quanta_wa_volumes_request" });
    expect(parent.postMessage).toHaveBeenCalledOnce();
    stop();
    send({ type: "quanta_wa_set_volume", id: "ann", volume: 0 });
    expect(get(volumes).ann).toBe(1);
});
