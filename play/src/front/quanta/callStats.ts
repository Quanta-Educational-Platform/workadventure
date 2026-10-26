// quanta: what the platform around the room records about each stay (its session report, kept for the wa-health
// cron): the room connection's drops ("Connection lost" until it is back), and every 20 s in a call the call's
// quality from the browser's own WebRTC statistics: packet loss each way, the round trip, and whether the call goes
// through the TURN relay. Peer connections are noted as they are made, so this starts before any call.
import type { Unsubscriber } from "svelte/store";
import { toastStore } from "../Stores/ToastStoreSingleton";

const SAMPLE_MS = 20_000;
/** ConnectionManager's id for the "Connection lost" toast. */
const RECONNECTING_TOAST = "websocket-reconnecting-toast";

type Post = (message: Record<string, unknown>) => void;

interface Counters {
    lost: number;
    received: number;
}

function watchPeerConnections(): Set<RTCPeerConnection> {
    const connections = new Set<RTCPeerConnection>();
    const Native = window.RTCPeerConnection;
    if (!Native) return connections;
    window.RTCPeerConnection = class QuantaPeerConnection extends Native {
        constructor(configuration?: RTCConfiguration) {
            super(configuration);
            // Closed ones are dropped at the next sample.
            connections.add(this);
        }
    };
    return connections;
}

async function sample(connections: Set<RTCPeerConnection>, previous: WeakMap<RTCPeerConnection, Counters>) {
    let upLoss = 0;
    let media = false;
    let relayed = false;
    const rtts: number[] = [];
    let lost = 0;
    let received = 0;
    for (const pc of connections) if (pc.connectionState === "closed") connections.delete(pc);
    const live = [...connections].filter((pc) => pc.connectionState === "connected");
    const all = await Promise.all(live.map(async (pc) => [pc, await pc.getStats()] as const));
    for (const [pc, stats] of all) {
        const now: Counters = { lost: 0, received: 0 };
        let pairId: string | undefined;
        stats.forEach((report: RTCStats & Record<string, unknown>) => {
            if (report.type === "outbound-rtp" || report.type === "inbound-rtp") media = true;
            if (report.type === "remote-inbound-rtp" && typeof report.fractionLost === "number") {
                upLoss = Math.max(upLoss, report.fractionLost * 100);
            }
            if (report.type === "inbound-rtp") {
                now.lost += typeof report.packetsLost === "number" ? Math.max(report.packetsLost, 0) : 0;
                now.received += typeof report.packetsReceived === "number" ? report.packetsReceived : 0;
            }
            if (report.type === "transport" && typeof report.selectedCandidatePairId === "string") {
                pairId = report.selectedCandidatePairId;
            }
        });
        const before = previous.get(pc);
        if (before) {
            lost += Math.max(now.lost - before.lost, 0);
            received += Math.max(now.received - before.received, 0);
        }
        previous.set(pc, now);
        const pair = (pairId ? stats.get(pairId) : undefined) as (RTCStats & Record<string, unknown>) | undefined;
        if (pair && typeof pair.currentRoundTripTime === "number") rtts.push(pair.currentRoundTripTime * 1000);
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
    };
}

export function startCallStats(post: Post): Unsubscriber {
    const connections = watchPeerConnections();
    const previous = new WeakMap<RTCPeerConnection, Counters>();
    const timer = window.setInterval(() => {
        sample(connections, previous)
            .then((call) => {
                if (call) post({ type: "quanta_wa_call", ...call });
            })
            .catch(() => undefined);
    }, SAMPLE_MS);

    let lostAt: number | undefined;
    const unsubscribe = toastStore.subscribe((toasts) => {
        const reconnecting = toasts.has(RECONNECTING_TOAST);
        if (reconnecting && lostAt === undefined) lostAt = Date.now();
        if (!reconnecting && lostAt !== undefined) {
            post({ type: "quanta_wa_connection", downMs: Date.now() - lostAt });
            lostAt = undefined;
        }
    });

    return () => {
        window.clearInterval(timer);
        unsubscribe();
    };
}
