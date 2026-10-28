// quanta: what the platform around the room records about each stay (its session report, kept for the wa-health
// cron): the room connection's drops ("Connection lost" while it lasts, then for how long), and every 20 s in a call
// the call's quality from the browser's own WebRTC statistics: packet loss each way, the round trip, and whether the
// call goes through the TURN relay. Peer connections are noted as they are made (peerConnections.ts).
import type { Unsubscriber } from "svelte/store";
import { toastStore } from "../Stores/ToastStoreSingleton";
import { diagnosticSessionId } from "./diagnosticContext";
import { peerConnections } from "./peerConnections";
import { isVideoExpected } from "./videoExpectations";

const SAMPLE_MS = 20_000;
/** ConnectionManager's id for the "Connection lost" toast. */
const RECONNECTING_TOAST = "websocket-reconnecting-toast";

type Post = (message: Record<string, unknown>) => void;

interface Counters {
    identity: string;
    lost: number;
    received: number;
    at: number;
    sampledAt: number;
    frames?: number;
    freezes?: number;
    frozenSeconds?: number;
    audioSamples?: number;
    concealed?: number;
    videoExpected?: boolean;
}

/** Each incoming stream's counters at the last sample, by its stats id: streams come and go as people do. */
type Previous = WeakMap<RTCPeerConnection, Map<string, Counters>>;

export async function sampleCallStats(connections: Set<RTCPeerConnection>, previous: Previous) {
    let upLoss = 0;
    let media = false;
    let relayed = false;
    const rtts: number[] = [];
    let lost = 0;
    let received = 0;
    const videoFps: number[] = [];
    let videoFreezeCount = 0;
    let videoFreezeDurationMs = 0;
    let audioSamples = 0;
    let audioConcealed = 0;
    for (const pc of connections) if (pc.connectionState === "closed") connections.delete(pc);
    const live = [...connections].filter((pc) => pc.connectionState === "connected");
    const all = await Promise.allSettled(live.map(async (pc) => [pc, await pc.getStats()] as const));
    for (const result of all) {
        if (result.status !== "fulfilled") continue;
        const [pc, stats] = result.value;
        const before = previous.get(pc);
        const now = new Map<string, Counters>();
        let pairId: string | undefined;
        stats.forEach((report: RTCStats & Record<string, unknown>) => {
            if (report.type === "outbound-rtp" || report.type === "inbound-rtp") media = true;
            if (report.type === "remote-inbound-rtp" && finite(report.fractionLost)) {
                upLoss = Math.max(upLoss, Math.min(1, Math.max(0, report.fractionLost)) * 100);
            }
            if (report.type === "inbound-rtp") {
                const counters = {
                    identity: JSON.stringify([report.ssrc, report.trackIdentifier, report.kind, report.codecId]),
                    lost: finite(report.packetsLost) ? report.packetsLost : 0,
                    received: finite(report.packetsReceived) ? report.packetsReceived : 0,
                    at: report.timestamp,
                    sampledAt: Date.now(),
                    frames: finite(report.framesDecoded) ? report.framesDecoded : undefined,
                    freezes: finite(report.freezeCount) ? report.freezeCount : undefined,
                    frozenSeconds: finite(report.totalFreezesDuration) ? report.totalFreezesDuration : undefined,
                    audioSamples: finite(report.totalSamplesReceived) ? report.totalSamplesReceived : undefined,
                    concealed: finite(report.concealedSamples) ? report.concealedSamples : undefined,
                    videoExpected: isVideoExpected(
                        typeof report.trackIdentifier === "string" ? report.trackIdentifier : undefined,
                        Date.now(),
                    ),
                };
                if (!finite(counters.at) || !finite(report.packetsReceived)) return;
                const last = before?.get(report.id);
                // Never rewind a baseline when the browser returns a stale report.
                if (last && counters.at <= last.at) {
                    now.set(report.id, last);
                    return;
                }
                now.set(report.id, counters);
                // A new stream starts counting at its next sample; a reset one (counters going back) is skipped.
                if (last && counters.identity === last.identity && monotonic(counters, last)) {
                    // The whole interval is ambiguous if either endpoint was deliberately paused.
                    if (
                        counters.frames !== undefined &&
                        (!counters.videoExpected ||
                            !last.videoExpected ||
                            !isVideoExpected(
                                typeof report.trackIdentifier === "string" ? report.trackIdentifier : undefined,
                                counters.sampledAt,
                                last.sampledAt,
                            ))
                    )
                        return;
                    lost += Math.max(counters.lost - last.lost, 0);
                    const packets = counters.received - last.received;
                    received += packets;
                    const seconds = (counters.at - last.at) / 1000;
                    if (
                        packets > 0 &&
                        seconds > 0 &&
                        counters.frames !== undefined &&
                        last.frames !== undefined &&
                        counters.frames >= last.frames
                    ) {
                        videoFps.push((counters.frames - last.frames) / seconds);
                        videoFreezeCount += Math.max(0, (counters.freezes ?? 0) - (last.freezes ?? 0));
                        videoFreezeDurationMs +=
                            Math.max(0, (counters.frozenSeconds ?? 0) - (last.frozenSeconds ?? 0)) * 1000;
                    }
                    if (
                        counters.audioSamples !== undefined &&
                        last.audioSamples !== undefined &&
                        counters.audioSamples >= last.audioSamples
                    ) {
                        audioSamples += counters.audioSamples - last.audioSamples;
                        audioConcealed += Math.max(0, (counters.concealed ?? 0) - (last.concealed ?? 0));
                    }
                }
            }
            if (report.type === "transport" && typeof report.selectedCandidatePairId === "string") {
                pairId = report.selectedCandidatePairId;
            }
        });
        previous.set(pc, now);
        const pair = (pairId ? stats.get(pairId) : undefined) as (RTCStats & Record<string, unknown>) | undefined;
        if (pair && finite(pair.currentRoundTripTime) && pair.currentRoundTripTime >= 0)
            rtts.push(pair.currentRoundTripTime * 1000);
        const local = pair && typeof pair.localCandidateId === "string" ? stats.get(pair.localCandidateId) : undefined;
        if ((local as Record<string, unknown> | undefined)?.candidateType === "relay") relayed = true;
    }
    if (!media) return undefined;
    // Too few packets in 20 s (a muted, camera-off call) say nothing about loss.
    const downLoss = lost + received >= 50 ? (lost / (lost + received)) * 100 : 0;
    return {
        upLossPct: Math.round(upLoss * 10) / 10,
        downLossPct: Math.round(downLoss * 10) / 10,
        rttMs: rtts.length ? Math.round(rtts.reduce((a, b) => a + b, 0) / rtts.length) : null,
        relayed,
        browserSessionId: diagnosticSessionId,
        videoFps: videoFps.length
            ? Math.round((videoFps.reduce((a, b) => a + b, 0) / videoFps.length) * 10) / 10
            : undefined,
        videoStreams: videoFps.length,
        videoFreezeCount,
        videoFreezeDurationMs: Math.round(videoFreezeDurationMs),
        audioConcealedRatio: audioSamples > 0 ? Math.min(1, audioConcealed / audioSamples) : undefined,
    };
}

function finite(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function monotonic(current: Counters, previous: Counters): boolean {
    // packetsLost may decrease when late packets arrive; it is not a reset signal.
    const keys = ["received", "frames", "freezes", "frozenSeconds", "audioSamples", "concealed"] as const;
    return keys.every(
        (key) => current[key] === undefined || previous[key] === undefined || current[key] >= previous[key],
    );
}

export function startCallStats(post: Post): Unsubscriber {
    const previous: Previous = new WeakMap();
    let sampling = false;
    let stopped = false;
    const timer = window.setInterval(() => {
        if (sampling || stopped) return;
        sampling = true;
        sampleCallStats(peerConnections, previous)
            .then((call) => {
                if (call && !stopped) post({ type: "quanta_wa_call", ...call });
            })
            .catch(() => undefined)
            .finally(() => {
                sampling = false;
            });
    }, SAMPLE_MS);

    let lostAt: number | undefined;
    const unsubscribe = toastStore.subscribe((toasts) => {
        const reconnecting = toasts.has(RECONNECTING_TOAST);
        if (reconnecting && lostAt === undefined) {
            lostAt = Date.now();
            // The platform counts it from now, should the room be closed before it is back.
            post({ type: "quanta_wa_connection", lost: true });
        }
        if (!reconnecting && lostAt !== undefined) {
            post({ type: "quanta_wa_connection", downMs: Date.now() - lostAt });
            lostAt = undefined;
        }
    });

    return () => {
        stopped = true;
        window.clearInterval(timer);
        unsubscribe();
    };
}
