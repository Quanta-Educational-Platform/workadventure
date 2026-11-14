import { afterEach, expect, it, vi } from "vitest";
import { RoomChatOutbox } from "./roomChatOutbox";

afterEach(() => vi.useRealTimers());

function outbox() {
    const sent: { op: string; body?: string; ref: string }[] = [];
    const held = vi.fn();
    const box = new RoomChatOutbox((command) => sent.push(command as (typeof sent)[number]), held);
    return { box, sent, held };
}

it("sends a refused message again after the wait, in order with what was typed meanwhile", () => {
    vi.useFakeTimers();
    const { box, sent, held } = outbox();
    box.send({ op: "send", body: "tenth" });
    box.send({ op: "send", body: "eleventh" });
    expect(sent.map((command) => command.body)).toEqual(["tenth", "eleventh"]);
    expect(box.answer({ quanta: 1, append: {}, ref: sent[0].ref })).toBe(true);
    expect(box.answer({ quanta: 1, retryAfterMs: 4000, ref: sent[1].ref })).toBe(true);
    expect(held).toHaveBeenCalledWith(4);
    box.send({ op: "send", body: "twelfth" });
    expect(sent).toHaveLength(2);
    vi.advanceTimersByTime(3999);
    expect(sent).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sent.slice(2).map((command) => command.body)).toEqual(["eleventh", "twelfth"]);
    expect(sent[2].ref).toBe(sent[1].ref);
});

it("forgets a message once it landed or was refused for good, and ignores other answers", () => {
    vi.useFakeTimers();
    const { box, sent, held } = outbox();
    box.send({ op: "send", body: "muted" });
    expect(box.answer({ quanta: 1, notice: "Your chat is muted by the teacher.", ref: sent[0].ref })).toBe(true);
    expect(box.answer({ quanta: 1, retryAfterMs: 1000, ref: sent[0].ref })).toBe(false);
    expect(box.answer({ quanta: 1, retryAfterMs: 5000 })).toBe(false);
    expect(box.answer({ quanta: 1, append: {} })).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(sent).toHaveLength(1);
    expect(held).not.toHaveBeenCalled();
});

it("sends nothing after it is disposed", () => {
    vi.useFakeTimers();
    const { box, sent } = outbox();
    box.send({ op: "edit", id: "1", body: "fixed" });
    box.answer({ quanta: 1, retryAfterMs: 2000, ref: sent[0].ref });
    box.dispose();
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(1);
});
