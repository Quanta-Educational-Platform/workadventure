// quanta: this browser's upload as its own sender stats see it, beside LiveKit's rating (WeakConnection.ts). LiveKit
// rates a publisher by what reaches the server, so an upload that queues rather than drops (packets arriving seconds
// late) can rate well while viewers watch a frozen share. Every 2 s: the round trip of what was sent (RTCP from the
// server) and the share of it the server reports lost. Either one high in two reports running is reported as Poor
// (one alone is a keyframe burst), both low as Good, anything between as Unknown; the tracker it feeds decides how long
// it has to last.
import { ConnectionQuality, type Room } from "livekit-client";

const SAMPLE_MS = 2000;
/** The class's round trips are 90 ms on average, 200 ms for 9 in 10 people: this much is a queue, not a distance. */
const WEAK_RTT_MS = 800;
const GOOD_RTT_MS = 400;
const WEAK_LOSS = 0.2;
const GOOD_LOSS = 0.05;
/** Fewer packets than this in a sample say nothing about loss (a muted microphone sends almost none). */
const MIN_PACKETS = 20;
/**
 * Nothing sent (microphone and camera off) says nothing about the link either: a weak verdict that nothing can confirm
 * any more ends after this long, so a muted person isn't held weak for the rest of the class.
 */
const SILENT_GOOD_MS = 15_000;

export type SenderLinkReason = "sender_rtt" | "sender_loss";

interface Counters {
    rttTotal: number;
    rttCount: number;
    lost: number;
    sent: number;
}

function num(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

const watched = new Set<Room>();

/** Bytes this browser's calls have sent so far: what a link test must add to its own to see the link's capacity. */
export async function callBytesSent(): Promise<number> {
    let bytes = 0;
    for (const room of watched) {
        if (room.state !== "connected") continue;
        for (const publication of room.localParticipant.trackPublications.values()) {
            const sender = publication.track?.sender;
            if (!sender) continue;
            (await sender.getStats()).forEach((entry: RTCStats & Record<string, unknown>) => {
                if (entry.type === "outbound-rtp") bytes += num(entry.bytesSent) ?? 0;
            });
        }
    }
    return bytes;
}

/** Starts sampling; returns how to stop. `report` gets each sample's verdict (nothing when a sample says nothing). */
export function watchSenderLink(
    room: Room,
    report: (quality: ConnectionQuality, reason?: SenderLinkReason) => void,
): () => void {
    watched.add(room);
    let previous = new Map<string, Counters>();
    let busy = false;
    let stopped = false;
    let poorBefore = false;
    let judgedAt = Date.now();

    const sample = async (): Promise<void> => {
        const senders = new Set<RTCRtpSender>();
        for (const publication of room.localParticipant.trackPublications.values()) {
            const sender = publication.track?.sender;
            if (sender) senders.add(sender);
        }
        let rttTotal = 0;
        let rttCount = 0;
        let lost = 0;
        let sent = 0;
        const now = new Map<string, Counters>();
        for (const sender of senders) {
            const stats = await sender.getStats();
            stats.forEach((entry: RTCStats & Record<string, unknown>) => {
                if (entry.type !== "remote-inbound-rtp") return;
                const outbound =
                    typeof entry.localId === "string"
                        ? (stats.get(entry.localId) as Record<string, unknown> | undefined)
                        : undefined;
                // Without the running totals (older browsers), a round trip or loss that changed is a new report.
                const latestRtt = num(entry.roundTripTime);
                const hasTotals = num(entry.roundTripTimeMeasurements) !== undefined;
                const counters: Counters = {
                    rttTotal: hasTotals ? (num(entry.totalRoundTripTime) ?? 0) : (latestRtt ?? 0),
                    rttCount: hasTotals ? (num(entry.roundTripTimeMeasurements) ?? 0) : 0,
                    lost: Math.max(0, num(entry.packetsLost) ?? 0),
                    sent: num(outbound?.packetsSent) ?? 0,
                };
                const key = `${entry.id}`;
                const last = previous.get(key);
                if (!last) {
                    now.set(key, counters);
                    return;
                }
                // Only what the server's last report says: between reports the sent count grows and the lost one
                // can't, which would read as a clean link. Until a new report the counts stay from the last one.
                const fresh = hasTotals
                    ? counters.rttCount > last.rttCount
                    : counters.rttTotal !== last.rttTotal || counters.lost !== last.lost;
                if (!fresh) {
                    now.set(key, last);
                    return;
                }
                now.set(key, counters);
                if (!hasTotals) {
                    if (latestRtt !== undefined) {
                        rttTotal += latestRtt;
                        rttCount += 1;
                    }
                } else if (counters.rttTotal >= last.rttTotal) {
                    rttTotal += counters.rttTotal - last.rttTotal;
                    rttCount += counters.rttCount - last.rttCount;
                }
                if (counters.sent > last.sent) {
                    sent += counters.sent - last.sent;
                    lost += Math.max(0, counters.lost - last.lost);
                }
            });
        }
        previous = now;
        if (stopped) return;
        const rttMs = rttCount > 0 ? (rttTotal / rttCount) * 1000 : undefined;
        const loss = sent >= MIN_PACKETS ? Math.min(1, lost / sent) : undefined;
        const poor: SenderLinkReason | undefined =
            rttMs !== undefined && rttMs >= WEAK_RTT_MS
                ? "sender_rtt"
                : loss !== undefined && loss >= WEAK_LOSS
                  ? "sender_loss"
                  : undefined;
        const good =
            !poor &&
            (rttMs !== undefined || loss !== undefined) &&
            (rttMs === undefined || rttMs < GOOD_RTT_MS) &&
            (loss === undefined || loss < GOOD_LOSS);
        // No new report from the server (they come every few seconds, sparser for audio alone): nothing to judge, so
        // nothing changes, unless the silence has lasted.
        if (rttMs === undefined && loss === undefined) {
            if (Date.now() - judgedAt >= SILENT_GOOD_MS) report(ConnectionQuality.Good);
            return;
        }
        judgedAt = Date.now();
        const wasPoor = poorBefore;
        poorBefore = !!poor;
        if (poor && wasPoor) report(ConnectionQuality.Poor, poor);
        else if (good) report(ConnectionQuality.Good);
        else if (!poor) report(ConnectionQuality.Unknown);
    };

    const timer = setInterval(() => {
        if (busy || stopped || room.state !== "connected") return;
        busy = true;
        sample()
            .catch(() => undefined)
            .finally(() => {
                busy = false;
            });
    }, SAMPLE_MS);

    return () => {
        watched.delete(room);
        stopped = true;
        clearInterval(timer);
    };
}
