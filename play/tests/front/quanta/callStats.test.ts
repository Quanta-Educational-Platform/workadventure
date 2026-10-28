import { afterEach, describe, expect, it, vi } from "vitest";
import { sampleCallStats, startCallStats } from "../../../src/front/quanta/callStats";
import { peerConnections } from "../../../src/front/quanta/peerConnections";
import { createVideoExpectationTracker } from "../../../src/front/quanta/videoExpectations";

vi.mock("../../../src/front/Stores/ToastStoreSingleton", async () => {
    const { writable } = await import("svelte/store");
    return { toastStore: writable(new Map()) };
});
vi.mock("../../../src/front/quanta/peerConnections", () => ({ peerConnections: new Set() }));

function connection() {
    const getStats = vi.fn<() => Promise<RTCStatsReport>>();
    const pc = { connectionState: "connected", getStats } as unknown as RTCPeerConnection;
    const report = (received: number, at: number, extra: Record<string, unknown> = {}) => {
        const rows = new Map<string, RTCStats>([
            [
                "inbound",
                {
                    id: "inbound",
                    type: "inbound-rtp",
                    timestamp: at,
                    kind: "video",
                    ssrc: 1,
                    trackIdentifier: "track",
                    packetsReceived: received,
                    packetsLost: 0,
                    framesDecoded: received / 2,
                    freezeCount: 0,
                    totalFreezesDuration: 0,
                    ...extra,
                } as RTCStats,
            ],
        ]);
        getStats.mockResolvedValue(rows);
    };
    return { pc, getStats, report };
}

afterEach(() => {
    peerConnections.clear();
    vi.useRealTimers();
});

describe("call statistics", () => {
    it("diffs independent streams and excludes identity changes and counter resets", async () => {
        const { pc, report } = connection();
        const pcs = new Set([pc]),
            previous: Parameters<typeof sampleCallStats>[1] = new WeakMap();
        report(100, 1000);
        await sampleCallStats(pcs, previous);
        report(300, 11000, { packetsLost: 10, freezeCount: 2, totalFreezesDuration: 1 });
        expect(await sampleCallStats(pcs, previous)).toMatchObject({
            downLossPct: 4.8,
            videoFps: 10,
            videoFreezeCount: 2,
            videoFreezeDurationMs: 1000,
        });
        report(600, 21000, { ssrc: 2, packetsLost: 100, freezeCount: 20, totalFreezesDuration: 10 });
        expect(await sampleCallStats(pcs, previous)).toMatchObject({
            downLossPct: 0,
            videoStreams: 0,
            videoFreezeCount: 0,
        });
        report(610, 31000, { ssrc: 2, packetsLost: 100, freezeCount: 0 });
        expect(await sampleCallStats(pcs, previous)).toMatchObject({ videoStreams: 0, videoFreezeCount: 0 });
    });

    it("does not rewind a baseline on duplicate or stale timestamps", async () => {
        const { pc, report } = connection();
        const pcs = new Set([pc]),
            previous: Parameters<typeof sampleCallStats>[1] = new WeakMap();
        report(100, 1000);
        await sampleCallStats(pcs, previous);
        report(500, 1000);
        expect(await sampleCallStats(pcs, previous)).toMatchObject({ videoStreams: 0 });
        report(300, 11000);
        expect(await sampleCallStats(pcs, previous)).toMatchObject({ videoFps: 10 });
    });

    it("uses successful connections even when another peer closes during getStats", async () => {
        const good = connection(),
            bad = connection();
        bad.getStats.mockRejectedValue(new Error("closed"));
        const pcs = new Set([good.pc, bad.pc]),
            previous: Parameters<typeof sampleCallStats>[1] = new WeakMap();
        good.report(100, 1000);
        await sampleCallStats(pcs, previous);
        good.report(300, 11000);
        expect(await sampleCallStats(pcs, previous)).toMatchObject({ videoFps: 10 });
    });

    it("does not count intentional pauses or their first resumed window as freezes", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const { pc, report } = connection();
        const tracker = createVideoExpectationTracker();
        const pcs = new Set([pc]),
            previous: Parameters<typeof sampleCallStats>[1] = new WeakMap();
        tracker.update("track", undefined, Date.now());
        report(100, 1000);
        await sampleCallStats(pcs, previous);
        vi.advanceTimersByTime(20000);
        tracker.update("track", 0, Date.now());
        report(120, 21000, { freezeCount: 1, totalFreezesDuration: 15 });
        expect(await sampleCallStats(pcs, previous)).toMatchObject({ videoStreams: 0, videoFreezeCount: 0 });
        vi.advanceTimersByTime(20000);
        tracker.update("track", undefined, Date.now());
        report(600, 41000, { freezeCount: 2, totalFreezesDuration: 30 });
        expect(await sampleCallStats(pcs, previous)).toMatchObject({ videoStreams: 0, videoFreezeCount: 0 });
        vi.advanceTimersByTime(20000);
        report(1000, 61000, { freezeCount: 2, totalFreezesDuration: 30 });
        expect(await sampleCallStats(pcs, previous)).toMatchObject({ videoStreams: 1, videoFreezeCount: 0 });
        tracker.clear();
    });

    it("reports audio concealment deltas and rejects a restarted concealment counter", async () => {
        const { pc, report } = connection();
        const pcs = new Set([pc]),
            previous: Parameters<typeof sampleCallStats>[1] = new WeakMap();
        report(100, 1000, {
            kind: "audio",
            framesDecoded: undefined,
            totalSamplesReceived: 10000,
            concealedSamples: 100,
        });
        await sampleCallStats(pcs, previous);
        report(300, 11000, {
            kind: "audio",
            framesDecoded: undefined,
            totalSamplesReceived: 20000,
            concealedSamples: 300,
        });
        expect(await sampleCallStats(pcs, previous)).toMatchObject({ audioConcealedRatio: 0.02 });
        report(500, 21000, {
            kind: "audio",
            framesDecoded: undefined,
            totalSamplesReceived: 30000,
            concealedSamples: 0,
        });
        expect((await sampleCallStats(pcs, previous))?.audioConcealedRatio).toBeUndefined();
    });

    it("excludes a short deliberate pause entirely between two active samples", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        const { pc, report } = connection();
        const tracker = createVideoExpectationTracker();
        const pcs = new Set([pc]),
            previous: Parameters<typeof sampleCallStats>[1] = new WeakMap();
        tracker.update("track", undefined, Date.now());
        report(100, 1000);
        await sampleCallStats(pcs, previous);
        vi.advanceTimersByTime(5000);
        tracker.update("track", 0, Date.now());
        vi.advanceTimersByTime(1000);
        tracker.update("track", undefined, Date.now());
        vi.advanceTimersByTime(14000);
        report(500, 21000, { freezeCount: 1, totalFreezesDuration: 1 });
        expect(await sampleCallStats(pcs, previous)).toMatchObject({ videoStreams: 0, videoFreezeCount: 0 });
        vi.advanceTimersByTime(20000);
        report(900, 41000, { freezeCount: 1, totalFreezesDuration: 1 });
        expect(await sampleCallStats(pcs, previous)).toMatchObject({ videoStreams: 1, videoFreezeCount: 0 });
        tracker.clear();
    });

    it("does not overlap slow getStats or post a sample after unsubscribe", async () => {
        vi.useFakeTimers();
        const { pc, getStats } = connection();
        let resolve: ((stats: RTCStatsReport) => void) | undefined;
        getStats.mockReturnValue(
            new Promise((done) => {
                resolve = done;
            }),
        );
        peerConnections.add(pc);
        const post = vi.fn(),
            stop = startCallStats(post);
        await vi.advanceTimersByTimeAsync(60000);
        expect(getStats).toHaveBeenCalledTimes(1);
        stop();
        resolve?.(new Map([["outbound", { id: "outbound", type: "outbound-rtp", timestamp: 1 }]]));
        await vi.advanceTimersByTimeAsync(0);
        expect(post).not.toHaveBeenCalled();
    });
});
