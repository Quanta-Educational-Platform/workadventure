// quanta: notes every peer connection the room makes, for the call's quality (callStats.ts). It must run before
// anything that keeps the native constructor at load: simple-peer (WA's P2P calls) does, so svelte.ts imports it first.
// Closed ones are dropped by the sampler. Only inside the platform's frame.
import { QUANTA_UI } from "../Enum/EnvironmentVariable";

export const peerConnections = new Set<RTCPeerConnection>();

const Native = typeof window !== "undefined" ? window.RTCPeerConnection : undefined;
if (QUANTA_UI && Native && window.parent !== window) {
    window.RTCPeerConnection = class QuantaPeerConnection extends Native {
        constructor(configuration?: RTCConfiguration) {
            super(configuration);
            peerConnections.add(this);
        }
    };
}
