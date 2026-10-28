const AFTER_PAUSE_MS = 10_000;
type Expectation = { paused: boolean; lastPausedAt: number };
const expectations = new Map<string, Expectation>();

/** Per-subscription ownership prevents an old track's cleanup from removing its replacement. */
export function createVideoExpectationTracker() {
    const expectation: Expectation = { paused: false, lastPausedAt: Number.NEGATIVE_INFINITY };
    let currentId: string | undefined;
    const clear = () => {
        if (currentId && expectations.get(currentId) === expectation) expectations.delete(currentId);
        currentId = undefined;
    };
    return {
        clear,
        update(trackId: string | undefined, expectedFps: number | undefined, now: number) {
            if (trackId !== currentId) {
                clear();
                expectation.lastPausedAt = Number.NEGATIVE_INFINITY;
                currentId = trackId;
            }
            expectation.paused = expectedFps === 0;
            if (expectation.paused) expectation.lastPausedAt = now;
            if (trackId) expectations.set(trackId, expectation);
        },
    };
}

export function isVideoExpected(trackId: string | undefined, now: number, since?: number): boolean {
    const expectation = trackId ? expectations.get(trackId) : undefined;
    return (
        !expectation ||
        (!expectation.paused &&
            now - expectation.lastPausedAt >= AFTER_PAUSE_MS &&
            (since === undefined || expectation.lastPausedAt <= since))
    );
}
