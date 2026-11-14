// quanta: in a call with CAP_AT or more cameras on, a student's camera sends what WA budgets for 360p,
// which bounds the call's bandwidth and a lesson recording's disk; below that it sends full quality again.
// Moderators (the admin tag, in the LiveKit token's metadata from back's LivekitService) are not capped for that.
// Anyone's camera, a moderator's too, sends what WA budgets for 180p while their own link is weak (WeakConnection.ts),
// so the microphone keeps what little upload there is: the layers above 180p off, or for a single SVC encoding (VP9,
// AV1) its bitrate cut to that budget, the encoder scaling quality down within it.
import type { LocalVideoTrack, Room } from "livekit-client";
import { Track } from "livekit-client";
import { get } from "svelte/store";
import { weakConnectionStore } from "./WeakConnection";

const CAP_AT = 5;
const CAP_PIXELS = 640 * 360;
const WEAK_PIXELS = 320 * 180;
const TICK_MS = 2000;

/** livekit-client internals the cap reads, so its sender writes queue behind LiveKit's own. */
type TrackInternals = {
    senderLock?: { lock(): Promise<() => void> };
    optimizeForPerformance?: boolean;
    simulcastCodecs?: Map<unknown, { sender?: RTCRtpSender }>;
};

/** What the cap changed on a sender: layers it turned off, or the budget it lowered. */
type Applied = { off: string[] } | { index: number; full: number; capped: number };

export function startCameraCap(room: Room, track: LocalVideoTrack): void {
    let moderator = false;
    try {
        moderator = JSON.parse(room.localParticipant.metadata || "{}").moderator === true;
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

    // Read back every time: LiveKit sets encodings too (dynacast turning layers on for viewers, a new
    // camera's budget), so the cap is put back over its changes, and only the cap's own is undone.
    const adjust = async (sender: RTCRtpSender, cap: number | undefined): Promise<void> => {
        const params = sender.getParameters();
        const encodings = params.encodings ?? [];
        if (encodings.length === 0) return;
        const { width = 1280, height = 720 } = track.mediaStreamTrack.getSettings();
        const pixels = encodings.map((e) => (width * height) / (e.scaleResolutionDownBy ?? 1) ** 2);
        let was = applied.get(sender);
        let changed = false;

        // Puts back what the cap changed (only where LiveKit has not changed it since).
        const undo = () => {
            if (!was) return;
            if ("off" in was) {
                for (const e of encodings) {
                    if (!e.rid || !was.off.includes(e.rid) || e.active !== false) continue;
                    e.active = true;
                    changed = true;
                }
            } else {
                const e = encodings[was.index];
                if (e && e.maxBitrate === was.capped) {
                    e.maxBitrate = was.full;
                    changed = true;
                }
            }
            applied.delete(sender);
            was = undefined;
        };

        if (cap === undefined) {
            undo();
        } else if (encodings.length > 1 && pixels.some((p) => p <= cap && p > cap / 2)) {
            // Simulcast with a layer of about the cap (VP8, H.264 at 720p): the layers above it off. A cap that went
            // up (a weak link recovered) turns back on the ones it turned off that are now under it.
            if (was && !("off" in was)) undo();
            const off = was && "off" in was ? [...was.off] : [];
            encodings.forEach((e, i) => {
                const at = e.rid ? off.indexOf(e.rid) : -1;
                if (pixels[i] <= cap) {
                    if (at < 0) return;
                    off.splice(at, 1);
                    if (e.active === false) {
                        e.active = true;
                        changed = true;
                    }
                    return;
                }
                if (e.active === false) return;
                e.active = false;
                changed = true;
                if (e.rid && at < 0) off.push(e.rid);
            });
            applied.set(sender, { off });
        } else {
            // Otherwise the largest layer (VP9's and AV1's only one, or a simulcast with no layer near the cap)
            // gets the budget WA's bitrate curve (WebRtc/VideoPresets.ts, exponent 0.75) gives the cap.
            const index = pixels.indexOf(Math.max(...pixels));
            const e = encodings[index];
            const own = was && "capped" in was && was.index === index ? was : undefined;
            // A bitrate other than the cap's own is LiveKit's: the new full-quality budget.
            const full = own && e.maxBitrate === own.capped ? own.full : e.maxBitrate;
            if (!own) undo();
            if (pixels[index] <= cap || !full) {
                undo();
            } else {
                const capped = Math.round(full * (cap / pixels[index]) ** 0.75);
                if (e.maxBitrate !== capped) {
                    e.maxBitrate = capped;
                    changed = true;
                }
                applied.set(sender, { index, full, capped });
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
            const cap = get(weakConnectionStore)
                ? WEAK_PIXELS
                : !moderator && camerasOn() >= CAP_AT
                  ? CAP_PIXELS
                  : undefined;
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
