// quanta: how hard this pusher is being joined right now, and how much more it takes.
// - A hint: clients that lost the room read it from /ping before they rejoin (ConnectionManager.waitForPusherPing). A
//   pusher that has just started (a restart or a host reboot, the whole room comes back at once) or that is taking many
//   joins asks them to spread their rejoins over 15 s. A browser alone cannot tell its own lost link from the server's
//   trouble; the server can.
// - A limit: a join that would reach the admin API takes a token first (PusherRoomSocketController). Past the rate,
//   it is refused at once with a 503 and the client retries with backoff, so no crowd, whatever brought it (everyone
//   pressing Reload, a stalled pusher coming back), reaches the admin API and the back faster than this.
const STARTUP_MS = 180_000;
const WINDOW_MS = 10_000;
const BUSY_JOINS = 20;
export const REJOIN_SPREAD_MS = 15_000;
export const REJOIN_SPREAD_HEADER = "X-Quanta-Rejoin-Spread-Ms";
/** Joins a second a pusher admits, and how many at once after a quiet spell: a class of 100 in about 10 s. */
const JOIN_RATE_PER_S = 10;
const JOIN_BURST = 20;

const startedAt = Date.now();
const recentJoins: number[] = [];

function forgetOld(now: number): void {
    while (recentJoins.length > 0 && recentJoins[0] < now - WINDOW_MS) recentJoins.shift();
}

/** A full join (not a resume) reached this pusher. */
export function noteRoomJoin(): void {
    const now = Date.now();
    forgetOld(now);
    recentJoins.push(now);
}

let joinTokens = JOIN_BURST;
let refilledAt = Date.now();

/** Whether a join may go ahead now; false means refuse it before any work. */
export function takeJoinToken(): boolean {
    const now = Date.now();
    joinTokens = Math.min(JOIN_BURST, joinTokens + ((now - refilledAt) / 1000) * JOIN_RATE_PER_S);
    refilledAt = now;
    if (joinTokens < 1) return false;
    joinTokens -= 1;
    return true;
}

export function rejoinSpreadMs(): number {
    const now = Date.now();
    forgetOld(now);
    return now - startedAt < STARTUP_MS || recentJoins.length >= BUSY_JOINS ? REJOIN_SPREAD_MS : 0;
}
