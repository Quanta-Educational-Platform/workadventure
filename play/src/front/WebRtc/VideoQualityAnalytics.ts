import type { Readable, Unsubscriber } from "svelte/store";
import type { VideoQualityReportMessage, VideoQualitySampleMessage } from "@workadventure/messages";
import {
    VideoQualityLimitationReason,
    VideoQualityRelayProtocol,
    VideoQualityStreamCategory,
    VideoQualityStreamDirection,
    VideoQualityTransportType,
} from "@workadventure/messages";
import type { WebRtcSenderStats, WebRtcStats } from "../Components/Video/WebRtcStats";
import { hasCapability } from "../Connection/Capabilities";
import { diagnosticSessionId } from "../quanta/diagnosticContext";
import { createVideoExpectationTracker } from "../quanta/videoExpectations";
import { VideoPlaybackWindow } from "./VideoPlaybackWindow";

const VIDEO_ANALYTICS_SEND_INTERVAL_MS = 30_000;
const INCIDENT_INTERVAL_MS = 5_000;
const INCIDENT_WINDOW_MS = 30_000;
const INCIDENT_COOLDOWN_MS = 120_000;
const AFTER_PAUSE_MS = 10_000;

export type VideoQualityAnalyticsContext = {
    streamId: string;
    streamCategory: "video" | "screenSharing";
    transportType: "P2P" | "Livekit";
    // Empty for streams sent to a LiveKit server (no single remote user)
    remoteSpaceUserId: string;
    remoteUserUuid?: string;
    spaceName: string;
    connectionId?: string;
    getConnectionId?: () => string | undefined;
    getStreamId?: () => string;
    getMediaTrackId?: () => string | undefined;
    livekitServerUrl?: string;
    // Read at each sample: LiveKit can move the client to another region when it reconnects
    getLivekitRegion?: () => string | undefined;
};

const sessionId = diagnosticSessionId;

/**
 * Reports the quality of a video stream we receive.
 */
export function subscribeToVideoQualityAnalytics(
    statsStore: Readable<WebRtcStats | undefined>,
    context: VideoQualityAnalyticsContext,
    sendReport: (message: VideoQualityReportMessage) => void,
): Unsubscriber {
    let playback = new VideoPlaybackWindow();
    let lastFreezeCount: number | undefined;
    let previousIdentity: string | undefined;
    let lastPausedAt = Number.NEGATIVE_INFINITY;
    const expectation = createVideoExpectationTracker();
    const unsubscribe = subscribeToSamples(
        statsStore,
        context,
        sendReport,
        (stats, base) => {
            // A stream the sender paused on purpose (we do not display it) says nothing about the connection
            if (stats.expectedFps === 0 || !isValidStats(stats)) {
                return undefined;
            }
            return {
                ...base,
                direction: VideoQualityStreamDirection.VIDEO_QUALITY_STREAM_DIRECTION_INBOUND,
                relay: stats.relay,
                relayProtocol: toRelayProtocol(stats.relayProtocol),
                fps: stats.fps,
                fpsStdDev: stats.fpsStdDev,
                jitter: stats.jitter,
                bandwidthBytesPerSecond: stats.bandwidth,
                frameWidth: toUInt32(stats.frameWidth),
                frameHeight: toUInt32(stats.frameHeight),
                mimeType: stats.mimeType,
                roundTripTimeMs: stats.roundTripTimeMs,
                ...playback.take(stats.playback, base.clientEventTimeMs),
            };
        },
        (stats, now) => {
            if (stats) expectation.update(context.getMediaTrackId?.(), stats.expectedFps, now);
            else expectation.clear();
            const identity = stats
                ? JSON.stringify([
                      context.getConnectionId?.() ?? context.connectionId,
                      context.getStreamId?.() ?? context.streamId,
                      stats.playback?.statsId,
                  ])
                : undefined;
            if (identity !== previousIdentity || !stats) {
                playback = new VideoPlaybackWindow();
                lastFreezeCount = undefined;
                previousIdentity = identity;
            }
            if (stats) {
                playback.observe(stats.expectedFps, now);
                if (stats.expectedFps === 0) lastPausedAt = now;
            }
        },
        (stats, now) => {
            const freezes = stats.playback?.freezeCount;
            const newFreeze = freezes !== undefined && lastFreezeCount !== undefined && freezes > lastFreezeCount;
            lastFreezeCount = freezes;
            if (now - lastPausedAt < AFTER_PAUSE_MS) return false;
            const cameraStalled =
                context.streamCategory === "video" && (newFreeze || ((stats.expectedFps ?? 15) >= 10 && stats.fps < 5));
            return cameraStalled || stats.jitter > 0.1;
        },
        (stats) => stats.expectedFps !== 0 && isValidStats(stats),
    );
    return () => {
        unsubscribe();
        expectation.clear();
    };
}

/**
 * Reports the health of the encoder of a video stream we send (camera or screen share): whether the browser is
 * CPU or bandwidth limited, and which encoder it uses.
 */
export function subscribeToOutboundVideoQualityAnalytics(
    statsStore: Readable<WebRtcSenderStats | undefined>,
    context: VideoQualityAnalyticsContext,
    sendReport: (message: VideoQualityReportMessage) => void,
): Unsubscriber {
    return subscribeToSamples(
        statsStore,
        context,
        sendReport,
        (stats, base) => {
            if (!isValidSenderStats(stats)) {
                return undefined;
            }
            return {
                ...base,
                direction: VideoQualityStreamDirection.VIDEO_QUALITY_STREAM_DIRECTION_OUTBOUND,
                fps: stats.fps,
                // The sender has no receive jitter
                jitter: 0,
                bandwidthBytesPerSecond: stats.bandwidth,
                frameWidth: toUInt32(stats.frameWidth),
                frameHeight: toUInt32(stats.frameHeight),
                mimeType: stats.mimeType,
                qualityLimitationReason: toLimitationReason(stats.qualityLimitationReason),
                encoderImplementation: stats.encoderImplementation,
                captureFps: stats.captureFps,
                captureTargetFps: stats.captureTargetFps,
                encodeMsPerFrame: stats.encodeMsPerFrame,
                cpuLimitedRatio: stats.cpuLimitedRatio,
                bandwidthLimitedRatio: stats.bandwidthLimitedRatio,
                uploadRoundTripTimeMs: stats.uploadRoundTripTimeMs,
                uploadLossRatio: stats.uploadLossRatio,
                availableOutgoingBitrate: stats.availableOutgoingBitrate,
            };
        },
        undefined,
        (stats) => (stats.fps < 5 && stats.qualityLimitationReason === "cpu") || (stats.uploadLossRatio ?? 0) >= 0.05,
        isValidSenderStats,
    );
}

type BaseSample = Pick<
    VideoQualitySampleMessage,
    | "clientEventTimeMs"
    | "sampleSeq"
    | "streamId"
    | "connectionId"
    | "sessionId"
    | "remoteUserUuid"
    | "remoteSpaceUserId"
    | "spaceName"
    | "streamCategory"
    | "transportType"
    | "livekitServerUrl"
    | "livekitRegion"
>;

function subscribeToSamples<T>(
    statsStore: Readable<T | undefined>,
    context: VideoQualityAnalyticsContext,
    sendReport: (message: VideoQualityReportMessage) => void,
    buildSample: (stats: T, base: BaseSample) => VideoQualitySampleMessage | undefined,
    // Sees every stats report, including the ones between two samples
    onStats?: (stats: T | undefined, now: number) => void,
    isIncident?: (stats: T, now: number) => boolean,
    shouldSample?: (stats: T) => boolean,
): Unsubscriber {
    // Video quality samples ride the generic analytics pipeline: the pusher turns each
    // one into a `media.video_quality.sample` event. Gating on the retired
    // `api/analytics/video-quality-batch` capability would mean an admin that only
    // advertises the generic endpoint receives no samples at all.
    if (hasCapability("api/analytics/events-batch") !== "v1") {
        return () => {};
    }

    let sampleSeq = 0;
    let lastSentAt: number | undefined;
    let incidentUntil = 0;
    let incidentAllowedAt = 0;

    return statsStore.subscribe((stats) => {
        const now = Date.now();
        onStats?.(stats, now);
        if (!stats || (shouldSample && !shouldSample(stats))) {
            incidentUntil = 0;
            return;
        }
        if (isIncident?.(stats, now) && now >= incidentAllowedAt) {
            incidentUntil = now + INCIDENT_WINDOW_MS;
            incidentAllowedAt = now + INCIDENT_COOLDOWN_MS;
        }
        const interval = now < incidentUntil ? INCIDENT_INTERVAL_MS : VIDEO_ANALYTICS_SEND_INTERVAL_MS;
        if (lastSentAt !== undefined && now - lastSentAt < interval) {
            return;
        }

        const sample = buildSample(stats, {
            clientEventTimeMs: now,
            sampleSeq,
            streamId: context.getStreamId?.() ?? context.streamId,
            connectionId: context.getConnectionId?.() ?? context.connectionId,
            sessionId,
            remoteUserUuid: context.remoteUserUuid,
            remoteSpaceUserId: context.remoteSpaceUserId,
            spaceName: context.spaceName,
            streamCategory: toStreamCategory(context.streamCategory),
            transportType: toTransportType(context.transportType),
            livekitServerUrl: context.livekitServerUrl,
            livekitRegion: context.getLivekitRegion?.(),
        });
        if (!sample) {
            return;
        }

        lastSentAt = now;
        sampleSeq += 1;

        try {
            sendReport({ samples: [sample] });
        } catch (e) {
            console.error("Error while sending video quality analytics report", e);
        }
    });
}

function isValidStats(stats: WebRtcStats): boolean {
    return (
        Number.isFinite(stats.fps) &&
        Number.isFinite(stats.jitter) &&
        Number.isFinite(stats.bandwidth) &&
        Number.isFinite(stats.frameWidth) &&
        Number.isFinite(stats.frameHeight) &&
        (stats.fpsStdDev === undefined || Number.isFinite(stats.fpsStdDev))
    );
}

function isValidSenderStats(stats: WebRtcSenderStats): boolean {
    return (
        Number.isFinite(stats.fps) &&
        Number.isFinite(stats.bandwidth) &&
        Number.isFinite(stats.frameWidth) &&
        Number.isFinite(stats.frameHeight) &&
        (stats.activeLayers === undefined || stats.activeLayers > 0) &&
        // A paused track encodes nothing: not worth a sample, unless the encoder is stalled by a limitation
        (stats.fps > 0 || stats.qualityLimitationReason !== "none")
    );
}

function toStreamCategory(category: VideoQualityAnalyticsContext["streamCategory"]): VideoQualityStreamCategory {
    return category === "screenSharing"
        ? VideoQualityStreamCategory.VIDEO_QUALITY_STREAM_CATEGORY_SCREEN_SHARING
        : VideoQualityStreamCategory.VIDEO_QUALITY_STREAM_CATEGORY_VIDEO;
}

function toTransportType(transportType: VideoQualityAnalyticsContext["transportType"]): VideoQualityTransportType {
    return transportType === "Livekit"
        ? VideoQualityTransportType.VIDEO_QUALITY_TRANSPORT_TYPE_LIVEKIT
        : VideoQualityTransportType.VIDEO_QUALITY_TRANSPORT_TYPE_P2P;
}

function toRelayProtocol(relayProtocol: WebRtcStats["relayProtocol"]): VideoQualityRelayProtocol | undefined {
    if (relayProtocol === "udp") {
        return VideoQualityRelayProtocol.VIDEO_QUALITY_RELAY_PROTOCOL_UDP;
    }
    if (relayProtocol === "tcp") {
        return VideoQualityRelayProtocol.VIDEO_QUALITY_RELAY_PROTOCOL_TCP;
    }
    if (relayProtocol === "tls") {
        return VideoQualityRelayProtocol.VIDEO_QUALITY_RELAY_PROTOCOL_TLS;
    }
    return undefined;
}

function toLimitationReason(reason: WebRtcSenderStats["qualityLimitationReason"]): VideoQualityLimitationReason {
    switch (reason) {
        case "cpu":
            return VideoQualityLimitationReason.VIDEO_QUALITY_LIMITATION_REASON_CPU;
        case "bandwidth":
            return VideoQualityLimitationReason.VIDEO_QUALITY_LIMITATION_REASON_BANDWIDTH;
        case "other":
            return VideoQualityLimitationReason.VIDEO_QUALITY_LIMITATION_REASON_OTHER;
        default:
            return VideoQualityLimitationReason.VIDEO_QUALITY_LIMITATION_REASON_NONE;
    }
}

function toUInt32(value: number): number {
    return Math.max(0, Math.round(value));
}
