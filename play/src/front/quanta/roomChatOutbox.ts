// quanta: the class chat's messages and edits on their way to the room's server. A student's eleventh command
// within 10 s is refused with how long to wait (RoomSession.acceptCommand); the outbox sends it again then, in
// order with anything typed meanwhile, so nothing typed is lost.
import { z } from "zod";

const answer = z.object({
    ref: z.string(),
    retryAfterMs: z.number().min(0).max(60_000).optional(),
    // A refusal for good: the room's server says why.
    notice: z.string().optional(),
});

type Pending = {
    command: object;
    held: boolean;
    settle: (error?: Error) => void;
    /** Gives up on an answer that never comes (the room's server refused it before reading it, say). */
    deadline?: ReturnType<typeof setTimeout>;
};

/** How long a command sent waits for its answer; time held back for the server's limit doesn't count. */
export const ANSWER_DEADLINE_MS = 30_000;

export class RoomChatOutbox {
    private sequence = 0;
    private readonly pending = new Map<string, Pending>();
    private timer: ReturnType<typeof setTimeout> | undefined;
    private resendAt = 0;
    private disposed = false;

    /** `held`: commands wait this many seconds before they go out again. */
    constructor(
        private readonly emit: (command: object) => void,
        private readonly held: (seconds: number) => void,
    ) {}

    /** Settles once the room's server took the command (its own copy came back) or refused it for good. */
    send(command: { op: string } & Record<string, unknown>): Promise<void> {
        if (this.disposed) return Promise.reject(new Error("The room's chat closed."));
        const ref = `c${++this.sequence}`;
        let settle: Pending["settle"] = () => {};
        const done = new Promise<void>((resolve, reject) => {
            settle = (error) => (error ? reject(error) : resolve());
        });
        // Nobody has to wait for it: a message sent without looking at the answer is not an unhandled failure.
        done.catch(() => {});
        const entry: Pending = { command: { ...command, ref }, held: this.timer !== undefined, settle };
        this.pending.set(ref, entry);
        // Behind commands held back, so everything goes out in the order it was typed.
        if (!entry.held) this.emitEntry(ref, entry);
        return done;
    }

    /** Sends it and waits for its answer, which an unanswered command stops waiting for (not sent again: the room's
     *  server can't tell a second copy from a new message). */
    private emitEntry(ref: string, entry: Pending): void {
        clearTimeout(entry.deadline);
        entry.deadline = setTimeout(() => {
            if (this.pending.get(ref) !== entry) return;
            this.pending.delete(ref);
            entry.settle(new Error("The room's chat didn't answer."));
        }, ANSWER_DEADLINE_MS);
        this.emit(entry.command);
    }

    /** Reads an update from the room's server; true when it answered one of this outbox's commands. */
    answer(raw: unknown): boolean {
        const parsed = answer.safeParse(raw);
        if (!parsed.success) return false;
        const entry = this.pending.get(parsed.data.ref);
        if (!entry) return false;
        clearTimeout(entry.deadline);
        if (parsed.data.retryAfterMs === undefined) {
            // Taken (its own copy came back) or refused for good (a notice says why).
            this.pending.delete(parsed.data.ref);
            entry.settle(parsed.data.notice !== undefined ? new Error(parsed.data.notice) : undefined);
            return true;
        }
        entry.held = true;
        this.hold(parsed.data.retryAfterMs);
        return true;
    }

    private hold(waitMs: number): void {
        const at = Date.now() + waitMs;
        if (this.timer !== undefined && at <= this.resendAt) return;
        clearTimeout(this.timer);
        this.resendAt = at;
        this.timer = setTimeout(() => this.resend(), waitMs);
        this.held(Math.ceil(waitMs / 1000));
    }

    private resend(): void {
        this.timer = undefined;
        for (const [ref, entry] of this.pending) {
            if (!entry.held) continue;
            entry.held = false;
            this.emitEntry(ref, entry);
        }
    }

    dispose(): void {
        this.disposed = true;
        clearTimeout(this.timer);
        this.timer = undefined;
        for (const entry of this.pending.values()) {
            clearTimeout(entry.deadline);
            entry.settle(new Error("The room's chat closed."));
        }
        this.pending.clear();
    }
}
