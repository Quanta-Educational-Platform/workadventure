// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../Enum/EnvironmentVariable", () => ({ QUANTA_URL: "https://quanta.test" }));
import { startModerationBridge } from "./moderationBridge";
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
