import { afterEach, describe, expect, it, vi } from "vitest";
import { writable } from "svelte/store";
import {
    VideoQualityLimitationReason,
    VideoQualityStreamCategory,
    VideoQualityStreamDirection,
    VideoQualityTransportType,
} from "@workadventure/messages";
import type { WebRtcSenderStats, WebRtcStats } from "../../../src/front/Components/Video/WebRtcStats";
import {
    subscribeToOutboundVideoQualityAnalytics,
    subscribeToVideoQualityAnalytics,
} from "../../../src/front/WebRtc/VideoQualityAnalytics";

const stats: WebRtcStats = {
    source: "P2P",
    frameWidth: 1280,
    frameHeight: 720,
    jitter: 0.07,
    bandwidth: 180000,
    fps: 24.5,
};

const context = {
    streamId: "stream-id",
    streamCategory: "video" as const,
    transportType: "P2P" as const,
    remoteSpaceUserId: "remote-space-user",
    spaceName: "world.space",
};

afterEach(() => {
    vi.useRealTimers();
    window.capabilities = {};
});

describe("subscribeToVideoQualityAnalytics", () => {
    it("samples normal streams every 30 seconds, including an immediate first sample at epoch zero", () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        window.capabilities = { "api/analytics/events-batch": "v1" };
        const store = writable(stats),
            send = vi.fn();
        const stop = subscribeToVideoQualityAnalytics(store, context, send);
        for (let second = 1; second <= 90; second++) {
            vi.advanceTimersByTime(1000);
            store.set({ ...stats });
        }
        expect(send.mock.calls.map(([r]) => r.samples[0].clientEventTimeMs)).toEqual([0, 30000, 60000, 90000]);
        expect(send.mock.calls.map(([r]) => r.samples[0].sampleSeq)).toEqual([0, 1, 2, 3]);
        stop();
    });

    it("bounds a persistent incident to 30 seconds of 5-second samples and a 120-second cooldown", () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        window.capabilities = { "api/analytics/events-batch": "v1" };
        const store = writable(stats),
            send = vi.fn();
        const stop = subscribeToVideoQualityAnalytics(store, context, send);
        for (let second = 1; second <= 180; second++) {
            vi.advanceTimersByTime(1000);
            store.set({ ...stats, fps: 0, expectedFps: 30 });
        }
        expect(send.mock.calls.map(([r]) => r.samples[0].clientEventTimeMs)).toEqual([
            0, 5000, 10000, 15000, 20000, 25000, 30000, 60000, 90000, 120000, 125000, 130000, 135000, 140000, 145000,
            150000, 180000,
        ]);
        stop();
    });

    it("does not treat a deliberately paused stream's resume counters as a new incident", () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        window.capabilities = { "api/analytics/events-batch": "v1" };
        const playback = {
            statsId: "inbound",
            timestampMs: 0,
            framesDecoded: 0,
            freezeCount: 0,
            totalFreezesDuration: 0,
        };
        const store = writable<WebRtcStats>({ ...stats, playback }),
            send = vi.fn();
        const stop = subscribeToVideoQualityAnalytics(store, context, send);
        for (let second = 1; second <= 60; second++) {
            vi.advanceTimersByTime(1000);
            store.set({
                ...stats,
                fps: second <= 6 ? 0 : 30,
                expectedFps: second <= 5 ? 0 : 30,
                playback: {
                    ...playback,
                    timestampMs: second * 1000,
                    framesDecoded: second * 30,
                    freezeCount: second > 5 ? 1 : 0,
                    totalFreezesDuration: second > 5 ? 5 : 0,
                },
            });
        }
        expect(send.mock.calls.map(([r]) => r.samples[0].clientEventTimeMs)).toEqual([0, 30000, 60000]);
        expect(send.mock.calls[1][0].samples[0].windowSeconds).toBeUndefined();
        expect(send.mock.calls[2][0].samples[0]).toMatchObject({ windowSeconds: 30, freezeCount: 0 });
        stop();
    });

    it("does not open incidents for a static screen share or replaced stream counters", () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        window.capabilities = { "api/analytics/events-batch": "v1" };
        const store = writable<WebRtcStats | undefined>(stats),
            send = vi.fn();
        const stop = subscribeToVideoQualityAnalytics(store, { ...context, streamCategory: "screenSharing" }, send);
        for (let second = 1; second <= 60; second++) {
            vi.advanceTimersByTime(1000);
            if (second === 10) store.set(undefined);
            store.set({
                ...stats,
                fps: 1,
                playback: {
                    statsId: second < 10 ? "old" : "new",
                    timestampMs: second * 1000,
                    framesDecoded: second,
                    freezeCount: second,
                },
            });
        }
        expect(send.mock.calls.map(([r]) => r.samples[0].clientEventTimeMs)).toEqual([0, 30000, 60000]);
        stop();
    });
    it("does not emit reports without the generic analytics capability", () => {
        window.capabilities = {};
        const sendReport = vi.fn();

        subscribeToVideoQualityAnalytics(writable(stats), context, sendReport);

        expect(sendReport).not.toHaveBeenCalled();
    });

    it("emits reports when the generic analytics capability is present", () => {
        window.capabilities = {
            "api/analytics/events-batch": "v1",
        };
        const sendReport = vi.fn();

        subscribeToVideoQualityAnalytics(writable(stats), context, sendReport);

        expect(sendReport).toHaveBeenCalledWith({
            samples: [
                expect.objectContaining({
                    streamId: "stream-id",
                    streamCategory: VideoQualityStreamCategory.VIDEO_QUALITY_STREAM_CATEGORY_VIDEO,
                    transportType: VideoQualityTransportType.VIDEO_QUALITY_TRANSPORT_TYPE_P2P,
                    remoteSpaceUserId: "remote-space-user",
                    spaceName: "world.space",
                    direction: VideoQualityStreamDirection.VIDEO_QUALITY_STREAM_DIRECTION_INBOUND,
                }),
            ],
        });
    });

    it("reports what the browser counted between two samples", () => {
        window.capabilities = {
            "api/analytics/events-batch": "v1",
        };
        vi.useFakeTimers();
        try {
            const sendReport = vi.fn();
            const playback = {
                statsId: "IT01V1",
                timestampMs: 1_000,
                framesDecoded: 100,
                freezeCount: 0,
                totalFreezesDuration: 0,
            };
            const store = writable<WebRtcStats>({ ...stats, playback });
            subscribeToVideoQualityAnalytics(store, context, sendReport);

            vi.advanceTimersByTime(5_000);
            store.set({
                ...stats,
                roundTripTimeMs: 120,
                playback: {
                    ...playback,
                    timestampMs: 6_000,
                    framesDecoded: 220,
                    freezeCount: 1,
                    totalFreezesDuration: 0.5,
                },
            });

            // The first sample has no previous one to diff against
            expect(sendReport.mock.calls[0][0].samples[0].windowSeconds).toBeUndefined();
            expect(sendReport.mock.calls[1][0].samples[0]).toMatchObject({
                windowSeconds: 5,
                framesDecoded: 120,
                freezeCount: 1,
                freezeSeconds: 0.5,
                roundTripTimeMs: 120,
            });
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("subscribeToOutboundVideoQualityAnalytics", () => {
    const senderStats: WebRtcSenderStats = {
        source: "Livekit",
        frameWidth: 1920,
        frameHeight: 1080,
        bandwidth: 300000,
        fps: 28,
        mimeType: "video/AV1",
        qualityLimitationReason: "cpu",
        encoderImplementation: "libaom",
        captureFps: 24,
        captureTargetFps: 30,
        encodeMsPerFrame: 12.5,
        cpuLimitedRatio: 0.4,
        bandwidthLimitedRatio: 0,
        uploadRoundTripTimeMs: 180,
        uploadLossRatio: 0.04,
        availableOutgoingBitrate: 1_200_000,
    };

    it("emits outbound samples carrying the encoder health", () => {
        window.capabilities = {
            "api/analytics/events-batch": "v1",
        };
        const sendReport = vi.fn();

        subscribeToOutboundVideoQualityAnalytics(
            writable(senderStats),
            {
                ...context,
                transportType: "Livekit",
                remoteSpaceUserId: "",
                livekitServerUrl: "wss://livekit.test",
                getLivekitRegion: () => "ojohannesburg1a",
            },
            sendReport,
        );

        expect(sendReport).toHaveBeenCalledWith({
            samples: [
                expect.objectContaining({
                    direction: VideoQualityStreamDirection.VIDEO_QUALITY_STREAM_DIRECTION_OUTBOUND,
                    transportType: VideoQualityTransportType.VIDEO_QUALITY_TRANSPORT_TYPE_LIVEKIT,
                    remoteSpaceUserId: "",
                    livekitServerUrl: "wss://livekit.test",
                    livekitRegion: "ojohannesburg1a",
                    fps: 28,
                    jitter: 0,
                    bandwidthBytesPerSecond: 300000,
                    frameWidth: 1920,
                    frameHeight: 1080,
                    mimeType: "video/AV1",
                    qualityLimitationReason: VideoQualityLimitationReason.VIDEO_QUALITY_LIMITATION_REASON_CPU,
                    encoderImplementation: "libaom",
                    captureFps: 24,
                    captureTargetFps: 30,
                    encodeMsPerFrame: 12.5,
                    cpuLimitedRatio: 0.4,
                    bandwidthLimitedRatio: 0,
                    uploadRoundTripTimeMs: 180,
                    uploadLossRatio: 0.04,
                    availableOutgoingBitrate: 1_200_000,
                }),
            ],
        });
    });

    it("skips samples of a paused encoder", () => {
        window.capabilities = {
            "api/analytics/events-batch": "v1",
        };
        const sendReport = vi.fn();

        subscribeToOutboundVideoQualityAnalytics(
            writable({ ...senderStats, fps: 0, bandwidth: 0, qualityLimitationReason: "none" }),
            context,
            sendReport,
        );

        expect(sendReport).not.toHaveBeenCalled();
    });

    it("does not create incidents from disabled layers or invalid sender samples", () => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        window.capabilities = { "api/analytics/events-batch": "v1" };
        const store = writable(senderStats),
            send = vi.fn();
        const stop = subscribeToOutboundVideoQualityAnalytics(store, context, send);
        vi.advanceTimersByTime(5000);
        store.set({ ...senderStats, fps: 0, activeLayers: 0, uploadLossRatio: 1 });
        vi.advanceTimersByTime(5000);
        store.set({ ...senderStats, fps: Number.NaN, uploadLossRatio: 1 });
        vi.advanceTimersByTime(5000);
        store.set(senderStats);
        expect(send).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(15000);
        store.set(senderStats);
        expect(send).toHaveBeenCalledTimes(2);
        stop();
    });
});
