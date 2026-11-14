export type NoncedMessage<TPayload> = {
    nonce: number;
    payload: TPayload;
};

type StoredNoncedMessage<TPayload> = NoncedMessage<TPayload> & {
    storedAt: number;
    size: number;
};

/** quanta: a cap on what the store holds, so a long retention does not hold a busy room's traffic without bound. */
export type NoncedMessageBudget<TPayload> = {
    maxBytes: number;
    sizeOf: (payload: TPayload) => number;
};

export class NoncedMessageStore<TPayload> {
    private readonly messages: StoredNoncedMessage<TPayload>[] = [];
    private readonly retentionMs: number;
    private storedBytes = 0;
    // quanta: the newest nonce dropped so far (expired or over budget). Nonces are added in order and dropped from the
    // front, so a client misses something exactly when it last received one before this, even with the store empty.
    private lastDroppedNonce = 0;

    public constructor(
        retentionMs?: number,
        private readonly budget?: NoncedMessageBudget<TPayload>,
    ) {
        this.retentionMs = retentionMs ?? 30_000;
    }

    public add(nonce: number, payload: TPayload): void {
        this.pruneExpired();
        const size = this.budget?.sizeOf(payload) ?? 0;
        this.messages.push({
            nonce,
            payload,
            storedAt: Date.now(),
            size,
        });
        this.storedBytes += size;
        // Over budget, the oldest go first: a resume that needs them is then refused (hasEveryNonceAfter) and the
        // client rejoins from scratch, as when they expire.
        while (this.budget && this.storedBytes > this.budget.maxBytes) {
            const dropped = this.messages.shift();
            if (!dropped) break;
            this.storedBytes -= dropped.size;
            this.lastDroppedNonce = dropped.nonce;
        }
    }

    public getAll(): NoncedMessage<TPayload>[] {
        this.pruneExpired();
        return this.messages.map(({ nonce, payload }) => ({ nonce, payload }));
    }

    public getAfter(nonce: number): NoncedMessage<TPayload>[] {
        this.pruneExpired();
        return this.messages
            .filter((message) => message.nonce > nonce)
            .map(({ nonce, payload }) => ({ nonce, payload }));
    }

    public has(nonce: number): boolean {
        this.pruneExpired();
        return this.messages.some((message) => message.nonce === nonce);
    }

    public hasEveryNonceAfter(lastReceivedNonce: number): boolean {
        this.pruneExpired();
        if (this.lastDroppedNonce > lastReceivedNonce) {
            return false;
        }
        const firstMessage = this.messages[0];
        if (!firstMessage) {
            return true;
        }
        return firstMessage.nonce <= lastReceivedNonce + 1;
    }

    public clear(): void {
        this.messages.length = 0;
        this.storedBytes = 0;
    }

    private pruneExpired(): void {
        if (this.messages.length === 0) return;

        const cutoff = Date.now() - this.retentionMs;
        while (this.messages.length > 0) {
            const firstMessage = this.messages[0];
            if (!firstMessage || firstMessage.storedAt > cutoff) {
                break;
            }
            this.messages.shift();
            this.storedBytes -= firstMessage.size;
            this.lastDroppedNonce = firstMessage.nonce;
        }
    }
}
