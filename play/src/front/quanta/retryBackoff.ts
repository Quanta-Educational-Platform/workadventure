/** How many self-reloading retry screens this tab has shown in a row; cleared once the room is ready. */
export const RETRY_ATTEMPT_KEY = "quanta-retry-attempt";

const RETRY_MAX_WAIT_MS = 180_000;

/**
 * The server's wait (already spread out per joiner), doubled for each retry in a row, in whole seconds. At the cap
 * the wait is drawn again between two and three minutes, so retries that reached it together don't stay together.
 */
export function retryWaitMs(serverWaitMs: number, attempt: number, random: () => number = Math.random): number {
    const doubled = serverWaitMs * 2 ** Math.min(Math.max(attempt, 0), 4);
    const wait = doubled >= RETRY_MAX_WAIT_MS ? RETRY_MAX_WAIT_MS * (2 / 3 + random() / 3) : doubled;
    return Math.max(1000, Math.round(wait / 1000) * 1000);
}

export function clearRetryAttempts(): void {
    try {
        sessionStorage.removeItem(RETRY_ATTEMPT_KEY);
    } catch {
        // Nothing to clear without a store.
    }
}
