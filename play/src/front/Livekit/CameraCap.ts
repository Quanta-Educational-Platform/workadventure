// quanta: in a call with CAP_AT or more cameras on, a student's camera sends what WA budgets for 360p,
// which bounds the call's bandwidth and a lesson recording's disk; below that it sends full quality again.
// Moderators (the admin tag, in the LiveKit token's metadata from back's LivekitService) are never capped.
import type { LocalVideoTrack, Room } from "livekit-client";
import { Track } from "livekit-client";

const CAP_AT = 5;
const CAP_PIXELS = 640 * 360;
const TICK_MS = 2000;

/** livekit-client internals the cap reads, so its sender writes queue behind LiveKit's own. */
type TrackInternals = {
    senderLock?: { lock(): Promise<() => void> };
    optimizeForPerformance?: boolean;
    simulcastCodecs?: Map<unknown, { sender?: RTCRtpSender }>;
};

type Applied = { layerOff: true } | { full: number; capped: number };

export function startCameraCap(room: Room, track: LocalVideoTrack): void {
    try {
        if (JSON.parse(room.localParticipant.metadata || "{}").moderator === true) return;
    } catch {
        // Unreadable metadata: treated as a student's.
    }
    const internals = track as unknown as TrackInternals;
    const applied = new WeakMap<RTCRtpSender, Applied>();
    let busy = false;

    // The camera's own sender, and one per backup codec LiveKit publishes alongside it.
    const senders = (): RTCRtpSender[] =>
        [track.sender, ...[...(internals.simulcastCodecs?.values() ?? [])].map((c) => c.sender)].filter(
            (s): s is RTCRtpSender => !!s,
        );

    const camerasOn = (): number => {
        // WA turns a camera off by pausing its upstream, which LiveKit announces as muted.
        let n = track.isMuted || track.isUpstreamPaused ? 0 : 1;
        for (const p of room.remoteParticipants.values()) {
            const pub = p.getTrackPublication(Track.Source.Camera);
            if (pub && !pub.isMuted) n += 1;
        }
        return n;
    };

    // WA's bitrate curve (WebRtc/VideoPresets.ts, exponent 0.75), from the capture size to 360p.
    const scale = (): number => {
        const { width = 1280, height = 720 } = track.mediaStreamTrack.getSettings();
        return Math.min(1, (CAP_PIXELS / (width * height)) ** 0.75);
    };

    // Read back every time: LiveKit sets encodings too (dynacast turning layers on for viewers, a new
    // camera's budget), so the cap is put back over its changes, and only the cap's own is undone.
    const adjust = async (sender: RTCRtpSender, cap: boolean): Promise<void> => {
        const params = sender.getParameters();
        const encodings = params.encodings ?? [];
        if (encodings.length === 0) return;
        const was = applied.get(sender);
        let changed = false;
        if (encodings.length > 1) {
            // Simulcast (VP8, H.264): the full-size layer off leaves the 360p one on top.
            const top = encodings.find((e) => e.rid === "f");
            if (!top) return;
            if (cap && top.active !== false) {
                top.active = false;
                applied.set(sender, { layerOff: true });
                changed = true;
            } else if (!cap && was) {
                if (top.active === false) {
                    top.active = true;
                    changed = true;
                }
                applied.delete(sender);
            }
        } else {
            // One encoding carrying every size (VP9, AV1): its budget scaled down to 360p's.
            const e = encodings[0];
            const own = was && "capped" in was ? was : undefined;
            if (cap) {
                // A bitrate other than the cap's own is LiveKit's: the new full-quality budget.
                const full = own && e.maxBitrate === own.capped ? own.full : e.maxBitrate;
                if (!full) return;
                const capped = Math.round(full * scale());
                if (e.maxBitrate !== capped) {
                    e.maxBitrate = capped;
                    changed = true;
                }
                applied.set(sender, { full, capped });
            } else if (own) {
                if (e.maxBitrate === own.capped) {
                    e.maxBitrate = own.full;
                    changed = true;
                }
                applied.delete(sender);
            }
        }
        if (changed) await sender.setParameters(params);
    };

    const tick = async (): Promise<void> => {
        // LiveKit's own fallback for a struggling CPU sets the encodings itself.
        if (busy || internals.optimizeForPerformance) return;
        busy = true;
        const unlock = await internals.senderLock?.lock();
        try {
            const cap = camerasOn() >= CAP_AT;
            for (const s of senders()) await adjust(s, cap);
        } catch (e) {
            console.warn("Camera cap", e);
        } finally {
            unlock?.();
            busy = false;
        }
    };

    const timer = setInterval(() => {
        if (
            room.state === "disconnected" ||
            room.localParticipant.getTrackPublication(Track.Source.Camera)?.track !== track
        ) {
            clearInterval(timer);
            return;
        }
        tick().catch(() => {});
    }, TICK_MS);
    tick().catch(() => {});
}
