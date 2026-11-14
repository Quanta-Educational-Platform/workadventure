import { Subject, Subscription } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    PROXIMITY_FILE_AUTO_ACCEPT_MAX_IMAGE_SIZE,
    ProximityFileTransferService,
    shouldAutoAcceptProximityFile,
    type ProximityFileTransferSpace,
    type ProximityFileTransferUpdate,
} from "../ProximityFileTransferService";

// A WebRTC stand-in: two peer connections link once the offer and its answer are both applied, and their data
// channels deliver messages to each other. Enough to drive the transfer service from both ends.

class FakeDataChannel extends EventTarget {
    readyState: RTCDataChannelState = "connecting";
    binaryType = "arraybuffer";
    bufferedAmount = 0;
    bufferedAmountLowThreshold = 0;
    peer: FakeDataChannel | undefined;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;

    constructor(readonly label: string) {
        super();
    }

    open(): void {
        this.readyState = "open";
        this.onopen?.();
    }

    send(data: unknown): void {
        const peer = this.peer;
        queueMicrotask(() => peer?.readyState === "open" && peer.onmessage?.({ data }));
        if (dropOnFirstChunk && typeof data !== "string") {
            queueMicrotask(() => this.close());
        }
    }

    close(): void {
        if (this.readyState === "closed") {
            return;
        }
        this.readyState = "closed";
        this.onclose?.();
        this.dispatchEvent(new Event("close"));
        this.peer?.close();
    }
}

let peerConnections: FakePeerConnection[] = [];
// Set to close a channel as soon as it carries file data, as when the sender's network drops mid-transfer.
let dropOnFirstChunk = false;
// Set to make every connection fail to link, as when no ICE route (nor relay) works between two peers.
let iceBlocked = false;

class FakePeerConnection {
    private static nextId = 0;
    readonly id = `pc-${FakePeerConnection.nextId++}`;
    connectionState: RTCPeerConnectionState = "new";
    onicecandidate: ((event: { candidate: null }) => void) | null = null;
    ondatachannel: ((event: { channel: FakeDataChannel }) => void) | null = null;
    onconnectionstatechange: (() => void) | null = null;
    channel: FakeDataChannel | undefined;
    remoteId: string | undefined;

    constructor() {
        peerConnections.push(this);
    }

    createDataChannel(label: string): FakeDataChannel {
        this.channel = new FakeDataChannel(label);
        return this.channel;
    }

    createOffer() {
        return Promise.resolve({ type: "offer" as const, sdp: this.id });
    }

    createAnswer() {
        return Promise.resolve({ type: "answer" as const, sdp: this.id });
    }

    setLocalDescription(): Promise<void> {
        return Promise.resolve();
    }

    setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
        this.remoteId = description.sdp;
        if (description.type === "answer" && !iceBlocked) {
            const answerer = peerConnections.find((pc) => pc.id === description.sdp);
            const local = this.channel;
            if (answerer && answerer.remoteId === this.id && local && answerer.connectionState !== "closed") {
                const remote = new FakeDataChannel(local.label);
                local.peer = remote;
                remote.peer = local;
                this.connectionState = "connected";
                answerer.connectionState = "connected";
                answerer.channel = remote;
                answerer.ondatachannel?.({ channel: remote });
                queueMicrotask(() => {
                    remote.open();
                    local.open();
                });
            }
        }
        return Promise.resolve();
    }

    addIceCandidate(): Promise<void> {
        return Promise.resolve();
    }

    getStats(): Promise<Map<string, unknown>> {
        return Promise.resolve(new Map());
    }

    close(): void {
        this.connectionState = "closed";
        this.channel?.close();
    }
}

/** Delivers private space messages between services, the way the back relays them. */
class FakeSignalling {
    private readonly endpoints = new Map<string, Map<string, Subject<unknown>>>();

    space(spaceUserId: string): ProximityFileTransferSpace {
        const subjects = new Map<string, Subject<unknown>>();
        this.endpoints.set(spaceUserId, subjects);
        const subject = (key: string) => {
            const existing = subjects.get(key) ?? new Subject<unknown>();
            subjects.set(key, existing);
            return existing;
        };
        return {
            emitPrivateMessage: (message: { $case: string } & Record<string, unknown>, receiver: string) => {
                const { $case, ...payload } = message;
                // Someone who left receives nothing.
                const target = this.endpoints.get(receiver);
                setTimeout(() => target?.get($case)?.next({ ...payload, sender: { spaceUserId } }), 0);
            },
            observePrivateEvent: (key: string) => subject(key) as never,
        };
    }

    leave(spaceUserId: string): void {
        this.endpoints.delete(spaceUserId);
    }
}

function sendableFile(content: Uint8Array<ArrayBuffer>, name: string, type: string): File {
    return Object.assign(new File([content], name, { type }), {
        stream: () =>
            new ReadableStream<Uint8Array<ArrayBuffer>>({
                start(controller) {
                    controller.enqueue(content);
                    controller.close();
                },
            }),
    });
}

function peer(signalling: FakeSignalling, spaceUserId: string) {
    const service = new ProximityFileTransferService({
        localSpaceUserId: spaceUserId,
        space: signalling.space(spaceUserId),
        getIceServers: () => Promise.resolve([]),
        canExchangeWith: () => true,
    });
    const updates: ProximityFileTransferUpdate[] = [];
    const offers: string[] = [];
    subscriptions.add(service.transferUpdates.subscribe((update) => updates.push(update)));
    subscriptions.add(service.incomingOffers.subscribe((offer) => offers.push(offer.transferId)));
    const lastState = (transferId: string) => updates.filter((u) => u.transferId === transferId).at(-1);
    return { service, updates, offers, lastState };
}

let subscriptions = new Subscription();

const PHOTO = new Uint8Array(70 * 1024).fill(7);

describe("proximity file transfer over a connection", () => {
    let signalling: FakeSignalling;

    beforeEach(() => {
        peerConnections = [];
        iceBlocked = false;
        dropOnFirstChunk = false;
        subscriptions = new Subscription();
        signalling = new FakeSignalling();
        vi.stubGlobal("RTCPeerConnection", FakePeerConnection);
        vi.stubGlobal("URL", { createObjectURL: vi.fn().mockReturnValue("blob:photo") });
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        subscriptions.unsubscribe();
    });

    it("delivers a photo from one end to the other", async () => {
        const sender = peer(signalling, "a-sender");
        const recipient = peer(signalling, "b-recipient");
        const [offer] = sender.service.createOutgoingOffers(
            [sendableFile(PHOTO, "p.jpg", "image/jpeg")],
            ["b-recipient"],
        );
        await vi.waitFor(() => expect(recipient.offers).toEqual([offer.transferId]));

        await recipient.service.download(offer.transferId);

        await vi.waitFor(() => expect(recipient.lastState(offer.transferId)?.state).toBe("ready"));
    });

    it("downloads several photos from one sender over a single connection", async () => {
        const sender = peer(signalling, "a-sender");
        const recipient = peer(signalling, "b-recipient");
        const offers = sender.service.createOutgoingOffers(
            [1, 2, 3].map((n) => sendableFile(PHOTO, `p${n}.jpg`, "image/jpeg")),
            ["b-recipient"],
        );
        await vi.waitFor(() => expect(recipient.offers).toHaveLength(3));

        await Promise.all(offers.map((offer) => recipient.service.download(offer.transferId)));

        await vi.waitFor(() =>
            expect(offers.map((offer) => recipient.lastState(offer.transferId)?.state)).toEqual([
                "ready",
                "ready",
                "ready",
            ]),
        );
        expect(peerConnections).toHaveLength(2);
    });

    it("says it could not connect when no route to the sender works, and can be tried again", async () => {
        vi.useFakeTimers();
        const sender = peer(signalling, "a-sender");
        const recipient = peer(signalling, "b-recipient");
        const [offer] = sender.service.createOutgoingOffers(
            [sendableFile(PHOTO, "p.jpg", "image/jpeg")],
            ["b-recipient"],
        );
        await vi.advanceTimersByTimeAsync(1);
        iceBlocked = true;

        const download = recipient.service.download(offer.transferId);
        await vi.advanceTimersByTimeAsync(15_000);
        await download;
        expect(recipient.lastState(offer.transferId)).toMatchObject({ state: "error", error: "connection" });

        iceBlocked = false;
        const retry = recipient.service.download(offer.transferId);
        await vi.advanceTimersByTimeAsync(10);
        await retry;
        await vi.waitFor(() => expect(recipient.lastState(offer.transferId)?.state).toBe("ready"));
    });

    it("says it could not connect when the sender left before the photo was accepted", async () => {
        vi.useFakeTimers();
        const sender = peer(signalling, "a-sender");
        const recipient = peer(signalling, "b-recipient");
        const [offer] = sender.service.createOutgoingOffers(
            [sendableFile(PHOTO, "p.jpg", "image/jpeg")],
            ["b-recipient"],
        );
        await vi.advanceTimersByTimeAsync(1);
        sender.service.destroy();
        signalling.leave("a-sender");

        const download = recipient.service.download(offer.transferId);
        await vi.advanceTimersByTimeAsync(15_000);
        await download;

        expect(recipient.lastState(offer.transferId)).toMatchObject({ state: "error", error: "connection" });
    });

    it("says the transfer was interrupted when the connection drops mid-way", async () => {
        const sender = peer(signalling, "a-sender");
        const recipient = peer(signalling, "b-recipient");
        const [offer] = sender.service.createOutgoingOffers(
            [sendableFile(PHOTO, "p.jpg", "image/jpeg")],
            ["b-recipient"],
        );
        await vi.waitFor(() => expect(recipient.offers).toHaveLength(1));
        dropOnFirstChunk = true;

        await recipient.service.download(offer.transferId);

        await vi.waitFor(() =>
            expect(recipient.lastState(offer.transferId)).toMatchObject({ state: "error", error: "interrupted" }),
        );
    });

    it("connects both ways when two people fetch each other's photo at the same moment", async () => {
        const first = peer(signalling, "a-first");
        const second = peer(signalling, "b-second");
        const [fromFirst] = first.service.createOutgoingOffers(
            [sendableFile(PHOTO, "1.jpg", "image/jpeg")],
            ["b-second"],
        );
        const [fromSecond] = second.service.createOutgoingOffers(
            [sendableFile(PHOTO, "2.jpg", "image/jpeg")],
            ["a-first"],
        );
        await vi.waitFor(() => {
            expect(first.offers).toHaveLength(1);
            expect(second.offers).toHaveLength(1);
        });

        await Promise.all([
            first.service.download(fromSecond.transferId),
            second.service.download(fromFirst.transferId),
        ]);

        await vi.waitFor(() => {
            expect(first.lastState(fromSecond.transferId)?.state).toBe("ready");
            expect(second.lastState(fromFirst.transferId)?.state).toBe("ready");
        });
    });

    it("asks the sender once when Accept is pressed again while connecting", async () => {
        const sender = peer(signalling, "a-sender");
        const recipient = peer(signalling, "b-recipient");
        const [offer] = sender.service.createOutgoingOffers(
            [sendableFile(PHOTO, "p.jpg", "image/jpeg")],
            ["b-recipient"],
        );
        await vi.waitFor(() => expect(recipient.offers).toHaveLength(1));
        const sent = vi.spyOn(FakeDataChannel.prototype, "send");

        await Promise.all([recipient.service.download(offer.transferId), recipient.service.download(offer.transferId)]);

        await vi.waitFor(() => expect(recipient.lastState(offer.transferId)?.state).toBe("ready"));
        const requests = sent.mock.calls.filter(([data]) => typeof data === "string" && data.includes("request"));
        expect(requests).toHaveLength(1);
    });

    it("reports an offer it no longer knows as unavailable instead of throwing", async () => {
        const recipient = peer(signalling, "b-recipient");

        await expect(recipient.service.download("gone")).resolves.toBeUndefined();
        expect(recipient.lastState("gone")).toMatchObject({ state: "error", error: "unavailable" });
    });
});

describe("shouldAutoAcceptProximityFile", () => {
    it("fetches small inline images without asking", () => {
        expect(shouldAutoAcceptProximityFile({ mimeType: "image/jpeg", size: 2_000_000 })).toBe(true);
        expect(
            shouldAutoAcceptProximityFile({ mimeType: "image/png", size: PROXIMITY_FILE_AUTO_ACCEPT_MAX_IMAGE_SIZE }),
        ).toBe(true);
    });

    it("still asks for large images, other files and types the chat cannot show", () => {
        expect(
            shouldAutoAcceptProximityFile({
                mimeType: "image/jpeg",
                size: PROXIMITY_FILE_AUTO_ACCEPT_MAX_IMAGE_SIZE + 1,
            }),
        ).toBe(false);
        expect(shouldAutoAcceptProximityFile({ mimeType: "application/pdf", size: 1000 })).toBe(false);
        expect(shouldAutoAcceptProximityFile({ mimeType: "image/heic", size: 1000 })).toBe(false);
        expect(shouldAutoAcceptProximityFile({ mimeType: "image/svg+xml", size: 1000 })).toBe(false);
    });
});
