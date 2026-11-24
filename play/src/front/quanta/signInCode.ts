// quanta: the framed room's sign-in. Quanta's page puts a single-use code in the frame address's fragment, so no server
// log and no Referer sees it; this module, the first the page loads, takes it out of the address before anything can
// read or report it. Outside a frame a code is dropped: a link opened on its own signs nobody in.
//
// A frame that has held a code stays with codes: it does not start WA's redirect chain, and asks the page for a new code
// whenever it needs to sign in again. It leaves codes behind only when the page says it no longer uses them, or says
// nothing at all for a while it could have: the page answers by itself, whatever its server is doing, so an outage or a
// slow code never reads as either. Without a code in sight none of this does anything.
import { BOT } from "./botMode";
import { z } from "zod";

const PARAM = "quantaCode";
const FRAME_MARKER = "quantaCodeSignedFrame";

export type SignInNeeded = "refused" | "unavailable" | "expired";

function isFramed(): boolean {
    try {
        return window.parent !== window;
    } catch {
        return true;
    }
}

/** The code in a fragment, and the fragment without it. */
export function splitSignInCode(hash: string): { code: string | null; rest: string } {
    let code: string | null = null;
    const rest = hash
        .replace(/^#/, "")
        .split("&")
        .filter((part) => {
            if (!part.startsWith(`${PARAM}=`)) return true;
            code = part.slice(PARAM.length + 1);
            return false;
        })
        .join("&");
    return { code, rest };
}

function takeFromAddress(): string | null {
    const { code, rest } = splitSignInCode(window.location.hash);
    if (code === null) return null;
    const clean = new URL(window.location.href);
    clean.hash = rest;
    history.replaceState(history.state, "", clean.toString());
    return isFramed() ? code : null;
}

let pending: string | null = null;

function readAddress(): void {
    const code = takeFromAddress();
    if (code === null) return;
    pending = code;
    try {
        sessionStorage.setItem(FRAME_MARKER, "1");
    } catch {
        // Blocked storage keeps no identity across a reload either.
    }
}

readAddress();

// A new code for a frame already on this address arrives as a change of fragment, which loads nothing by itself. The
// reload keeps the fragment, and the next load takes it.
function reloadOnNewCode(): void {
    if (splitSignInCode(window.location.hash).code !== null) window.location.reload();
}
if (isFramed()) {
    // For the page's whole life.
    // eslint-disable-next-line listeners/no-missing-remove-event-listener
    window.addEventListener("hashchange", reloadOnNewCode);
}

/** The code this load came with, once. */
export function takeSignInCode(): string | null {
    readAddress();
    const code = pending;
    pending = null;
    return code;
}

export function inCodeSignedFrame(): boolean {
    // A fake student only ever enters on a code from its own page: every path that would sign in another way asks it.
    if (BOT) return true;
    if (!isFramed()) return false;
    try {
        return sessionStorage.getItem(FRAME_MARKER) === "1";
    } catch {
        return false;
    }
}

export const MODE_ASK_EVERY_MS = 2_000;
// A page of ours answers at once, so this much silence with the tab in view is a page from before codes. A tab in the
// background may just be throttled, and does not count.
export const MODE_SILENT_ASKS_LIMIT = 10;

type PageMode = { codes: boolean; userId: string | null };

let modeWaiters: Array<(mode: PageMode | null) => void> | null = null;

/** What the page says about codes and who it shows, or null if it stayed silent as long as a page of ours can't. */
function askPageMode(done: (mode: PageMode | null) => void): void {
    if (modeWaiters) {
        modeWaiters.push(done);
        return;
    }
    modeWaiters = [done];

    let silentAsks = 0;
    const ask = () => window.parent.postMessage({ type: "quanta_wa_sign_in_mode_asked" }, "*");
    const finish = (mode: PageMode | null) => {
        clearInterval(timer);
        window.removeEventListener("message", onAnswer);
        const waiters = modeWaiters ?? [];
        modeWaiters = null;
        waiters.forEach((waiter) => waiter(mode));
    };
    function onAnswer(event: MessageEvent) {
        if (event.source !== window.parent) return;
        const answer = event.data as { type?: unknown; codes?: unknown; userId?: unknown } | null;
        if (answer?.type !== "quanta_wa_sign_in_mode") return;
        finish({ codes: answer.codes !== false, userId: typeof answer.userId === "string" ? answer.userId : null });
    }
    const timer = setInterval(() => {
        if (document.visibilityState !== "visible") return;
        silentAsks += 1;
        if (silentAsks > MODE_SILENT_ASKS_LIMIT) finish(null);
        else ask();
    }, MODE_ASK_EVERY_MS);
    window.addEventListener("message", onAnswer);
    ask();
}

function leaveCodeSignIn(): void {
    try {
        sessionStorage.removeItem(FRAME_MARKER);
    } catch {
        // Nothing kept there, then.
    }
}

/**
 * Asks the page for a new code, and whether it still uses them. `leaveCodes` runs if not: it must forget this frame's
 * identity, so the old flow signs in whoever the page's own session is, never a cached account.
 */
export function askPageForSignIn(reason: SignInNeeded, leaveCodes: () => void): void {
    window.parent.postMessage({ type: "quanta_wa_sign_in_needed", reason }, "*");
    askPageMode((mode) => {
        if (mode?.codes) return;
        leaveCodeSignIn();
        leaveCodes();
    });
}

/**
 * Before a frame that held a code enters on the token it kept: is that still right under this page? The page may no
 * longer use codes, or may show someone else by now. "leave": it doesn't use them, or says nothing, and the frame is no
 * longer code-signed. "renew": it does, for another person, or a token that names nobody.
 */
export function confirmStoredTokenWithPage(tokenUserId: string | null): Promise<"enter" | "renew" | "leave"> {
    return new Promise((resolve) => {
        askPageMode((mode) => {
            if (!mode?.codes) {
                leaveCodeSignIn();
                resolve("leave");
            } else {
                resolve(tokenUserId !== null && mode.userId === tokenUserId ? "enter" : "renew");
            }
        });
    });
}

/**
 * Swaps the code through WA's server. Only a clear refusal reads as one: a network failure, a timeout, a server error
 * or an answer that makes no sense says nothing about the user.
 */
export async function exchangeSignInCode(
    code: string,
    post: (body: { code: string; playUri: string }) => Promise<unknown>,
): Promise<{ authToken: string } | { failed: "refused" | "unavailable" }> {
    try {
        const answer = await post({ code, playUri: window.location.origin + window.location.pathname });
        const parsed = z.object({ authToken: z.string().min(1) }).safeParse(answer);
        return parsed.success ? { authToken: parsed.data.authToken } : { failed: "unavailable" };
    } catch (err) {
        const status = (err as { response?: { status?: unknown } } | null)?.response?.status;
        return { failed: status === 400 || status === 401 ? "refused" : "unavailable" };
    }
}
