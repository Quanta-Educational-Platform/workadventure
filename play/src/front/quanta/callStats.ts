// quanta: what the platform around the room records about each stay (its session report, kept for the wa-health
// cron): the room connection's drops ("Connection lost" while it lasts, then for how long), and every 20 s in a call
// the call's quality from the browser's own WebRTC statistics: packet loss each way, the round trip, and whether the
// call goes through the TURN relay. Peer connections are noted as they are made (peerConnections.ts). Audio concealed
// over silence (a muted or quiet speaker) and streams that carried nothing in the interval (paused, unsubscribed) are
// not counted as lost audio. A page closing takes the connection with it: not a drop (pageLeave.ts).
// Each sample also says what limited the own camera (CPU or bandwidth), the upload the browser estimates, how long
// incoming audio waits in the jitter buffer (delay that stays), UDP or TCP, how much of the time the page's main
// thread was blocked, and once per page the device (cores, memory, a software GPU), so a slow computer can be told
// from a bad link.
import type { Unsubscriber } from "svelte/store";
import { toastStore } from "../Stores/ToastStoreSingleton";
import { diagnosticSessionId } from "./diagnosticContext";
import { peerConnections } from "./peerConnections";
import { isVideoExpected } from "./videoExpectations";
import { pageLeaving, watchPageLeave } from "./pageLeave";

const SAMPLE_MS = 20_000;
/** ConnectionManager's id for the "Connection lost" toast. */
const RECONNECTING_TOAST = "websocket-reconnecting-toast";

type Post = (message: Record<string, unknown>) => void;

interface OutboundCounters {
    at: number;
    cpu: number;
    bandwidth: number;
    total: number;
}

/** Outgoing video streams' limitation counters at the last sample, by stats id. */
type PreviousOutbound = WeakMap<RTCPeerConnection, Map<string, OutboundCounters>>;

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
    silentConcealed?: number;
    jitterBufferDelay?: number;
    jitterBufferEmitted?: number;
    videoExpected?: boolean;
}

/** Each incoming stream's counters at the last sample, by its stats id: streams come and go as people do. */
type Previous = WeakMap<RTCPeerConnection, Map<string, Counters>>;

export async function sampleCallStats(
    connections: Set<RTCPeerConnection>,
    previous: Previous,
    previousOutbound: PreviousOutbound = new WeakMap(),
) {
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
    let jitterDelay = 0;
    let jitterEmitted = 0;
    let limitedCpu = 0;
    let limitedBandwidth = 0;
    let limitedTotal = 0;
    let outgoingBitrate: number | undefined;
    let protocol: "udp" | "tcp" | undefined;
    for (const pc of connections) if (pc.connectionState === "closed") connections.delete(pc);
    const live = [...connections].filter((pc) => pc.connectionState === "connected");
    const all = await Promise.allSettled(live.map(async (pc) => [pc, await pc.getStats()] as const));
    for (const result of all) {
        if (result.status !== "fulfilled") continue;
        const [pc, stats] = result.value;
        const before = previous.get(pc);
        const now = new Map<string, Counters>();
        const outboundBefore = previousOutbound.get(pc);
        const outboundNow = new Map<string, OutboundCounters>();
        let pairId: string | undefined;
        stats.forEach((report: RTCStats & Record<string, unknown>) => {
            if (report.type === "outbound-rtp" || report.type === "inbound-rtp") media = true;
            if (report.type === "outbound-rtp" && report.kind === "video") {
                const durations = report.qualityLimitationDurations as Record<string, unknown> | undefined;
                if (durations && typeof durations === "object") {
                    const seconds = (key: string) => {
                        const value = durations[key];
                        return finite(value) ? value : 0;
                    };
                    const counters = {
                        at: report.timestamp,
                        cpu: seconds("cpu"),
                        bandwidth: seconds("bandwidth"),
                        total: seconds("none") + seconds("cpu") + seconds("bandwidth") + seconds("other"),
                    };
                    outboundNow.set(report.id, counters);
                    const last = outboundBefore?.get(report.id);
                    if (last && counters.total > last.total && counters.cpu >= last.cpu) {
                        limitedCpu += counters.cpu - last.cpu;
                        limitedBandwidth += Math.max(0, counters.bandwidth - last.bandwidth);
                        limitedTotal += counters.total - last.total;
                    }
                }
            }
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
                    silentConcealed: finite(report.silentConcealedSamples) ? report.silentConcealedSamples : undefined,
                    jitterBufferDelay: finite(report.jitterBufferDelay) ? report.jitterBufferDelay : undefined,
                    jitterBufferEmitted: finite(report.jitterBufferEmittedCount)
                        ? report.jitterBufferEmittedCount
                        : undefined,
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
                        packets > 0 &&
                        counters.audioSamples !== undefined &&
                        last.audioSamples !== undefined &&
                        counters.audioSamples >= last.audioSamples
                    ) {
                        audioSamples += counters.audioSamples - last.audioSamples;
                        const concealed = Math.max(0, (counters.concealed ?? 0) - (last.concealed ?? 0));
                        const silent = Math.max(0, (counters.silentConcealed ?? 0) - (last.silentConcealed ?? 0));
                        audioConcealed += Math.max(0, concealed - silent);
                        const emitted = (counters.jitterBufferEmitted ?? 0) - (last.jitterBufferEmitted ?? 0);
                        const delay = (counters.jitterBufferDelay ?? 0) - (last.jitterBufferDelay ?? 0);
                        if (emitted > 0 && delay >= 0) {
                            jitterDelay += delay;
                            jitterEmitted += emitted;
                        }
                    }
                }
            }
            if (report.type === "transport" && typeof report.selectedCandidatePairId === "string") {
                pairId = report.selectedCandidatePairId;
            }
        });
        previous.set(pc, now);
        previousOutbound.set(pc, outboundNow);
        const pair = (pairId ? stats.get(pairId) : undefined) as (RTCStats & Record<string, unknown>) | undefined;
        if (pair && finite(pair.currentRoundTripTime) && pair.currentRoundTripTime >= 0)
            rtts.push(pair.currentRoundTripTime * 1000);
        if (pair && finite(pair.availableOutgoingBitrate))
            outgoingBitrate = Math.max(outgoingBitrate ?? 0, pair.availableOutgoingBitrate);
        const local = (
            pair && typeof pair.localCandidateId === "string" ? stats.get(pair.localCandidateId) : undefined
        ) as Record<string, unknown> | undefined;
        if (local?.candidateType === "relay") relayed = true;
        // TCP on any connection is what matters: media over TCP arrives late rather than not at all.
        const transport = local?.candidateType === "relay" ? local?.relayProtocol : local?.protocol;
        if (transport === "tcp" || transport === "tls") protocol = "tcp";
        else if (transport === "udp" && protocol === undefined) protocol = "udp";
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
        jitterBufferDelayMs: jitterEmitted > 0 ? Math.round((jitterDelay / jitterEmitted) * 1000) : undefined,
        cpuLimitedRatio: limitedTotal > 0 ? round3(limitedCpu / limitedTotal) : undefined,
        bandwidthLimitedRatio: limitedTotal > 0 ? round3(limitedBandwidth / limitedTotal) : undefined,
        availableOutgoingBitrate: outgoingBitrate !== undefined ? Math.round(outgoingBitrate) : undefined,
        candidateProtocol: protocol,
    };
}

function round3(value: number): number {
    return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

/** The device, once per page: what a slow computer looks like next to a bad link. */
let device: Record<string, unknown> | undefined;
function deviceInfo(): Record<string, unknown> {
    if (device) return device;
    device = {};
    if (finite(navigator.hardwareConcurrency)) device.cpuCores = navigator.hardwareConcurrency;
    const memory = (navigator as Navigator & { deviceMemory?: unknown }).deviceMemory;
    if (finite(memory)) device.deviceMemoryGb = memory;
    try {
        const gl = document.createElement("canvas").getContext("webgl");
        const info = gl?.getExtension("WEBGL_debug_renderer_info");
        const renderer = info && gl ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : undefined;
        if (typeof renderer === "string") {
            // Chrome's own software renderer, Windows' fallback driver, Mesa's: no GPU acceleration.
            device.softwareGpu = /swiftshader|basic render|llvmpipe|softpipe|software/i.test(renderer);
        }
        gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
        // No WebGL: nothing to say about the GPU.
    }
    return device;
}

/** Share of the time since the last read that the main thread spent in long tasks (50 ms or more). */
function watchLongTasks(): { read(): number | undefined; stop(): void } {
    let blocked = 0;
    let since = performance.now();
    let observer: PerformanceObserver | undefined;
    try {
        observer = new PerformanceObserver((list) => {
            for (const entry of list.getEntries()) blocked += entry.duration;
        });
        observer.observe({ type: "longtask" });
    } catch {
        observer = undefined;
    }
    return {
        read() {
            if (!observer) return undefined;
            const now = performance.now();
            const ratio = now > since ? round3(blocked / (now - since)) : undefined;
            blocked = 0;
            since = now;
            return ratio;
        },
        stop() {
            observer?.disconnect();
        },
    };
}

function finite(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function monotonic(current: Counters, previous: Counters): boolean {
    // packetsLost may decrease when late packets arrive; it is not a reset signal.
    const keys = [
        "received",
        "frames",
        "freezes",
        "frozenSeconds",
        "audioSamples",
        "concealed",
        "silentConcealed",
    ] as const;
    return keys.every(
        (key) => current[key] === undefined || previous[key] === undefined || current[key] >= previous[key],
    );
}

export function startCallStats(post: Post): Unsubscriber {
    watchPageLeave();
    const previous: Previous = new WeakMap();
    const previousOutbound: PreviousOutbound = new WeakMap();
    const longTasks = watchLongTasks();
    let sampling = false;
    let stopped = false;
    const timer = window.setInterval(() => {
        if (sampling || stopped) return;
        sampling = true;
        sampleCallStats(peerConnections, previous, previousOutbound)
            .then((call) => {
                // Read every interval, in a call or not, so a sample covers only its own 20 s.
                const longTaskRatio = longTasks.read();
                if (call && !stopped)
                    post({
                        type: "quanta_wa_call",
                        ...call,
                        ...deviceInfo(),
                        ...(longTaskRatio !== undefined ? { longTaskRatio } : {}),
                    });
            })
            .catch(() => undefined)
            .finally(() => {
                sampling = false;
            });
    }, SAMPLE_MS);

    let lostAt: number | undefined;
    const unsubscribe = toastStore.subscribe((toasts) => {
        const reconnecting = toasts.has(RECONNECTING_TOAST);
        if (reconnecting && lostAt === undefined && !pageLeaving()) {
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
        longTasks.stop();
        unsubscribe();
    };
}
