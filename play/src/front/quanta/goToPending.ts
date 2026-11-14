export type AskedPosition = { x: number; y: number; direction: number };

/** A position asked of the room's server for a go to, answered with a move-to: it teleports instead of walking. */
let pending: { until: number; arrive: (position: AskedPosition) => void } | undefined;

export function awaitAskedPosition(arrive: (position: AskedPosition) => void, timeoutMs = 5000): void {
    pending = { until: Date.now() + timeoutMs, arrive };
}

/** True when the server's move-to answers a go to, which then takes it over. */
export function claimAskedPosition(position: AskedPosition): boolean {
    const waiting = pending;
    pending = undefined;
    if (!waiting || Date.now() > waiting.until) return false;
    waiting.arrive(position);
    return true;
}
