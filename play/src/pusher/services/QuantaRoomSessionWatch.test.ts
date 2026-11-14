import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    ROOM_SESSION_CHECK_MAX_MS,
    ROOM_SESSION_CHECK_MIN_MS,
    roomSessionOfToken,
    watchRoomSession,
} from "./QuantaRoomSessionWatch";

const HOUR = 60 * 60_000;
const session = (hours = 12) => ({ token: "qrs1.a.b", expiresAtMs: Date.now() + hours * HOUR });

beforeEach(() => {
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe("which connections are watched", () => {
    it("a sign-in code's token, with its expiry", () => {
        expect(roomSessionOfToken({ quantaSession: true, accessToken: "qrs1.a.b", exp: 100 })).toEqual({
            token: "qrs1.a.b",
            expiresAtMs: 100_000,
        });
    });

    it("no other token, nor an anonymous connection", () => {
        expect(roomSessionOfToken({ accessToken: "oauth-token", exp: 100 })).toBeUndefined();
        expect(roomSessionOfToken({ quantaSession: false, accessToken: "oauth-token" })).toBeUndefined();
        expect(roomSessionOfToken({ quantaSession: true })).toBeUndefined();
        expect(roomSessionOfToken(null)).toBeUndefined();
    });
});

describe("watching a connection", () => {
    it("asks nothing at the start, then every 4 to 6 minutes", async () => {
        const isLive = vi.fn(() => Promise.resolve<boolean | undefined>(true));
        const stop = watchRoomSession({ session: session(), isLive, onEnded: vi.fn(), random: () => 0.5 });
        expect(isLive).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(ROOM_SESSION_CHECK_MIN_MS);
        expect(isLive).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(ROOM_SESSION_CHECK_MAX_MS - ROOM_SESSION_CHECK_MIN_MS);
        expect(isLive).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(5 * 60_000);
        expect(isLive).toHaveBeenCalledTimes(2);
        stop();
    });

    it("spreads a class that joined together across the window", async () => {
        const when: number[] = [];
        const start = Date.now();
        const stops = Array.from({ length: 100 }, (_, i) =>
            watchRoomSession({
                session: session(),
                isLive: () => {
                    when.push(Date.now() - start);
                    return Promise.resolve(true);
                },
                onEnded: vi.fn(),
                random: () => i / 100,
            }),
        );
        await vi.advanceTimersByTimeAsync(ROOM_SESSION_CHECK_MAX_MS);
        expect(when.length).toBe(100);
        expect(Math.min(...when)).toBe(ROOM_SESSION_CHECK_MIN_MS);
        expect(Math.max(...when)).toBeGreaterThan(ROOM_SESSION_CHECK_MAX_MS - 5_000);
        stops.forEach((stop) => stop());
    });

    it("ends on a clear refusal, by the slowest check at the latest", async () => {
        const onEnded = vi.fn();
        watchRoomSession({ session: session(), isLive: () => Promise.resolve(false), onEnded, random: () => 1 });
        await vi.advanceTimersByTimeAsync(ROOM_SESSION_CHECK_MAX_MS - 1);
        expect(onEnded).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(onEnded).toHaveBeenCalledWith("refused");
    });

    it("never ends on an outage, through any number of checks", async () => {
        const onEnded = vi.fn();
        const isLive = vi
            .fn<() => Promise<boolean | undefined>>()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error("network"))
            .mockResolvedValueOnce(undefined)
            .mockResolvedValue(true);
        const stop = watchRoomSession({ session: session(), isLive, onEnded });
        await vi.advanceTimersByTimeAsync(4 * ROOM_SESSION_CHECK_MAX_MS);
        expect(isLive.mock.calls.length).toBeGreaterThanOrEqual(4);
        expect(onEnded).not.toHaveBeenCalled();
        stop();
    });

    it("ends after an outage once Quanta can say no", async () => {
        const onEnded = vi.fn();
        const isLive = vi
            .fn<() => Promise<boolean | undefined>>()
            .mockResolvedValueOnce(undefined)
            .mockResolvedValue(false);
        watchRoomSession({ session: session(), isLive, onEnded, random: () => 0 });
        await vi.advanceTimersByTimeAsync(ROOM_SESSION_CHECK_MIN_MS);
        expect(onEnded).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(ROOM_SESSION_CHECK_MIN_MS);
        expect(onEnded).toHaveBeenCalledWith("refused");
    });

    it("ends at the token's expiry to the moment, even if every check says yes or nothing", async () => {
        const onEnded = vi.fn();
        const expiresAtMs = Date.now() + 7 * 60_000;
        watchRoomSession({ session: { token: "t", expiresAtMs }, isLive: () => Promise.resolve(undefined), onEnded, random: () => 0.5 });
        await vi.advanceTimersByTimeAsync(7 * 60_000 - 1);
        expect(onEnded).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(onEnded).toHaveBeenCalledWith("expired");
    });

    it("stops asking once stopped, and drops an answer that arrives after", async () => {
        const onEnded = vi.fn();
        let answer: (live: boolean) => void = () => undefined;
        const isLive = vi.fn(
            () =>
                new Promise<boolean>((resolve) => {
                    answer = resolve;
                }),
        );
        const stop = watchRoomSession({ session: session(), isLive, onEnded, random: () => 0 });
        await vi.advanceTimersByTimeAsync(ROOM_SESSION_CHECK_MIN_MS);
        expect(isLive).toHaveBeenCalledTimes(1);
        stop();
        answer(false);
        await vi.advanceTimersByTimeAsync(ROOM_SESSION_CHECK_MAX_MS);
        expect(onEnded).not.toHaveBeenCalled();
        expect(isLive).toHaveBeenCalledTimes(1);
    });
});
