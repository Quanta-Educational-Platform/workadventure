// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";
vi.mock("../Enum/EnvironmentVariable", () => ({ QUANTA_URL: "https://quanta.test", QUANTA_UI: true }));
vi.mock("./studentView", () => ({
    studentViewStore: writable(false),
    moderationInView: (canModerate: boolean, studentView: boolean) => canModerate && !studentView,
}));
import { roomModerationStore, startModerationBridge } from "./moderationBridge";
import { studentViewStore } from "./studentView";
afterEach(() => vi.restoreAllMocks());
it("accepts only the parent origin, requires staff state and removes listeners on teardown", () => {
    const send = vi.fn();
    const controller = new AbortController();
    const update = startModerationBridge(send, controller.signal);
    const dispatch = (origin: string, source: Window | null = window.parent) =>
        window.dispatchEvent(
            new MessageEvent("message", {
                source,
                origin,
                data: { type: "quanta_wa_moderate", action: "mute_chat", id: "student" },
            }),
        );
    dispatch("https://quanta.test");
    expect(send).not.toHaveBeenCalled();
    update({ quanta: 1, self: "staff", canModerate: true, messages: [], people: [], muted: [], removed: [] });
    dispatch("https://evil.test");
    dispatch("https://quanta.test", null);
    expect(send).not.toHaveBeenCalled();
    dispatch("https://quanta.test");
    expect(send).toHaveBeenCalledWith({ op: "moderate", action: "mute_chat", id: "student" });
    controller.abort();
    send.mockClear();
    dispatch("https://quanta.test");
    expect(send).not.toHaveBeenCalled();
});

it("applies append, delete, state and notice deltas without losing history or changing the parent contract", async () => {
    const { applyRoomUpdate } = await import("./moderationBridge");
    let state = applyRoomUpdate(undefined, {
        quanta: 1,
        self: "me",
        canModerate: false,
        messages: [],
        people: [],
        muted: [],
        removed: [],
    });
    for (let i = 0; i < 110; i++)
        state = applyRoomUpdate(state, {
            quanta: 1,
            append: { id: String(i), sender: "sender", name: "username", body: String(i), at: i },
        });
    expect(state?.messages).toHaveLength(100);
    expect(state?.messages[0].id).toBe("10");
    state = applyRoomUpdate(state, { quanta: 1, deleted: "10" });
    expect(state?.messages[0].id).toBe("11");
    state = applyRoomUpdate(state, { quanta: 1, notice: "Muted by teacher" });
    expect(state?.messages).toHaveLength(99);
    state = applyRoomUpdate(state, {
        quanta: 1,
        state: { self: "me", canModerate: false, people: [], muted: ["me"], removed: [] },
    });
    expect(state?.muted).toEqual(["me"]);
    expect(state?.messages).toHaveLength(99);
});
it("a muted person's chat says so through its composer, not a notice in the conversation", async () => {
    const { roomChatStatus } = await import("./moderationBridge");
    const snapshot = {
        quanta: 1 as const,
        self: "me",
        canModerate: false,
        messages: [],
        people: [],
        removed: [],
        notice: "Your chat is muted by the teacher.",
    };
    expect(roomChatStatus({ ...snapshot, muted: ["me"] })).toEqual({ muted: true, notice: undefined });
    expect(roomChatStatus({ ...snapshot, muted: ["someone"], notice: "Message too large." })).toEqual({
        muted: false,
        notice: "Message too large.",
    });
    expect(roomChatStatus({ ...snapshot, muted: [], notice: undefined })).toEqual({ muted: false, notice: undefined });
});
it("retries throttled initial history requests and cancels the retry on leave", async () => {
    vi.useFakeTimers();
    try {
        const { roomSyncRetry } = await import("./moderationBridge");
        const send = vi.fn(),
            abort = new AbortController();
        const retry = roomSyncRetry(send, abort.signal);
        retry({ retryAfterMs: 5000 });
        retry({ retryAfterMs: 5000 });
        vi.advanceTimersByTime(5000);
        expect(send).toHaveBeenCalledOnce();
        retry({ retryAfterMs: 10000 });
        abort.abort();
        vi.advanceTimersByTime(10000);
        expect(send).toHaveBeenCalledOnce();
    } finally {
        vi.useRealTimers();
    }
});
it("serves the tile's person menu: the room's state, its commands, reports and whether the platform lets draw", async () => {
    const { moderatePerson, platformLetsDrawStore, roomModerationStore } = await import("./moderationBridge");
    const { get } = await import("svelte/store");
    const send = vi.fn();
    const report = vi.fn();
    const controller = new AbortController();
    const update = startModerationBridge(send, controller.signal, report);
    const fromPlatform = (data: object) =>
        window.dispatchEvent(
            new MessageEvent("message", { source: window.parent, origin: "https://quanta.test", data }),
        );
    const state = { self: "me", people: [{ id: "student", name: "S", staff: false }], muted: [], removed: [] };

    update({ quanta: 1, messages: [], canModerate: false, ...state });
    moderatePerson("mute_camera", "student");
    expect(send).not.toHaveBeenCalled();
    fromPlatform({ type: "quanta_wa_report", id: "student", name: "S" });
    expect(report).toHaveBeenCalledWith("student", "S");

    update({ quanta: 1, messages: [], canModerate: true, ...state });
    expect(get(roomModerationStore)).toEqual({ canModerate: true, ...state });
    moderatePerson("mute_camera", "student");
    expect(send).toHaveBeenCalledWith({ op: "moderate", action: "mute_camera", id: "student" });
    // Staff don't report: they remove.
    report.mockClear();
    fromPlatform({ type: "quanta_wa_report", id: "student", name: "S" });
    expect(report).not.toHaveBeenCalled();

    fromPlatform({ type: "quanta_wa_person_menu", letDraw: true });
    expect(get(platformLetsDrawStore)).toBe(true);
    fromPlatform({ type: "quanta_wa_person_menu", letDraw: false });
    expect(get(platformLetsDrawStore)).toBe(false);

    controller.abort();
    expect(get(roomModerationStore)).toBeUndefined();
    send.mockClear();
    moderatePerson("mute_mic", "student");
    expect(send).not.toHaveBeenCalled();
});

it("replaces an edited message in place", async () => {
    const { applyRoomUpdate } = await import("./moderationBridge");
    const entry = (id: string, body: string) => ({ id, sender: "me", name: "me", body, at: Number(id) });
    let state = applyRoomUpdate(undefined, {
        quanta: 1,
        self: "me",
        canModerate: false,
        messages: [entry("1", "a"), entry("2", "b")],
        people: [],
        muted: [],
        removed: [],
        notice: "old notice",
    });
    state = applyRoomUpdate(state, { quanta: 1, edited: { ...entry("1", "a, edited"), edited: true } });
    expect(state?.messages.map((message) => message.body)).toEqual(["a, edited", "b"]);
    expect(state?.messages[0].edited).toBe(true);
    expect(state?.notice).toBeUndefined();
});

it("offers staff in student view no moderation, and gives it back", () => {
    const controller = new AbortController();
    const update = startModerationBridge(vi.fn(), controller.signal);
    update({ quanta: 1, self: "staff", canModerate: true, messages: [], people: [], muted: [], removed: [] });
    expect(get(roomModerationStore)?.canModerate).toBe(true);
    const view = studentViewStore as unknown as { set: (on: boolean) => void };
    view.set(true);
    expect(get(roomModerationStore)?.canModerate).toBe(false);
    view.set(false);
    expect(get(roomModerationStore)?.canModerate).toBe(true);
    controller.abort();
});
