// quanta: "Check connection" before a class (room settings, Video). A 720p test picture goes from this browser to
// itself through the room's TURN relay, which runs beside the call server, so it travels the same way a screen share
// does: up to the server and back. Twelve seconds of it give the upload the link really carries, its round trip and
// what the server reports lost, and from them what this link is good for.
import { iceServersManager } from "../WebRtc/IceServersManager";
import { callBytesSent } from "../Livekit/SenderLinkWatch";
import { holdWeakVerdicts } from "../Livekit/WeakConnection";

const RUN_MS = 12_000;
/** The first seconds only find the link's pace: the verdict is from the rest. */
const SETTLE_MS = 4_000;
const TARGET_BPS = 2_500_000;
/** What a readable 1080p screen share at 15 fps needs, and what voice with a small camera needs. */
const SHARE_KBPS = 1_200;
const VOICE_KBPS = 300;

/** `hidden`: the tab was left mid-check, which slows its test picture to a frame a second: no verdict. */
export type ConnectionCheckVerdict = "share" | "voice" | "slow" | "weak" | "failed" | "hidden";
export type ConnectionCheckResult = {
    verdict: ConnectionCheckVerdict;
    uploadKbps?: number;
    rttMs?: number;
    lossPct?: number;
};

function noisyPicture(): { stream: MediaStream; stop: () => void } {
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const context = canvas.getContext("2d");
    let frame = 0;
    // Changing detail on every frame, as a scrolled page has: a still picture would cost the encoder nothing.
    const timer = setInterval(() => {
        if (!context) return;
        frame++;
        for (let i = 0; i < 48; i++) {
            context.fillStyle = `hsl(${(frame * 37 + i * 53) % 360} 70% ${30 + ((i * 7 + frame) % 40)}%)`;
            context.fillRect(((i * 131 + frame * 17) % 1280) - 40, ((i * 71 + frame * 29) % 720) - 40, 120, 90);
        }
        context.fillStyle = "#fff";
        context.font = "28px sans-serif";
        context.fillText(`${frame} ${Math.random().toString(36).slice(2)}`, 40 + (frame % 600), 360);
    }, 1000 / 15);
    const stream = canvas.captureStream(15);
    return {
        stream,
        stop: () => {
            clearInterval(timer);
            stream.getTracks().forEach((track) => track.stop());
        },
    };
}

function num(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

let running: Promise<ConnectionCheckResult> | undefined;

/** One check at a time, whoever asks: two at once would share the link and both read it low. */
export function runConnectionCheck(): Promise<ConnectionCheckResult> {
    running ??= check().finally(() => {
        running = undefined;
    });
    return running;
}

async function check(): Promise<ConnectionCheckResult> {
    let iceServers: RTCIceServer[];
    try {
        iceServers = (await iceServersManager.getIceServersConfig()).filter((server) =>
            [server.urls].flat().some((url) => url.startsWith("turn:") || url.startsWith("turns:")),
        );
    } catch (e) {
        console.warn("Connection check", e);
        return { verdict: "failed" };
    }
    if (iceServers.length === 0) return { verdict: "failed" };
    const sender = new RTCPeerConnection({ iceServers, iceTransportPolicy: "relay" });
    const receiver = new RTCPeerConnection({ iceServers, iceTransportPolicy: "relay" });
    const picture = noisyPicture();
    let left = document.hidden;
    const onVisibility = () => {
        if (document.hidden) left = true;
    };
    document.addEventListener("visibilitychange", onVisibility);
    try {
        sender.onicecandidate = (e) => e.candidate && receiver.addIceCandidate(e.candidate).catch(() => undefined);
        receiver.onicecandidate = (e) => e.candidate && sender.addIceCandidate(e.candidate).catch(() => undefined);
        const track = picture.stream.getVideoTracks()[0];
        track.contentHint = "detail";
        const rtpSender = sender.addTrack(track, picture.stream);
        await sender.setLocalDescription(await sender.createOffer());
        await receiver.setRemoteDescription(sender.localDescription as RTCSessionDescriptionInit);
        await receiver.setLocalDescription(await receiver.createAnswer());
        await sender.setRemoteDescription(receiver.localDescription as RTCSessionDescriptionInit);
        const params = rtpSender.getParameters();
        if (params.encodings?.[0]) {
            params.encodings[0].maxBitrate = TARGET_BPS;
            await rtpSender.setParameters(params).catch(() => undefined);
        }
        const connected = await new Promise<boolean>((resolve) => {
            const timeout = setTimeout(() => resolve(false), 10_000);
            sender.onconnectionstatechange = () => {
                if (sender.connectionState === "connected") {
                    clearTimeout(timeout);
                    resolve(true);
                } else if (sender.connectionState === "failed") {
                    clearTimeout(timeout);
                    resolve(false);
                }
            };
        });
        if (!connected) return { verdict: "failed" };

        // In a call the test shares the upload with it: the call's own sending counts toward what the link carries,
        // and the room's weak-link watch, which would see the test as a weak link, waits until it's over.
        holdWeakVerdicts(RUN_MS + 8_000);
        const startedAt = performance.now();
        let callFrom: number | undefined;
        let callLast: number | undefined;
        let from: { at: number; bytes: number } | undefined;
        let last: { at: number; bytes: number } | undefined;
        const rtts: number[] = [];
        let lost = 0;
        let sent = 0;
        let lostFrom: { lost: number; sent: number } | undefined;
        while (performance.now() - startedAt < RUN_MS) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            if (left || document.hidden) return { verdict: "hidden" };
            const stats = await rtpSender.getStats();
            const settled = performance.now() - startedAt >= SETTLE_MS;
            if (settled) {
                callLast = await callBytesSent().catch(() => callLast);
                callFrom ??= callLast;
            }
            stats.forEach((entry: RTCStats & Record<string, unknown>) => {
                if (entry.type === "outbound-rtp" && num(entry.bytesSent) !== undefined) {
                    const point = { at: entry.timestamp, bytes: num(entry.bytesSent) as number };
                    if (settled && !from) from = point;
                    last = point;
                    sent = num(entry.packetsSent) ?? sent;
                }
                if (entry.type === "remote-inbound-rtp") {
                    const rtt = num(entry.roundTripTime);
                    // Both ends are this browser: the picture goes up to the relay and down, and the report about it
                    // up and down again, twice the trip a call makes.
                    if (settled && rtt !== undefined) rtts.push((rtt * 1000) / 2);
                    lost = Math.max(0, num(entry.packetsLost) ?? lost);
                }
            });
            if (settled && !lostFrom) lostFrom = { lost, sent };
        }
        if (left) return { verdict: "hidden" };
        const seconds = from && last ? (last.at - from.at) / 1000 : 0;
        const callBytes = callFrom !== undefined && callLast !== undefined ? Math.max(0, callLast - callFrom) : 0;
        const uploadKbps =
            from && last && seconds > 0 ? Math.round(((last.bytes - from.bytes + callBytes) * 8) / seconds / 1000) : 0;
        const rttMs = rtts.length ? Math.round([...rtts].sort((a, b) => a - b)[Math.floor(rtts.length / 2)]) : undefined;
        const sentSince = lostFrom ? sent - lostFrom.sent : 0;
        const lossPct =
            lostFrom && sentSince > 50 ? Math.round(((lost - lostFrom.lost) / sentSince) * 1000) / 10 : undefined;
        const troubled = (rttMs ?? 0) >= 400 || (lossPct ?? 0) >= 5;
        // A queue that holds everything a second or more: the upload may be fast, but people hear them late.
        const verdict: ConnectionCheckVerdict =
            uploadKbps < VOICE_KBPS || (lossPct ?? 0) >= 15
                ? "weak"
                : (rttMs ?? 0) >= 1000
                  ? "slow"
                  : uploadKbps >= SHARE_KBPS && !troubled
                    ? "share"
                    : "voice";
        return { verdict, uploadKbps, rttMs, lossPct };
    } catch (e) {
        console.warn("Connection check", e);
        return { verdict: "failed" };
    } finally {
        document.removeEventListener("visibilitychange", onVisibility);
        picture.stop();
        sender.close();
        receiver.close();
    }
}
