import axios, { AxiosError, AxiosHeaders } from "axios";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/pusher/enums/EnvironmentVariable", () => import("./mocks/pusherEnvironmentVariableMock"));

import { adminApi } from "../../src/pusher/services/AdminApi";

describe("AdminApi.fetchMapDetails", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("never hands the world's third-party secrets on", async () => {
        vi.spyOn(axios, "get").mockResolvedValue({
            status: 200,
            data: {
                mapUrl: "http://maps.test/map.json",
                group: null,
                thirdParty: {
                    jitsi: { url: "jitsi.test", iss: "iss", secret: "jitsi-secret" },
                    bbb: { url: "https://bbb.test/bigbluebutton/", secret: "bbb-secret" },
                },
            },
        });

        const mapDetails = await adminApi.fetchMapDetails("http://play.test/@/team/world/room");

        expect(mapDetails).toMatchObject({ mapUrl: "http://maps.test/map.json" });
        expect(JSON.stringify(mapDetails)).not.toMatch(/secret/);
    });

    const failure = (status?: number) =>
        new AxiosError(
            "failed",
            status ? "ERR_BAD_RESPONSE" : "ECONNABORTED",
            undefined,
            undefined,
            status
                ? { status, statusText: "", headers: {}, config: { headers: new AxiosHeaders() }, data: "" }
                : undefined,
        );

    it.each([
        ["a timeout", undefined],
        ["a 500", 500],
        ["a 503", 503],
        ["a 429", 429],
    ])("answers %s from Quanta with the self-reloading retry screen", async (_name, status) => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(axios, "get").mockRejectedValue(failure(status));
        const answer = await adminApi.fetchMapDetails("http://play.test/@/team/world/room");
        expect(answer).toMatchObject({ status: "error", type: "retry", canRetryManual: true });
        const wait = (answer as { timeToRetry: number }).timeToRetry;
        expect(wait % 1000).toBe(0);
        expect(wait).toBeGreaterThanOrEqual(10000);
        expect(wait).toBeLessThan(25000);
    });

    it("keeps a 4xx a plain error: retrying would not change the answer", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(axios, "get").mockRejectedValue(failure(403));
        expect(await adminApi.fetchMapDetails("http://play.test/@/team/world/room")).toMatchObject({
            type: "error",
            code: "ROOM_ACCESS_ERROR",
        });
    });

    it("answers a timed-out access check with the retry screen too", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(axios, "get").mockRejectedValue(failure());
        const answer = await adminApi.fetchMemberDataByUuid(
            "user@test",
            undefined,
            "http://play.test/@/team/world/room",
            "1.2.3.4",
            [],
            undefined,
        );
        expect(answer).toMatchObject({ status: "error", type: "retry" });
    });
});

describe("AdminApi.fetchMapDetails deadline", () => {
    afterEach(() => vi.restoreAllMocks());

    it("treats an aborted call (the whole-call deadline) as a retry, not a dead end", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(axios, "get").mockRejectedValue(new axios.CanceledError("aborted"));
        expect(await adminApi.fetchMapDetails("http://play.test/@/team/world/room")).toMatchObject({ type: "retry" });
    });
});

const tick = () =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });

describe("join calls to Quanta", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("run at most 8 at once; the rest wait their turn", async () => {
        const { inJoinCallSlot, joinCallsForTests } = await import("../../src/pusher/services/AdminApi");
        const finish: Array<() => void> = [];
        let peak = 0;
        let running = 0;
        const calls = Array.from({ length: 20 }, (_, i) =>
            inJoinCallSlot(
                () =>
                    new Promise<number>((resolve) => {
                        running++;
                        peak = Math.max(peak, running);
                        finish.push(() => {
                            running--;
                            resolve(i);
                        });
                    }),
            ),
        );
        await tick();
        expect(joinCallsForTests()).toEqual({ running: 8, queued: 12 });
        while (finish.length) {
            finish.shift()!();
            // One at a time, so each release is seen before the next.
            // eslint-disable-next-line no-await-in-loop
            await tick();
        }
        expect((await Promise.all(calls)).sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i));
        expect(peak).toBe(8);
        expect(joinCallsForTests()).toEqual({ running: 0, queued: 0 });
    });

    it("turn a long wait for a slot into the retry screen, and give the slot back", async () => {
        vi.useFakeTimers();
        vi.spyOn(console, "error").mockImplementation(() => {});
        const { inJoinCallSlot, joinCallsForTests } = await import("../../src/pusher/services/AdminApi");
        const hold: Array<() => void> = [];
        const busy = Array.from({ length: 8 }, () =>
            inJoinCallSlot(
                () =>
                    new Promise<void>((r) => {
                        hold.push(r);
                    }),
            ),
        );
        vi.spyOn(axios, "get").mockResolvedValue({ status: 200, data: { mapUrl: "http://maps.test/map.json" } });
        const waiting = adminApi.fetchMapDetails("http://play.test/@/team/world/room");
        await vi.advanceTimersByTimeAsync(15_001);
        expect(await waiting).toMatchObject({ type: "retry" });
        expect(joinCallsForTests()).toEqual({ running: 8, queued: 0 });
        hold.forEach((r) => r());
        await Promise.all(busy);
        expect(joinCallsForTests()).toEqual({ running: 0, queued: 0 });
    });
});
