import { describe, expect, it, vi } from "vitest";
import { readable, writable } from "svelte/store";
import { watchMediaStates } from "./mediaStateEvents";

describe("media capture activity", () => {
    it("does not start media subscriptions until the room is entered, and releases them on leaving", () => {
        const started = vi.fn();
        const released = vi.fn();
        const inRoom = writable(false);
        const source = readable(false, () => {
            started();
            return released;
        });
        const report = vi.fn();
        const stop = watchMediaStates(inRoom, { microphone: source, camera: source, screenshare: source }, report);
        expect(started).not.toHaveBeenCalled();
        inRoom.set(true);
        expect(started).toHaveBeenCalledTimes(1);
        expect(report.mock.calls).toEqual([
            ["microphone", false],
            ["camera", false],
            ["screenshare", false],
        ]);
        inRoom.set(false);
        expect(released).toHaveBeenCalledTimes(1);
        stop();
    });

    it("records confirmed transitions including browser-ended shares, without repeating unchanged values", () => {
        const inRoom = writable(true);
        const mic = writable(false);
        const camera = writable(false);
        const share = writable(false);
        const report = vi.fn();
        const stop = watchMediaStates(inRoom, { microphone: mic, camera, screenshare: share }, report);
        report.mockClear();
        mic.set(true);
        mic.set(true);
        mic.set(false);
        camera.set(true);
        camera.set(false);
        share.set(true);
        share.set(false);
        expect(report.mock.calls).toEqual([
            ["microphone", true],
            ["microphone", false],
            ["camera", true],
            ["camera", false],
            ["screenshare", true],
            ["screenshare", false],
        ]);
        stop();
        mic.set(true);
        expect(report).toHaveBeenCalledTimes(6);
    });
});
