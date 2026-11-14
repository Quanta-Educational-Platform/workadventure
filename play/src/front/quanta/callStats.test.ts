import { describe, expect, it, vi } from "vitest";

vi.mock("../Stores/ToastStoreSingleton", () => ({ toastStore: { subscribe: () => () => undefined } }));
vi.mock("./diagnosticContext", () => ({ diagnosticSessionId: "browser-1" }));
vi.mock("./peerConnections", () => ({ peerConnections: new Set() }));

import { sampleCallStats } from "./callStats";

type Audio = { at: number; received: number; samples: number; concealed: number; silent: number };

function connection(...readings: Audio[][]) {
    let n = 0;
    return {
        connectionState: "connected",
        getStats: () => {
            const tracks = readings[Math.min(n++, readings.length - 1)];
            return Promise.resolve(
                new Map(
                    tracks.map((a, i) => [
                        `in-${i}`,
                        {
                            id: `in-${i}`,
                            type: "inbound-rtp",
                            kind: "audio",
                            ssrc: i,
                            trackIdentifier: `mic-${i}`,
                            timestamp: a.at,
                            packetsReceived: a.received,
                            packetsLost: 0,
                            totalSamplesReceived: a.samples,
                            concealedSamples: a.concealed,
                            silentConcealedSamples: a.silent,
                        },
                    ]),
                ),
            );
        },
    } as unknown as RTCPeerConnection;
}

describe("sampleCallStats", () => {
    it("counts audio concealed over silence, and streams that carried nothing, as no lost audio", async () => {
        const speaking = { at: 1000, received: 100, samples: 48_000, concealed: 0, silent: 0 };
        const quiet = { at: 1000, received: 100, samples: 48_000, concealed: 0, silent: 0 };
        const muted = { at: 1000, received: 100, samples: 48_000, concealed: 0, silent: 0 };
        const pc = connection(
            [speaking, quiet, muted],
            [
                // Real loss: 4800 of 960 000 samples concealed, none over silence.
                { at: 21_000, received: 1100, samples: 1_008_000, concealed: 4800, silent: 0 },
                // Silence: all of its concealment was over silence (DTX).
                { at: 21_000, received: 200, samples: 1_008_000, concealed: 500_000, silent: 500_000 },
                // Muted: no packets in the interval, concealment counted on regardless.
                { at: 21_000, received: 100, samples: 1_008_000, concealed: 960_000, silent: 0 },
            ],
        );
        const previous = new WeakMap();
        const connections = new Set([pc]);
        await sampleCallStats(connections, previous);
        const call = await sampleCallStats(connections, previous);
        expect(call?.audioConcealedRatio).toBeCloseTo(4800 / 1_920_000);
    });
});
