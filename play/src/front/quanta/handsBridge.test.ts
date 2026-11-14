import { afterEach, expect, it, vi } from "vitest";
import { writable } from "svelte/store";
import type { RaisedHandSection } from "../Space/SpaceInterface";

vi.mock("../Stores/PeerStore", async () => {
    const { writable } = await import("svelte/store");
    return { raisedHandSectionsStore: writable([]) };
});
vi.mock("../Stores/GameStore", async () => {
    const { writable } = await import("svelte/store");
    return { userIsAdminStore: writable(false) };
});
vi.mock("../Enum/EnvironmentVariable", () => ({ QUANTA_URL: "" }));
vi.mock("../Stores/RaisedHandsAdminVisibleStore", () => ({
    sectionRights: (section: { lecture?: boolean }, admin: boolean) => ({
        canModerate: admin,
        floorControls: admin && section.lecture === true,
    }),
}));
vi.mock("./goTo", () => ({ goTo: vi.fn() }));
vi.mock("../Stores/MegaphoneStore", async () => {
    const { writable } = await import("svelte/store");
    return { givenFloorSpaceStore: writable(undefined), currentLiveStreamingSpaceStore: writable(undefined) };
});
vi.mock("../Stores/MediaStore", async () => {
    const { writable } = await import("svelte/store");
    return { effectiveMicrophoneStateStore: writable(true) };
});
import { raisedHandSectionsStore } from "../Stores/PeerStore";
import { effectiveMicrophoneStateStore } from "../Stores/MediaStore";
import { userIsAdminStore } from "../Stores/GameStore";
import { currentLiveStreamingSpaceStore, givenFloorSpaceStore } from "../Stores/MegaphoneStore";
import { startHandsBridge } from "./handsBridge";
import { goTo } from "./goTo";
import { resetPlatformOriginForTests } from "./platformOrigin";

afterEach(() => {
    vi.unstubAllGlobals();
    resetPlatformOriginForTests();
    userIsAdminStore.set(false);
    (givenFloorSpaceStore as unknown as ReturnType<typeof writable<unknown>>).set(undefined);
});

it("reports order, identity and self; gates lower-one and lower-all and cleans up", () => {
    const parent = { postMessage: vi.fn() };
    const events = new EventTarget();
    vi.stubGlobal("window", {
        parent,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
    });
    const lowerHand = vi.fn().mockResolvedValue(undefined);
    const sections = raisedHandSectionsStore as unknown as ReturnType<typeof writable<RaisedHandSection[]>>;
    sections.set([
        {
            space: {
                mySpaceUserId: "b",
                state: { lowerHand },
                getSpaceUserBySpaceUserId: (id: string) => (id === "a" ? { uuid: "user-a" } : undefined),
            },
            hands: [
                { spaceUserId: "b", name: "Same", at: 2 },
                { spaceUserId: "a", name: "Same", at: 1 },
            ],
            speakers: [],
            onAirHere: false,
        } as unknown as RaisedHandSection,
    ]);
    const stop = startHandsBridge();
    expect(parent.postMessage.mock.lastCall?.[0]).toMatchObject({
        hands: ["Same", "Same"],
        canLowerAll: false,
        queue: [
            { id: "a", uuid: "user-a", self: false },
            { id: "b", uuid: undefined, self: true },
        ],
    });
    const send = (type: string, id?: string, source = parent) => {
        const event = new Event("message");
        Object.assign(event, { source, data: { type, id } });
        events.dispatchEvent(event);
    };
    send("quanta_wa_lower_hand", "a");
    send("quanta_wa_lower_all_hands");
    expect(lowerHand).not.toHaveBeenCalled();
    userIsAdminStore.set(true);
    expect(parent.postMessage.mock.lastCall?.[0].canLowerAll).toBe(true);
    send("quanta_wa_lower_hand", "a");
    expect(lowerHand.mock.calls).toEqual([["a"]]);
    lowerHand.mockClear();
    send("quanta_wa_lower_all_hands");
    expect(lowerHand.mock.calls).toEqual([["b"], ["a"]]);
    stop();
    lowerHand.mockClear();
    send("quanta_wa_lower_all_hands");
    expect(lowerHand).not.toHaveBeenCalled();
});

it("hides the room's own hands card only while the platform's people list is open, and never leaves it hidden", () => {
    const parent = { postMessage: vi.fn() };
    const events = new EventTarget();
    const classes = new Set<string>();
    vi.stubGlobal("window", {
        parent,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
    });
    vi.stubGlobal("document", {
        referrer: "https://school.quanta.world/eng/courses/c",
        documentElement: {
            classList: {
                toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
                remove: (name: string) => classes.delete(name),
            },
        },
    });
    const stop = startHandsBridge();
    const send = (data: unknown, source: unknown = parent, origin = "https://school.quanta.world") => {
        const event = new Event("message");
        Object.assign(event, { source, data, origin });
        events.dispatchEvent(event);
    };
    send({ type: "quanta_wa_people_panel", open: true }, {});
    expect(classes.has("quanta-people-open")).toBe(false);
    send({ type: "quanta_wa_people_panel", open: true }, parent, "https://elsewhere.example");
    expect(classes.has("quanta-people-open")).toBe(false);
    send({ type: "quanta_wa_people_panel", open: true });
    expect(classes.has("quanta-people-open")).toBe(true);
    send({ type: "quanta_wa_people_panel", open: "yes" });
    expect(classes.has("quanta-people-open")).toBe(false);
    send({ type: "quanta_wa_people_panel", open: true });
    stop();
    expect(classes.has("quanta-people-open")).toBe(false);
});

it("lets only a lecture's host, through the platform, give a student the class and take it back; reports who speaks", async () => {
    const parent = { postMessage: vi.fn() };
    const events = new EventTarget();
    vi.stubGlobal("window", {
        parent,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
    });
    vi.stubGlobal("document", {
        referrer: "https://school.quanta.world/eng/courses/c",
        documentElement: { classList: { toggle: () => {}, remove: () => {} } },
    });
    const speakingUsersStore = writable<{ spaceUserId: string; name: string }[]>([]);
    const giveFloor = vi.fn((id: string) => {
        speakingUsersStore.set([{ spaceUserId: id, name: "Ira" }]);
        return Promise.resolve();
    });
    const revokeFloor = vi.fn().mockResolvedValue(undefined);
    const lowerHand = vi.fn().mockResolvedValue(undefined);
    const sections = raisedHandSectionsStore as unknown as ReturnType<typeof writable<RaisedHandSection[]>>;
    sections.set([
        {
            lecture: true,
            space: {
                mySpaceUserId: "t",
                state: { giveFloor, revokeFloor, lowerHand, speakingUsersStore },
                getSpaceUserBySpaceUserId: (id: string) => (id === "s2" ? { uuid: "user-max" } : undefined),
            },
            hands: [{ spaceUserId: "s1", name: "Ira", at: 1 }],
            speakers: [{ spaceUserId: "s2", name: "Max" }],
            onAirHere: true,
        } as unknown as RaisedHandSection,
        {
            space: { mySpaceUserId: "t", state: { giveFloor, revokeFloor } },
            hands: [{ spaceUserId: "s3", name: "Ola", at: 2 }],
            speakers: [],
            onAirHere: false,
        } as unknown as RaisedHandSection,
    ]);
    const stop = startHandsBridge();
    const send = (data: unknown, origin = "https://school.quanta.world") => {
        const event = new Event("message");
        Object.assign(event, { source: parent, data, origin });
        events.dispatchEvent(event);
    };
    // A student sees no floor controls and nobody speaking: the host's rights decide.
    expect(parent.postMessage.mock.lastCall?.[0]).toMatchObject({
        queue: [
            { id: "s1", floor: false },
            { id: "s3", floor: false },
        ],
        speaking: [],
        selfSpeaking: false,
    });
    send({ type: "quanta_wa_give_floor", id: "s1" });
    expect(giveFloor).not.toHaveBeenCalled();
    userIsAdminStore.set(true);
    expect(parent.postMessage.mock.lastCall?.[0]).toMatchObject({
        queue: [
            { id: "s1", floor: true },
            { id: "s3", floor: false },
        ],
        // The people list finds the speaker's row by their account.
        speaking: [{ id: "s2", uuid: "user-max", name: "Max" }],
    });
    send({ type: "quanta_wa_give_floor", id: "s1" }, "https://elsewhere.example");
    send({ type: "quanta_wa_give_floor", id: "s3" });
    expect(giveFloor).not.toHaveBeenCalled();
    send({ type: "quanta_wa_give_floor", id: "s1" });
    expect(giveFloor.mock.calls).toEqual([["s1"]]);
    // Given the floor in the space their hand is up in, the hand comes down too.
    await vi.waitFor(() => expect(lowerHand).toHaveBeenCalledWith("s1"));
    send({ type: "quanta_wa_revoke_floor", id: "s1" });
    expect(revokeFloor).not.toHaveBeenCalled();
    send({ type: "quanta_wa_revoke_floor", id: "s2" });
    expect(revokeFloor.mock.calls).toEqual([["s2"]]);
    (givenFloorSpaceStore as unknown as ReturnType<typeof writable<unknown>>).set({});
    expect(parent.postMessage.mock.lastCall?.[0].selfSpeaking).toBe(true);
    stop();
});

it("lets a hand from the room's queue speak in the lecture the host is on air in, and lowers it", async () => {
    const parent = { postMessage: vi.fn() };
    const events = new EventTarget();
    vi.stubGlobal("window", {
        parent,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
    });
    vi.stubGlobal("document", {
        referrer: "https://quanta.test/",
        documentElement: { classList: { toggle: vi.fn(), remove: vi.fn() } },
    });
    const giveFloor = vi.fn().mockResolvedValue(undefined);
    const lowerHand = vi.fn().mockResolvedValue(undefined);
    const revokeFloor = vi.fn().mockResolvedValue(undefined);
    const speakingUsersStore = writable<{ spaceUserId: string; name: string }[]>([]);
    // The back grants the floor: the holder shows up in the lecture's state.
    giveFloor.mockImplementation((id: string) => {
        speakingUsersStore.set([{ spaceUserId: id, name: "Ann" }]);
        return Promise.resolve();
    });
    const live = {
        usersStore: writable(new Map()),
        isStreamingAudioStore: writable(false),
        state: { giveFloor, revokeFloor, speakingUsersStore },
    };
    (currentLiveStreamingSpaceStore as unknown as ReturnType<typeof writable<unknown>>).set(live);
    userIsAdminStore.set(true);
    const sections = raisedHandSectionsStore as unknown as ReturnType<typeof writable<RaisedHandSection[]>>;
    sections.set([
        {
            space: {
                mySpaceUserId: "me",
                state: { lowerHand },
            },
            hands: [{ spaceUserId: "room-a", name: "Ann", at: 1 }],
            speakers: [],
            onAirHere: false,
        } as unknown as RaisedHandSection,
    ]);
    const stop = startHandsBridge();
    expect(parent.postMessage.mock.lastCall?.[0].queue).toEqual([
        { id: "room-a", name: "Ann", at: 1, self: false, floor: true },
    ]);
    const event = new Event("message");
    Object.assign(event, {
        source: parent,
        origin: "https://quanta.test",
        data: { type: "quanta_wa_give_floor", id: "room-a" },
    });
    events.dispatchEvent(event);
    expect(giveFloor).toHaveBeenCalledWith("room-a");
    await vi.waitFor(() => expect(lowerHand).toHaveBeenCalledWith("room-a"));
    // The lecture's floor holder is listed for the host, who can take the floor back.
    expect(parent.postMessage.mock.lastCall?.[0].speaking).toEqual([{ id: "room-a", name: "Ann" }]);
    const revoke = new Event("message");
    Object.assign(revoke, {
        source: parent,
        origin: "https://quanta.test",
        data: { type: "quanta_wa_revoke_floor", id: "room-a" },
    });
    events.dispatchEvent(revoke);
    expect(revokeFloor).toHaveBeenCalledWith("room-a");
    stop();
    (currentLiveStreamingSpaceStore as unknown as ReturnType<typeof writable<unknown>>).set(undefined);
    sections.set([]);
});

it("finds a room-queue hand in the lecture by account when its space ids differ, and lowers it", async () => {
    const parent = { postMessage: vi.fn() };
    const events = new EventTarget();
    vi.stubGlobal("window", {
        parent,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
    });
    vi.stubGlobal("document", {
        referrer: "https://quanta.test/",
        documentElement: { classList: { toggle: vi.fn(), remove: vi.fn() } },
    });
    const speakingUsersStore = writable<{ spaceUserId: string; name: string }[]>([]);
    const giveFloor = vi.fn((id: string) => {
        speakingUsersStore.set([{ spaceUserId: id, name: "Ann" }]);
        return Promise.resolve();
    });
    const lowerHand = vi.fn().mockResolvedValue(undefined);
    const live = {
        usersStore: writable(new Map()),
        isStreamingAudioStore: writable(false),
        state: { giveFloor, revokeFloor: vi.fn(), speakingUsersStore },
        getSpaceUserByUuid: (uuid: string) => (uuid === "user-ann" ? { spaceUserId: "lecture-a" } : undefined),
        getSpaceUserBySpaceUserId: (id: string) => (id === "lecture-a" ? { uuid: "user-ann" } : undefined),
    };
    (currentLiveStreamingSpaceStore as unknown as ReturnType<typeof writable<unknown>>).set(live);
    userIsAdminStore.set(true);
    const sections = raisedHandSectionsStore as unknown as ReturnType<typeof writable<RaisedHandSection[]>>;
    sections.set([
        {
            space: {
                mySpaceUserId: "me",
                state: { lowerHand },
                getSpaceUserBySpaceUserId: (id: string) => (id === "room-a" ? { uuid: "user-ann" } : undefined),
            },
            hands: [{ spaceUserId: "room-a", name: "Ann", at: 1 }],
            speakers: [],
            onAirHere: false,
        } as unknown as RaisedHandSection,
    ]);
    const stop = startHandsBridge();
    const event = new Event("message");
    Object.assign(event, {
        source: parent,
        origin: "https://quanta.test",
        data: { type: "quanta_wa_give_floor", id: "room-a" },
    });
    events.dispatchEvent(event);
    expect(giveFloor).toHaveBeenCalledWith("lecture-a");
    await vi.waitFor(() => expect(lowerHand).toHaveBeenCalledWith("room-a"));
    stop();
    (currentLiveStreamingSpaceStore as unknown as ReturnType<typeof writable<unknown>>).set(undefined);
    sections.set([]);
});

it("keeps a room-queue hand up when the lecture refuses the floor (they are no longer in it)", async () => {
    const parent = { postMessage: vi.fn() };
    const events = new EventTarget();
    vi.stubGlobal("window", {
        parent,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
    });
    vi.stubGlobal("document", {
        referrer: "https://quanta.test/",
        documentElement: { classList: { toggle: vi.fn(), remove: vi.fn() } },
    });
    const giveFloor = vi.fn().mockResolvedValue(undefined);
    const lowerHand = vi.fn().mockResolvedValue(undefined);
    const live = {
        usersStore: writable(new Map()),
        isStreamingAudioStore: writable(false),
        state: { giveFloor, revokeFloor: vi.fn(), speakingUsersStore: writable([]) },
    };
    (currentLiveStreamingSpaceStore as unknown as ReturnType<typeof writable<unknown>>).set(live);
    userIsAdminStore.set(true);
    const sections = raisedHandSectionsStore as unknown as ReturnType<typeof writable<RaisedHandSection[]>>;
    sections.set([
        {
            space: { mySpaceUserId: "me", state: { lowerHand } },
            hands: [{ spaceUserId: "room-a", name: "Ann", at: 1 }],
            speakers: [],
            onAirHere: false,
        } as unknown as RaisedHandSection,
    ]);
    const stop = startHandsBridge();
    const event = new Event("message");
    Object.assign(event, {
        source: parent,
        origin: "https://quanta.test",
        data: { type: "quanta_wa_give_floor", id: "room-a" },
    });
    events.dispatchEvent(event);
    await vi.waitFor(() => expect(giveFloor).toHaveBeenCalledWith("room-a"));
    await new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
    expect(lowerHand).not.toHaveBeenCalled();
    stop();
    (currentLiveStreamingSpaceStore as unknown as ReturnType<typeof writable<unknown>>).set(undefined);
    sections.set([]);
});

it("reports who speaks from a megaphone spot to a teacher, taking it back turns their microphone off; tells a speaker they are on air", () => {
    const parent = { postMessage: vi.fn() };
    const events = new EventTarget();
    vi.stubGlobal("window", {
        parent,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
    });
    vi.stubGlobal("document", {
        referrer: "https://school.quanta.world/eng/courses/c",
        documentElement: { classList: { toggle: () => {}, remove: () => {} } },
    });
    (raisedHandSectionsStore as unknown as ReturnType<typeof writable<RaisedHandSection[]>>).set([]);
    const speaker = (
        spaceUserId: string,
        name: string,
        tags: string[] = [],
        megaphoneState = true,
        microphoneState = true,
    ) => [spaceUserId, { spaceUserId, name, tags, megaphoneState, microphoneState }];
    const usersStore = writable(
        new Map([
            speaker("t", "Teacher", ["admin"]),
            speaker("t2", "Other teacher", ["admin"]),
            speaker("s1", "Ira"),
            speaker("s9", "Not speaking", [], false),
            // Back on a spot after the teacher's Stop, the microphone still off: listed as muted.
            speaker("s5", "Silent on a spot", [], true, false),
        ] as never),
    );
    const revokeFloor = vi.fn().mockResolvedValue(undefined);
    const emitPrivateMessage = vi.fn();
    const isStreamingAudioStore = writable(false);
    const live = {
        mySpaceUserId: "t",
        usersStore,
        isStreamingAudioStore,
        emitPrivateMessage,
        state: { giveFloor: vi.fn(), revokeFloor, speakingUsersStore: writable([]) },
    };
    (currentLiveStreamingSpaceStore as unknown as ReturnType<typeof writable<unknown>>).set(live);
    const stop = startHandsBridge();
    const send = (data: unknown) => {
        const event = new Event("message");
        Object.assign(event, { source: parent, data, origin: "https://school.quanta.world" });
        events.dispatchEvent(event);
    };
    // A student is told nothing and can take nothing back.
    expect(parent.postMessage.mock.lastCall?.[0].speaking).toEqual([]);
    send({ type: "quanta_wa_revoke_floor", id: "s1" });
    expect(emitPrivateMessage).not.toHaveBeenCalled();

    userIsAdminStore.set(true);
    expect(parent.postMessage.mock.lastCall?.[0].speaking).toEqual([
        { id: "s1", name: "Ira" },
        { id: "s5", name: "Silent on a spot", muted: true },
    ]);
    send({ type: "quanta_wa_revoke_floor", id: "s1" });
    expect(emitPrivateMessage.mock.calls).toEqual([[{ $case: "muteAudio", muteAudio: { force: true } }, "s1"]]);
    expect(revokeFloor).not.toHaveBeenCalled();
    send({ type: "quanta_wa_revoke_floor", id: "t2" });
    expect(emitPrivateMessage).toHaveBeenCalledTimes(1);

    // Back on a spot with the microphone off, then turning it on: muted, then heard, at once.
    const microphoneState = writable(false);
    const megaphoneState = writable(true);
    usersStore.set(
        new Map([
            [
                "s7",
                {
                    spaceUserId: "s7",
                    name: "Back on a spot",
                    tags: [],
                    megaphoneState: true,
                    microphoneState: false,
                    reactiveUser: { megaphoneState, microphoneState },
                },
            ],
        ] as never),
    );
    expect(parent.postMessage.mock.lastCall?.[0].speaking).toEqual([{ id: "s7", name: "Back on a spot", muted: true }]);
    microphoneState.set(true);
    expect(parent.postMessage.mock.lastCall?.[0].speaking).toEqual([{ id: "s7", name: "Back on a spot" }]);
    megaphoneState.set(false);
    expect(parent.postMessage.mock.lastCall?.[0].speaking).toEqual([]);

    usersStore.set(new Map());
    expect(parent.postMessage.mock.lastCall?.[0].speaking).toEqual([]);
    // On a spot (or the podium) the speaker is told they are speaking to the whole class.
    expect(parent.postMessage.mock.lastCall?.[0].selfSpeaking).toBe(false);
    isStreamingAudioStore.set(true);
    expect(parent.postMessage.mock.lastCall?.[0].selfSpeaking).toBe(true);
    expect(parent.postMessage.mock.lastCall?.[0].selfMuted).toBe(false);
    // On the spot with the microphone off: on air, but the class hears nothing, and the speaker is told so.
    const microphone = effectiveMicrophoneStateStore as unknown as ReturnType<typeof writable<boolean>>;
    microphone.set(false);
    expect(parent.postMessage.mock.lastCall?.[0]).toMatchObject({ selfSpeaking: true, selfMuted: true });
    microphone.set(true);
    expect(parent.postMessage.mock.lastCall?.[0]).toMatchObject({ selfSpeaking: true, selfMuted: false });
    microphone.set(false);
    // The dock going (an error screen) leaves the platform nothing stale to show.
    stop();
    expect(parent.postMessage.mock.lastCall?.[0]).toEqual({
        type: "quanta_wa_hands",
        hands: [],
        queue: [],
        canLowerAll: false,
        speaking: [],
        selfSpeaking: false,
        selfMuted: false,
    });
    microphone.set(true);
    (currentLiveStreamingSpaceStore as unknown as ReturnType<typeof writable<unknown>>).set(undefined);
});

it("takes only a host, asked by the platform, to a raised hand or a person of the list", () => {
    const parent = { postMessage: vi.fn() };
    const events = new EventTarget();
    vi.stubGlobal("window", {
        parent,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
    });
    vi.stubGlobal("document", {
        referrer: "https://school.quanta.world/eng/courses/c",
        documentElement: { classList: { toggle: () => {}, remove: () => {} } },
    });
    const go = vi.mocked(goTo);
    go.mockClear();
    const stop = startHandsBridge();
    const send = (data: unknown, origin = "https://school.quanta.world") => {
        const event = new Event("message");
        Object.assign(event, { source: parent, data, origin });
        events.dispatchEvent(event);
    };
    send({ type: "quanta_wa_go_to", id: "room_7" });
    expect(go).not.toHaveBeenCalled();
    userIsAdminStore.set(true);
    send({ type: "quanta_wa_go_to", id: "room_7" }, "https://elsewhere.example");
    send({ type: "quanta_wa_go_to", id: 7 });
    send({ type: "quanta_wa_go_to" });
    expect(go).not.toHaveBeenCalled();
    send({ type: "quanta_wa_go_to", id: "room_7" });
    send({ type: "quanta_wa_go_to", uuid: "u-1" });
    expect(go.mock.calls).toEqual([[{ id: "room_7", uuid: undefined }], [{ id: undefined, uuid: "u-1" }]]);
    go.mockImplementationOnce(() => {
        throw new Error("no scene");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => send({ type: "quanta_wa_go_to", id: "room_8" })).not.toThrow();
    error.mockRestore();
    stop();
});

it("tells a host whether sound from a student on air comes through", () => {
    vi.useFakeTimers();
    const parent = { postMessage: vi.fn() };
    const events = new EventTarget();
    vi.stubGlobal("window", {
        parent,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
    });
    vi.stubGlobal("document", {
        referrer: "https://school.quanta.world/eng/courses/c",
        documentElement: { classList: { toggle: () => {}, remove: () => {} } },
    });
    (raisedHandSectionsStore as unknown as ReturnType<typeof writable<RaisedHandSection[]>>).set([]);
    const speaking = writable(false);
    const streamable = writable({ showVoiceIndicator: speaking, volumeStore: undefined });
    const live = {
        mySpaceUserId: "t",
        usersStore: writable(
            new Map([
                ["s1", { spaceUserId: "s1", name: "Alisa", tags: [], megaphoneState: true, microphoneState: true }],
            ]),
        ),
        videoStreamStore: writable(new Map([["s1", { streamable }]])),
        isStreamingAudioStore: writable(false),
        state: { speakingUsersStore: writable([]) },
    };
    (currentLiveStreamingSpaceStore as unknown as ReturnType<typeof writable<unknown>>).set(live);
    userIsAdminStore.set(true);
    const stop = startHandsBridge();
    const last = () => parent.postMessage.mock.lastCall?.[0].speaking;
    expect(last()).toEqual([{ id: "s1", name: "Alisa", talking: false, quiet: false }]);
    speaking.set(true);
    expect(last()).toEqual([{ id: "s1", name: "Alisa", talking: true, quiet: false }]);
    speaking.set(false);
    vi.advanceTimersByTime(6000);
    expect(last()).toEqual([{ id: "s1", name: "Alisa", talking: false, quiet: true }]);
    stop();
    (currentLiveStreamingSpaceStore as unknown as ReturnType<typeof writable<unknown>>).set(undefined);
    vi.useRealTimers();
});
