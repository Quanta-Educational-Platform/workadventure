import type { ProximityFileTransferOfferMessage } from "@workadventure/messages";
import type { Observable } from "rxjs";
import { Subject, Subscription } from "rxjs";
import { v4 as uuidv4 } from "uuid";
import type { SpaceInterface } from "../../../Space/SpaceInterface";
import { sanitizeInlineMimeType } from "../../../Utils/InlineMimeType";
import { getSelectedIceRoute, type SelectedIceRoute } from "../../../WebRtc/SelectedIceRoute";
import { ProximityFileStorage, type ProximityFileSink } from "./ProximityFileStorage";
import {
    decodeProximityFileChunkFrame,
    decodeProximityFileControlMessage,
    encodeProximityFileChunkFrame,
    type ProximityFileTransferControlMessage,
} from "./ProximityFileTransferProtocol";

// The data channel is DTLS-encrypted and authenticated end to end, so files travel as is: no
// application-level encryption or hash would protect against anything DTLS does not already cover.

export const PROXIMITY_FILE_TRANSFER_MAX_FILES = 3;
// Maximum allowed size for a proximity file transfer: 1 GB. Bounds what a peer can make us
// write to disk, and how long a transfer over a TURN relay takes.
export const PROXIMITY_FILE_TRANSFER_MAX_FILE_SIZE = 1024 * 1024 * 1024;
// Upper bound on undownloaded offers a single peer may have pending at once. Offers are
// remote-controlled (each surfaces a chat message + notification), so this throttles a peer
// from flooding the recipient with offers and growing the incomingTransfers map unbounded.
export const PROXIMITY_FILE_TRANSFER_MAX_INCOMING_OFFERS_PER_PEER = 20;
const PROXIMITY_FILE_TRANSFER_CHUNK_SIZE = 64 * 1024;
const PROXIMITY_FILE_TRANSFER_BUFFERED_AMOUNT_LOW_THRESHOLD = 256 * 1024;
const PROXIMITY_FILE_TRANSFER_NEGOTIATION_TIMEOUT = 15_000;
// Images up to this size are fetched without asking: in a class a photo of a solution is the common case,
// and one behind an "Accept" button reads as a file that never shows.
export const PROXIMITY_FILE_AUTO_ACCEPT_MAX_IMAGE_SIZE = 8 * 1024 * 1024;

/**
 * Why an incoming file could not be had. "connection": no connection to the sender could be made (a firewall,
 * the relay); "interrupted": the connection dropped mid-way; "unavailable": the sender no longer offers it.
 */
export type ProximityFileTransferFailure =
    | "connection"
    | "interrupted"
    | "unavailable"
    | "incomplete"
    | "write-failed"
    | "file-too-large";

export type ProximityFileValidationResult = { tooManyFiles: boolean; tooLargeFiles: File[] };

export function validateProximityFiles(files: File[]): ProximityFileValidationResult {
    return {
        tooManyFiles: files.length > PROXIMITY_FILE_TRANSFER_MAX_FILES,
        tooLargeFiles: files.filter((file) => file.size > PROXIMITY_FILE_TRANSFER_MAX_FILE_SIZE),
    };
}

export type IncomingProximityFileTransferOffer = ProximityFileTransferOfferMessage & {
    senderSpaceUserId: string;
};

/** Whether an offer is fetched as soon as it arrives: small images that the chat can show inline. */
export function shouldAutoAcceptProximityFile(offer: Pick<IncomingProximityFileTransferOffer, "mimeType" | "size">) {
    return (
        getMessageTypeFromMimeType(offer.mimeType) === "image" &&
        offer.size <= PROXIMITY_FILE_AUTO_ACCEPT_MAX_IMAGE_SIZE
    );
}

export type ProximityFileTransferUpdate =
    | {
          transferId: string;
          state: "pending" | "connecting" | "downloading";
          progress: number;
      }
    | {
          transferId: string;
          state: "ready";
          progress: 1;
          url: string;
          /** From the first byte to the last, so the recipient's decision and the connection setup are left out. */
          durationMs: number;
          /** Undefined when the browser does not report the connection path. */
          route: SelectedIceRoute | undefined;
      }
    | {
          transferId: string;
          state: "error";
          progress: number;
          error: ProximityFileTransferFailure | string;
      };

export type ProximityFileTransferOffer = {
    transferId: string;
    file: File;
    recipients: string[];
};

/** How one recipient's copy of an outgoing file is doing. */
export type OutgoingProximityFileTransferUpdate = {
    transferId: string;
    recipientSpaceUserId: string;
    state: "sending" | "received" | "declined" | "failed";
    progress: number;
};

type ProximityFileTransferSignalPayload =
    | { type: "delete" }
    | {
          type: "description";
          description: RTCSessionDescriptionInit;
      }
    | {
          type: "candidate";
          candidate: RTCIceCandidateInit;
      };

type ProximityFileTransferSignalMessage = { transferId: string; connectionId: string; signal: string };

export type ProximityFileTransferSpace = Pick<SpaceInterface, "emitPrivateMessage" | "observePrivateEvent">;

export type ProximityFileTransferServiceOptions = {
    localSpaceUserId: string;
    space: ProximityFileTransferSpace;
    getIceServers: () => Promise<RTCIceServer[]>;
    canExchangeWith: (spaceUserId: string) => boolean;
};

type PeerSession = {
    remoteSpaceUserId: string;
    connectionId: string;
    /** Whether we made the offer, rather than answering the peer's. */
    initiator: boolean;
    peerConnection: RTCPeerConnection;
    dataChannel: RTCDataChannel | undefined;
    openPromise: Promise<RTCDataChannel>;
    resolveOpen: (dataChannel: RTCDataChannel) => void;
    rejectOpen: (error: Error) => void;
    // Inbound messages are processed one at a time, so a transfer's start, chunks and completion are
    // handled in order; outbound transfers to the same peer are sent one after the other.
    inboundQueue: Promise<void>;
    outboundQueue: Promise<void>;
    negotiationTimeout: ReturnType<typeof setTimeout>;
    // Outgoing transfers fully sent to this peer but not acknowledged yet: they fail if the session closes.
    awaitingReceipt: Set<string>;
    signalTransferId: string;
    canEmitCandidates: boolean;
    pendingCandidates: RTCIceCandidateInit[];
};

type ReceivingTransfer = {
    offer: IncomingProximityFileTransferOffer;
    receivedBytes: number;
    sink: ProximityFileSink;
    startedAt: number;
};

export class ProximityFileTransferService {
    private readonly incomingOwners = new Map<string, string>();
    private readonly deletedTransfers = new Set<string>();
    private readonly outgoingAbort = new Map<string, AbortController>();
    private readonly deletionSubject = new Subject<string>();
    public readonly deletions: Observable<string> = this.deletionSubject;
    private readonly outgoingTransfers = new Map<string, ProximityFileTransferOffer>();
    private readonly incomingTransfers = new Map<string, IncomingProximityFileTransferOffer>();
    private readonly completedSinks = new Map<string, ProximityFileSink>();
    private readonly receivingTransfers = new Map<string, ReceivingTransfer>();
    private readonly peerSessions = new Map<string, PeerSession>();
    // Connections being set up, so that several downloads from one sender share one.
    private readonly initiatingSessions = new Map<string, Promise<PeerSession>>();
    // Requested from the sender, not started yet: by transferId, the sender's spaceUserId.
    private readonly requestedTransfers = new Map<string, string>();
    // Downloads still connecting: a second Accept must not ask the sender twice.
    private readonly connectingTransfers = new Set<string>();
    private readonly storage = new ProximityFileStorage();
    private readonly subscriptions = new Subscription();
    private readonly incomingOfferSubject = new Subject<IncomingProximityFileTransferOffer>();
    public readonly incomingOffers: Observable<IncomingProximityFileTransferOffer> = this.incomingOfferSubject;
    private readonly transferUpdateSubject = new Subject<ProximityFileTransferUpdate>();
    public readonly transferUpdates: Observable<ProximityFileTransferUpdate> = this.transferUpdateSubject;
    private readonly outgoingUpdateSubject = new Subject<OutgoingProximityFileTransferUpdate>();
    public readonly outgoingUpdates: Observable<OutgoingProximityFileTransferUpdate> = this.outgoingUpdateSubject;

    constructor(private readonly options: ProximityFileTransferServiceOptions) {
        this.subscriptions.add(
            this.options.space.observePrivateEvent("proximityFileTransferOffer").subscribe((event) => {
                const senderSpaceUserId = event.sender.spaceUserId;
                if (senderSpaceUserId === this.options.localSpaceUserId) {
                    return;
                }
                const offer = {
                    ...event.proximityFileTransferOffer,
                    senderSpaceUserId,
                };
                // Could never be accepted, so not worth a card.
                if (offer.size > PROXIMITY_FILE_TRANSFER_MAX_FILE_SIZE) {
                    return;
                }
                // A transferId belongs to the peer that first offered it: another peer re-offering
                // the same id must not be able to take over the card shown for the first sender.
                const owner = this.incomingOwners.get(offer.transferId);
                if (
                    this.deletedTransfers.has(offer.transferId) ||
                    this.outgoingTransfers.has(offer.transferId) ||
                    (owner && owner !== senderSpaceUserId)
                ) {
                    return;
                }
                // Throttle a peer that floods us with offers. Re-offering a known transferId just
                // refreshes it (the count is per distinct transferId), so legitimate retries are fine.
                if (
                    !this.incomingTransfers.has(offer.transferId) &&
                    this.countIncomingOffersFromSender(senderSpaceUserId) >=
                        PROXIMITY_FILE_TRANSFER_MAX_INCOMING_OFFERS_PER_PEER
                ) {
                    return;
                }
                this.incomingOwners.set(offer.transferId, senderSpaceUserId);
                this.incomingTransfers.set(offer.transferId, offer);
                this.transferUpdateSubject.next({ transferId: offer.transferId, state: "pending", progress: 0 });
                this.incomingOfferSubject.next(offer);
            }),
        );
        // Free the per-peer offer slot once a download finishes, so completing transfers do not
        // count against the cap.
        this.subscriptions.add(
            this.transferUpdateSubject.subscribe((update) => {
                if (update.state === "ready") {
                    this.incomingTransfers.delete(update.transferId);
                }
            }),
        );
        this.subscriptions.add(
            this.options.space.observePrivateEvent("proximityFileTransferDecline").subscribe((event) => {
                this.emitOutgoingUpdate(
                    event.proximityFileTransferDecline.transferId,
                    event.sender.spaceUserId,
                    "declined",
                    0,
                );
            }),
        );
        this.subscriptions.add(
            this.options.space.observePrivateEvent("proximityFileTransferSignal").subscribe((event) => {
                this.handleSignal(event.sender.spaceUserId, event.proximityFileTransferSignal).catch((error) => {
                    console.error("Error while handling proximity file transfer signal", error);
                });
            }),
        );
    }

    createOutgoingOffers(files: File[], recipients: string[]): ProximityFileTransferOffer[] {
        const validation = validateProximityFiles(files);
        if (validation.tooManyFiles) {
            throw new Error("too-many-files");
        }
        if (validation.tooLargeFiles.length > 0) {
            throw new Error("file-too-large");
        }

        const recipientIds = recipients.filter((spaceUserId) => spaceUserId !== this.options.localSpaceUserId);
        // The file itself stays on disk (a File is not loaded in memory); it is streamed each time a
        // recipient requests it.
        const offers = files.map((file) => ({ transferId: uuidv4(), file, recipients: recipientIds }));

        for (const offer of offers) {
            this.outgoingTransfers.set(offer.transferId, offer);
            this.outgoingAbort.set(offer.transferId, new AbortController());
            for (const recipientId of recipientIds) {
                this.options.space.emitPrivateMessage(
                    {
                        $case: "proximityFileTransferOffer",
                        proximityFileTransferOffer: {
                            transferId: offer.transferId,
                            fileName: offer.file.name,
                            mimeType: offer.file.type,
                            size: offer.file.size,
                            characterTextures: [],
                            name: undefined,
                        },
                    },
                    recipientId,
                );
            }
        }
        return offers;
    }

    /** Never rejects: a failure is reported as an "error" update, for the card to say so and offer a retry. */
    async download(transferId: string): Promise<void> {
        const offer = this.incomingTransfers.get(transferId);
        if (!offer) {
            this.transferUpdateSubject.next({ transferId, state: "error", progress: 0, error: "unavailable" });
            return;
        }
        if (
            this.connectingTransfers.has(transferId) ||
            this.requestedTransfers.has(transferId) ||
            this.receivingTransfers.has(transferId)
        ) {
            return;
        }

        this.transferUpdateSubject.next({ transferId, state: "connecting", progress: 0 });
        this.connectingTransfers.add(transferId);
        try {
            const session = await this.ensureInitiatorPeerSession(offer.senderSpaceUserId, transferId);
            const dataChannel = await this.openedChannel(session);
            if (this.deletedTransfers.has(transferId)) return;
            this.requestedTransfers.set(transferId, offer.senderSpaceUserId);
            this.sendControlMessage(dataChannel, { type: "proximity_file_request", transferId });
        } catch (error) {
            console.warn("Unable to reach the sender of a proximity file", error);
            this.requestedTransfers.delete(transferId);
            this.transferUpdateSubject.next({ transferId, state: "error", progress: 0, error: "connection" });
        } finally {
            this.connectingTransfers.delete(transferId);
        }
    }

    /** Tells the sender this offer is declined, so they do not wait for it. */
    decline(transferId: string): void {
        const offer = this.incomingTransfers.get(transferId);
        if (!offer) {
            return;
        }
        // A declined offer no longer counts against the sender's pending-offer cap either.
        this.incomingTransfers.delete(transferId);
        this.options.space.emitPrivateMessage(
            { $case: "proximityFileTransferDecline", proximityFileTransferDecline: { transferId } },
            offer.senderSpaceUserId,
        );
    }

    /** Only the author can withdraw an offer; space signalling authenticates that author to recipients. */
    deleteOutgoing(transferId: string): void {
        const transfer = this.outgoingTransfers.get(transferId);
        if (!transfer) return;
        this.revokeTransfer(transferId);
        for (const recipient of transfer.recipients) {
            this.emitSignal(recipient, transferId, "", { type: "delete" });
        }
    }

    private revokeTransfer(transferId: string): void {
        this.deletedTransfers.add(transferId);
        this.outgoingAbort.get(transferId)?.abort();
        this.outgoingAbort.delete(transferId);
        this.outgoingTransfers.delete(transferId);
        this.incomingTransfers.delete(transferId);
        this.connectingTransfers.delete(transferId);
        this.failReceivingTransfer(transferId, "unavailable");
        this.completedSinks
            .get(transferId)
            ?.discard()
            .catch((error) => console.warn("Unable to discard deleted file", error));
        this.completedSinks.delete(transferId);
        for (const session of this.peerSessions.values()) session.awaitingReceipt.delete(transferId);
        this.deletionSubject.next(transferId);
    }

    destroy(): void {
        this.subscriptions.unsubscribe();
        this.incomingOfferSubject.complete();
        this.transferUpdateSubject.complete();
        this.outgoingUpdateSubject.complete();
        for (const controller of this.outgoingAbort.values()) controller.abort();
        this.outgoingAbort.clear();
        this.incomingOwners.clear();
        this.deletedTransfers.clear();
        this.deletionSubject.complete();
        this.outgoingTransfers.clear();
        this.incomingTransfers.clear();
        this.receivingTransfers.clear();
        this.completedSinks.clear();
        this.requestedTransfers.clear();
        this.connectingTransfers.clear();
        this.initiatingSessions.clear();
        this.storage.destroy().catch((error) => console.warn("Unable to clean up proximity file storage", error));
        for (const session of this.peerSessions.values()) {
            clearTimeout(session.negotiationTimeout);
            session.dataChannel?.close();
            session.peerConnection.close();
        }
        this.peerSessions.clear();
    }

    private async openedChannel(session: PeerSession): Promise<RTCDataChannel> {
        try {
            return await session.openPromise;
        } catch (error) {
            // Both ends offered at once and ours gave way to the peer's: that connection carries this request too.
            const successor = this.peerSessions.get(session.remoteSpaceUserId);
            if (successor && successor !== session) {
                return successor.openPromise;
            }
            throw error;
        }
    }

    private ensureInitiatorPeerSession(remoteSpaceUserId: string, transferId: string): Promise<PeerSession> {
        const existingSession = this.peerSessions.get(remoteSpaceUserId);
        if (existingSession) {
            return Promise.resolve(existingSession);
        }
        const initiating = this.initiatingSessions.get(remoteSpaceUserId);
        if (initiating) {
            return initiating;
        }
        const creation = this.createInitiatorPeerSession(remoteSpaceUserId, transferId).finally(() => {
            this.initiatingSessions.delete(remoteSpaceUserId);
        });
        this.initiatingSessions.set(remoteSpaceUserId, creation);
        return creation;
    }

    private async createInitiatorPeerSession(remoteSpaceUserId: string, transferId: string): Promise<PeerSession> {
        const session = await this.createPeerSession(remoteSpaceUserId, uuidv4(), true);
        // The peer connected to us while the ICE servers were fetched: share its connection.
        const raced = this.peerSessions.get(remoteSpaceUserId);
        if (raced) {
            clearTimeout(session.negotiationTimeout);
            session.peerConnection.close();
            return raced;
        }
        const dataChannel = session.peerConnection.createDataChannel("proximity-file-transfer");
        this.bindDataChannel(session, dataChannel);
        this.peerSessions.set(remoteSpaceUserId, session);

        const offer = await session.peerConnection.createOffer();
        await session.peerConnection.setLocalDescription(offer);
        this.emitSignal(remoteSpaceUserId, transferId, session.connectionId, {
            type: "description",
            description: offer,
        });
        this.enableCandidateEmission(session, transferId);

        return session;
    }

    private async createPeerSession(
        remoteSpaceUserId: string,
        connectionId: string,
        initiator: boolean,
    ): Promise<PeerSession> {
        const peerConnection = new RTCPeerConnection({ iceServers: await this.options.getIceServers() });
        let resolveOpen!: (dataChannel: RTCDataChannel) => void;
        let rejectOpen!: (error: Error) => void;
        const openPromise = new Promise<RTCDataChannel>((resolve, reject) => {
            resolveOpen = resolve;
            rejectOpen = reject;
        });
        // The answering side never awaits it: its failure must not surface as an unhandled rejection.
        openPromise.catch(() => undefined);
        const session: PeerSession = {
            remoteSpaceUserId,
            connectionId,
            initiator,
            peerConnection,
            dataChannel: undefined,
            openPromise,
            resolveOpen,
            rejectOpen,
            inboundQueue: Promise.resolve(),
            outboundQueue: Promise.resolve(),
            awaitingReceipt: new Set(),
            signalTransferId: "",
            canEmitCandidates: false,
            pendingCandidates: [],
            negotiationTimeout: setTimeout(() => {
                rejectOpen(new Error("Proximity file transfer connection timeout"));
                this.closePeerSession(remoteSpaceUserId, session);
            }, PROXIMITY_FILE_TRANSFER_NEGOTIATION_TIMEOUT),
        };

        peerConnection.onicecandidate = (event) => {
            if (!event.candidate) {
                return;
            }
            const candidate = event.candidate.toJSON();
            if (!session.canEmitCandidates) {
                session.pendingCandidates.push(candidate);
                return;
            }
            this.emitSignal(remoteSpaceUserId, session.signalTransferId, connectionId, {
                type: "candidate",
                candidate,
            });
        };
        peerConnection.ondatachannel = (event) => {
            this.bindDataChannel(session, event.channel);
        };
        peerConnection.onconnectionstatechange = () => {
            if (peerConnection.connectionState === "failed" || peerConnection.connectionState === "closed") {
                this.closePeerSession(remoteSpaceUserId, session);
            }
        };
        return session;
    }

    private bindDataChannel(session: PeerSession, dataChannel: RTCDataChannel): void {
        dataChannel.binaryType = "arraybuffer";
        dataChannel.bufferedAmountLowThreshold = PROXIMITY_FILE_TRANSFER_BUFFERED_AMOUNT_LOW_THRESHOLD;
        session.dataChannel = dataChannel;
        dataChannel.onopen = () => {
            clearTimeout(session.negotiationTimeout);
            session.resolveOpen(dataChannel);
        };
        dataChannel.onerror = () => {
            session.rejectOpen(new Error("Proximity file transfer data channel error"));
        };
        dataChannel.onmessage = (event) => {
            session.inboundQueue = session.inboundQueue
                .then(() => this.handleDataChannelMessage(session, event.data))
                .catch((error) => {
                    console.error("Error while handling proximity file transfer data channel message", error);
                });
        };
        dataChannel.onclose = () => {
            this.closePeerSession(session.remoteSpaceUserId, session);
        };
    }

    private async handleSignal(
        senderSpaceUserId: string,
        signalMessage: ProximityFileTransferSignalMessage,
    ): Promise<void> {
        const signal = JSON.parse(signalMessage.signal) as ProximityFileTransferSignalPayload;
        if (signal.type === "delete") {
            if (this.incomingOwners.get(signalMessage.transferId) === senderSpaceUserId) {
                this.revokeTransfer(signalMessage.transferId);
            }
            return;
        }
        if (!this.options.canExchangeWith(senderSpaceUserId)) return;
        let session = this.peerSessions.get(senderSpaceUserId);

        if (signal.type === "description" && signal.description.type === "offer") {
            // Both ends offered at once (each downloading from the other): the one with the greater id keeps
            // its offer, the other answers it. Closing both would leave neither connected.
            if (
                session?.initiator &&
                session.dataChannel?.readyState !== "open" &&
                this.options.localSpaceUserId > senderSpaceUserId
            ) {
                return;
            }
            // A new negotiation supersedes any existing session for this peer. The previous one is closed so
            // we don't leak its RTCPeerConnection and negotiation timer (a remote peer could otherwise force
            // unbounded allocations by replaying offers), once its successor is in place for the downloads
            // that were waiting on it.
            const previous = session;
            session = await this.createPeerSession(senderSpaceUserId, signalMessage.connectionId, false);
            this.peerSessions.set(senderSpaceUserId, session);
            if (previous) {
                this.shutDownSession(previous, true);
            }
            await session.peerConnection.setRemoteDescription(signal.description);
            const answer = await session.peerConnection.createAnswer();
            await session.peerConnection.setLocalDescription(answer);
            this.emitSignal(senderSpaceUserId, signalMessage.transferId, session.connectionId, {
                type: "description",
                description: answer,
            });
            this.enableCandidateEmission(session, signalMessage.transferId);
            return;
        }

        if (!session || session.connectionId !== signalMessage.connectionId) {
            return;
        }

        if (signal.type === "description") {
            await session.peerConnection.setRemoteDescription(signal.description);
            return;
        }

        await session.peerConnection.addIceCandidate(signal.candidate);
    }

    private async handleDataChannelMessage(session: PeerSession, data: unknown): Promise<void> {
        if (typeof data === "string") {
            const message = decodeProximityFileControlMessage(data);
            switch (message.type) {
                case "proximity_file_request": {
                    await this.enqueueOutgoingTransfer(session, message.transferId);
                    break;
                }
                case "proximity_file_start": {
                    const offer = this.incomingOfferFrom(session, message.transferId);
                    if (!offer) {
                        return;
                    }
                    const wasRequested = this.requestedTransfers.has(message.transferId);
                    const sink = await this.storage.createSink(message.transferId);
                    // The connection dropped while the file was being opened, and its failure is already reported.
                    if (wasRequested && !this.requestedTransfers.has(message.transferId)) {
                        await sink.discard().catch(() => undefined);
                        return;
                    }
                    this.requestedTransfers.delete(message.transferId);
                    this.receivingTransfers.set(message.transferId, {
                        offer,
                        receivedBytes: 0,
                        sink,
                        startedAt: performance.now(),
                    });
                    this.transferUpdateSubject.next({
                        transferId: message.transferId,
                        state: "downloading",
                        progress: 0,
                    });
                    break;
                }
                case "proximity_file_complete": {
                    if (this.receivingTransferFrom(session, message.transferId)) {
                        await this.completeReceivingTransfer(session, message.transferId);
                    }
                    break;
                }
                case "proximity_file_received": {
                    if (session.awaitingReceipt.delete(message.transferId)) {
                        this.emitOutgoingUpdate(message.transferId, session.remoteSpaceUserId, "received", 1);
                    }
                    break;
                }
                case "proximity_file_error": {
                    if (this.incomingOfferFrom(session, message.transferId)) {
                        this.failReceivingTransfer(message.transferId, message.reason);
                    }
                    break;
                }
                default: {
                    const _exhaustiveCheck: never = message;
                }
            }
            return;
        }

        const frame = decodeProximityFileChunkFrame(data as ArrayBuffer | ArrayBufferView);
        const receivingTransfer = this.receivingTransferFrom(session, frame.transferId);
        if (!receivingTransfer) {
            return;
        }
        const expectedBytes = receivingTransfer.offer.size;
        const nextReceivedBytes = receivingTransfer.receivedBytes + frame.chunk.byteLength;
        if (nextReceivedBytes > expectedBytes) {
            this.failReceivingTransfer(frame.transferId, "file-too-large");
            return;
        }
        try {
            await receivingTransfer.sink.write(frame.chunk);
        } catch {
            this.failReceivingTransfer(frame.transferId, "write-failed");
            return;
        }
        receivingTransfer.receivedBytes = nextReceivedBytes;
        this.transferUpdateSubject.next({
            transferId: frame.transferId,
            state: "downloading",
            progress: nextReceivedBytes / Math.max(expectedBytes, 1),
        });
    }

    private enqueueOutgoingTransfer(session: PeerSession, transferId: string): Promise<void> {
        session.outboundQueue = session.outboundQueue.then(() => this.sendOutgoingTransfer(session, transferId));
        return session.outboundQueue;
    }

    private async sendOutgoingTransfer(session: PeerSession, transferId: string): Promise<void> {
        const transfer = this.outgoingTransfers.get(transferId);
        const dataChannel = session.dataChannel;
        const signal = this.outgoingAbort.get(transferId)?.signal;
        if (
            !signal ||
            !transfer ||
            !dataChannel ||
            !transfer.recipients.includes(session.remoteSpaceUserId) ||
            !this.options.canExchangeWith(session.remoteSpaceUserId)
        ) {
            if (dataChannel) {
                this.sendControlMessage(dataChannel, {
                    type: "proximity_file_error",
                    transferId,
                    reason: "unavailable",
                });
            }
            this.emitOutgoingUpdate(transferId, session.remoteSpaceUserId, "failed", 0);
            return;
        }

        this.sendControlMessage(dataChannel, { type: "proximity_file_start", transferId });
        this.emitOutgoingUpdate(transferId, session.remoteSpaceUserId, "sending", 0);

        const size = transfer.file.size;
        let sentBytes = 0;
        try {
            // The stream reads ahead from disk, and pausing write() on backpressure pauses the reads too. Its
            // chunks have browser-chosen sizes (Chromium goes up to several hundred KB), so they are re-split
            // to stay under the data channel's maximum message size.
            await transfer.file.stream().pipeTo(
                new WritableStream<Uint8Array>({
                    write: async (chunk) => {
                        for (let offset = 0; offset < chunk.byteLength; offset += PROXIMITY_FILE_TRANSFER_CHUNK_SIZE) {
                            signal.throwIfAborted();
                            const frame = chunk.subarray(offset, offset + PROXIMITY_FILE_TRANSFER_CHUNK_SIZE);
                            dataChannel.send(encodeProximityFileChunkFrame(transferId, frame));
                            sentBytes += frame.byteLength;
                            // Count what has left our buffer, not what was merely queued in it.
                            this.emitOutgoingUpdate(
                                transferId,
                                session.remoteSpaceUserId,
                                "sending",
                                Math.max(0, sentBytes - dataChannel.bufferedAmount) / Math.max(size, 1),
                            );
                            // eslint-disable-next-line no-await-in-loop -- chunks must be sent in order
                            await this.waitForBackpressure(dataChannel, signal);
                        }
                    },
                }),
                { signal },
            );
        } catch (error) {
            if (signal.aborted) return;
            // The file changed or vanished on disk since the offer was made, or the recipient left.
            console.error("Error while sending proximity file transfer", error);
            if (dataChannel.readyState === "open") {
                this.sendControlMessage(dataChannel, {
                    type: "proximity_file_error",
                    transferId,
                    reason: "unavailable",
                });
            }
            this.emitOutgoingUpdate(transferId, session.remoteSpaceUserId, "failed", 0);
            return;
        }

        if (signal.aborted) return;
        session.awaitingReceipt.add(transferId);
        this.sendControlMessage(dataChannel, { type: "proximity_file_complete", transferId });
    }

    private async completeReceivingTransfer(session: PeerSession, transferId: string): Promise<void> {
        const receivingTransfer = this.receivingTransfers.get(transferId);
        if (!receivingTransfer) {
            return;
        }
        if (receivingTransfer.receivedBytes !== receivingTransfer.offer.size) {
            this.failReceivingTransfer(transferId, "incomplete");
            return;
        }
        let blob: Blob;
        try {
            blob = await receivingTransfer.sink.finish(sanitizeInlineMimeType(receivingTransfer.offer.mimeType));
        } catch {
            this.failReceivingTransfer(transferId, "write-failed");
            return;
        }
        if (this.deletedTransfers.has(transferId)) {
            await receivingTransfer.sink.discard().catch(() => undefined);
            return;
        }
        this.completedSinks.set(transferId, receivingTransfer.sink);
        this.receivingTransfers.delete(transferId);
        const durationMs = Math.round(performance.now() - receivingTransfer.startedAt);
        // Read before the receipt: once the sender has it, it may close the connection.
        let route: SelectedIceRoute | undefined;
        try {
            route = getSelectedIceRoute(await session.peerConnection.getStats());
        } catch (error) {
            console.warn("Unable to read how a proximity file transfer travelled", error);
        }
        if (this.deletedTransfers.has(transferId)) return;
        if (session.dataChannel?.readyState === "open") {
            this.sendControlMessage(session.dataChannel, { type: "proximity_file_received", transferId });
        }
        this.transferUpdateSubject.next({
            transferId,
            state: "ready",
            progress: 1,
            url: URL.createObjectURL(blob),
            durationMs,
            route,
        });
    }

    private failReceivingTransfer(transferId: string, error: ProximityFileTransferFailure | string): void {
        this.requestedTransfers.delete(transferId);
        this.receivingTransfers
            .get(transferId)
            ?.sink.discard()
            .catch((discardError) => console.warn("Unable to discard proximity file transfer", discardError));
        this.receivingTransfers.delete(transferId);
        this.transferUpdateSubject.next({
            transferId,
            state: "error",
            progress: 0,
            error,
        });
    }

    private waitForBackpressure(dataChannel: RTCDataChannel, signal: AbortSignal): Promise<void> {
        signal.throwIfAborted();
        if (dataChannel.bufferedAmount <= PROXIMITY_FILE_TRANSFER_BUFFERED_AMOUNT_LOW_THRESHOLD) {
            return Promise.resolve();
        }

        // A channel that closes never drains: stop waiting then, or the transfer would hang forever.
        return new Promise((resolve, reject) => {
            const onDrained = () => {
                stopListening();
                resolve();
            };
            const onClosed = () => {
                stopListening();
                reject(new Error("Proximity file transfer data channel closed"));
            };
            const stopListening = () => {
                dataChannel.removeEventListener("bufferedamountlow", onDrained);
                dataChannel.removeEventListener("close", onClosed);
                signal.removeEventListener("abort", onClosed);
            };
            dataChannel.addEventListener("bufferedamountlow", onDrained);
            dataChannel.addEventListener("close", onClosed);
            signal.addEventListener("abort", onClosed, { once: true });
        });
    }

    private sendControlMessage(dataChannel: RTCDataChannel, message: ProximityFileTransferControlMessage): void {
        dataChannel.send(JSON.stringify(message));
    }

    private emitSignal(
        receiverSpaceUserId: string,
        transferId: string,
        connectionId: string,
        signal: ProximityFileTransferSignalPayload,
    ): void {
        this.options.space.emitPrivateMessage(
            {
                $case: "proximityFileTransferSignal",
                proximityFileTransferSignal: {
                    transferId,
                    connectionId,
                    signal: JSON.stringify(signal),
                },
            },
            receiverSpaceUserId,
        );
    }

    private enableCandidateEmission(session: PeerSession, transferId: string): void {
        session.signalTransferId = transferId;
        session.canEmitCandidates = true;
        for (const candidate of session.pendingCandidates.splice(0)) {
            this.emitSignal(session.remoteSpaceUserId, transferId, session.connectionId, {
                type: "candidate",
                candidate,
            });
        }
    }

    /** With `expected`, only if that session is still the peer's: a replaced session's late events must not close its successor. */
    private closePeerSession(remoteSpaceUserId: string, expected?: PeerSession): void {
        const session = this.peerSessions.get(remoteSpaceUserId);
        if (!session || (expected && session !== expected)) {
            if (expected) {
                this.shutDownSession(expected, false);
            }
            return;
        }
        this.peerSessions.delete(remoteSpaceUserId);
        this.shutDownSession(session, true);
    }

    /** `failTransfers`: whether what was coming from this peer is lost with it (not when a successor carries it). */
    private shutDownSession(session: PeerSession, failTransfers: boolean): void {
        const remoteSpaceUserId = session.remoteSpaceUserId;
        clearTimeout(session.negotiationTimeout);
        // A download still waiting for the channel learns now that it will not open.
        session.rejectOpen(new Error("Proximity file transfer connection closed"));
        session.dataChannel?.close();
        session.peerConnection.close();
        for (const transferId of session.awaitingReceipt) {
            this.emitOutgoingUpdate(transferId, remoteSpaceUserId, "failed", 0);
        }
        session.awaitingReceipt.clear();
        if (!failTransfers) {
            return;
        }
        // What we were getting from this peer will not arrive: say so rather than leave it loading.
        for (const [transferId, receivingTransfer] of this.receivingTransfers) {
            if (receivingTransfer.offer.senderSpaceUserId === remoteSpaceUserId) {
                this.failReceivingTransfer(transferId, "interrupted");
            }
        }
        for (const [transferId, senderSpaceUserId] of this.requestedTransfers) {
            if (senderSpaceUserId === remoteSpaceUserId) {
                this.failReceivingTransfer(transferId, "interrupted");
            }
        }
    }

    private emitOutgoingUpdate(
        transferId: string,
        recipientSpaceUserId: string,
        state: OutgoingProximityFileTransferUpdate["state"],
        progress: number,
    ): void {
        if (this.outgoingTransfers.get(transferId)?.recipients.includes(recipientSpaceUserId)) {
            this.outgoingUpdateSubject.next({ transferId, recipientSpaceUserId, state, progress });
        }
    }

    /** The incoming offer for `transferId`, only if it was made by the peer on the other end of `session`. */
    private incomingOfferFrom(
        session: PeerSession,
        transferId: string,
    ): IncomingProximityFileTransferOffer | undefined {
        const offer = this.incomingTransfers.get(transferId);
        return offer?.senderSpaceUserId === session.remoteSpaceUserId ? offer : undefined;
    }

    private receivingTransferFrom(session: PeerSession, transferId: string): ReceivingTransfer | undefined {
        const receivingTransfer = this.receivingTransfers.get(transferId);
        return receivingTransfer?.offer.senderSpaceUserId === session.remoteSpaceUserId ? receivingTransfer : undefined;
    }

    private countIncomingOffersFromSender(senderSpaceUserId: string): number {
        let count = 0;
        for (const offer of this.incomingTransfers.values()) {
            if (offer.senderSpaceUserId === senderSpaceUserId) {
                count++;
            }
        }
        return count;
    }
}

/** Which chat card renders a file: only allowlisted types get an inline image/audio/video card. */
export function getMessageTypeFromMimeType(mimeType: string): "file" | "image" | "audio" | "video" {
    const type = sanitizeInlineMimeType(mimeType);
    if (type.startsWith("image/")) {
        return "image";
    }
    if (type.startsWith("audio/")) {
        return "audio";
    }
    if (type.startsWith("video/")) {
        return "video";
    }
    return "file";
}
