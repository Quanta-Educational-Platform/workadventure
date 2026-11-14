// quanta: while the presenter's own link is weak (WeakConnection.ts), a screen share sends little: of a simulcast
// (VP8, H.264) only its lowest layer (LiveKit's half-size, few-frames-a-second one), of a single encoding (VP9, AV1,
// and Firefox, which publishes no screen-share simulcast) a quarter of its bitrate at 3 frames a second. That goes for
// every sender of the share, the backup codec's too. Their voice keeps what little upload there is and viewers get a
// slow but readable screen; with the link back, layers go back to what viewers ask for (LiveKit's dynacast) and
// budgets to their own. The presenter is told why, at most every two minutes (WeakLinkNotice.ts).
import type { LocalVideoTrack, Room } from "livekit-client";
import { get } from "svelte/store";
import { weakConnectionStore } from "./WeakConnection";
import { holdScreenShareNotice, noticeWeakScreenShare } from "./WeakLinkNotice";

const TICK_MS = 2000;
const WEAK_FPS = 3;
const WEAK_BITRATE_SHARE = 0.25;

/** livekit-client internals the cap reads: its sender lock (so writes queue behind LiveKit's own), the backup codecs'
 *  senders, and what viewers last asked for of each codec (dynacast). */
type TrackInternals = {
    codec?: string;
    senderLock?: { lock(): Promise<() => void> };
    simulcastCodecs?: Map<string, { sender?: RTCRtpSender }>;
    subscribedCodecs?: { codec: string; qualities: { quality: number; enabled: boolean }[] }[];
};

/** What the cap changed on one sender, to put back. */
type Changed = {
    /** Layers it turned off, and the lowest it turned on. */
    off: Set<string>;
    on?: string;
    /** A single encoding's own bitrate and frame rate, each kept while the encoding still has the cap's value. */
    bitrate?: { full: number; capped: number };
    framerate?: { full: number | undefined };
};

/** LiveKit's quality for a simulcast layer (its videoQualityForRid): f high, h medium, anything else low. */
const qualityOf = (rid: string): number => (rid === "f" ? 2 : rid === "h" ? 1 : 0);

/** Caps the share's senders while the link is weak; returns how to stop, for when the share is unpublished. */
export function startScreenShareCap(room: Room, track: LocalVideoTrack): () => void {
    const internals = track as unknown as TrackInternals;
    const changed = new WeakMap<RTCRtpSender, Changed>();
    let busy = false;
    let stopped = false;

    const senders = (): { sender: RTCRtpSender; codec: string | undefined }[] => [
        ...(track.sender ? [{ sender: track.sender, codec: internals.codec }] : []),
        ...[...(internals.simulcastCodecs?.entries() ?? [])].flatMap(([codec, info]) =>
            info.sender ? [{ sender: info.sender, codec }] : [],
        ),
    ];

    const cap = (sender: RTCRtpSender, encodings: RTCRtpEncodingParameters[]): boolean => {
        const was = changed.get(sender) ?? { off: new Set<string>() };
        changed.set(sender, was);
        let edited = false;
        if (encodings.length > 1) {
            const scale = (e: RTCRtpEncodingParameters) => e.scaleResolutionDownBy ?? 1;
            const lowest = encodings.reduce((a, e) => (scale(e) > scale(a) ? e : a));
            // Dynacast turns off a layer nobody asked for: the lowest is on, so whoever watches gets it.
            if (lowest.active === false) {
                lowest.active = true;
                if (lowest.rid) was.on = lowest.rid;
                edited = true;
            }
            for (const e of encodings) {
                if (e === lowest || e.active === false || !e.rid) continue;
                e.active = false;
                was.off.add(e.rid);
                edited = true;
            }
            return edited;
        }
        const e = encodings[0];
        // A value other than the cap's own was set by LiveKit since: the new full one.
        if (was.bitrate && e.maxBitrate !== was.bitrate.capped) was.bitrate = undefined;
        if (!was.bitrate && e.maxBitrate) {
            was.bitrate = { full: e.maxBitrate, capped: Math.max(1, Math.round(e.maxBitrate * WEAK_BITRATE_SHARE)) };
            e.maxBitrate = was.bitrate.capped;
            edited = true;
        }
        if (was.framerate && e.maxFramerate !== WEAK_FPS) was.framerate = undefined;
        if (!was.framerate) {
            was.framerate = { full: e.maxFramerate };
            e.maxFramerate = WEAK_FPS;
            edited = true;
        }
        return edited;
    };

    const release = (
        sender: RTCRtpSender,
        codec: string | undefined,
        encodings: RTCRtpEncodingParameters[],
    ): boolean => {
        const was = changed.get(sender);
        if (!was) return false;
        changed.delete(sender);
        let edited = false;
        const wanted = internals.subscribedCodecs?.find((c) => c.codec === codec)?.qualities;
        for (const e of encodings) {
            if (!e.rid || (!was.off.has(e.rid) && was.on !== e.rid)) continue;
            // What viewers ask for now; without a word from them, what the layer was before the cap.
            const active = wanted?.find((q) => q.quality === qualityOf(e.rid ?? ""))?.enabled ?? was.off.has(e.rid);
            if (e.active !== active) {
                e.active = active;
                edited = true;
            }
        }
        if (encodings.length === 1) {
            const e = encodings[0];
            if (was.bitrate && e.maxBitrate === was.bitrate.capped) {
                e.maxBitrate = was.bitrate.full;
                edited = true;
            }
            if (was.framerate && e.maxFramerate === WEAK_FPS) {
                if (was.framerate.full === undefined) delete e.maxFramerate;
                else e.maxFramerate = was.framerate.full;
                edited = true;
            }
        }
        return edited;
    };

    const tick = async (): Promise<void> => {
        if (busy) return;
        busy = true;
        const unlock = await internals.senderLock?.lock();
        try {
            if (stopped) return;
            const weak = get(weakConnectionStore);
            // During a reconnection LiveKit republishes the share: no sender for a moment, then a new one.
            for (const { sender, codec } of senders()) {
                const params = sender.getParameters();
                const encodings = params.encodings ?? [];
                if (encodings.length === 0) continue;
                const edited = weak ? cap(sender, encodings) : release(sender, codec, encodings);
                if (edited) await sender.setParameters(params);
            }
            if (weak) noticeWeakScreenShare();
        } catch (e) {
            console.warn("Screen share cap", e);
        } finally {
            unlock?.();
            busy = false;
        }
    };

    const releaseNotice = holdScreenShareNotice();
    const timer = setInterval(() => {
        if (room.state === "disconnected") return stop();
        tick().catch(() => {});
    }, TICK_MS);
    const stop = () => {
        stopped = true;
        clearInterval(timer);
        releaseNotice();
    };
    return stop;
}
