// quanta: which outgoing video is a screen share and how long its cap (ScreenShareCap.ts) held, for the call sample
// (quanta/callStats.ts): the stats only say a track's id, not what it shows.
const shareTracks = new Set<string>();
let cappedSince: number | undefined;
let cappedMs = 0;

export function noteShareTrack(trackId: string, published: boolean): void {
    if (published) shareTracks.add(trackId);
    else shareTracks.delete(trackId);
}

export function isShareTrack(trackId: unknown): boolean {
    return typeof trackId === "string" && shareTracks.has(trackId);
}

export function noteShareCapped(capped: boolean): void {
    const now = Date.now();
    if (capped && cappedSince === undefined) cappedSince = now;
    if (!capped && cappedSince !== undefined) {
        cappedMs += now - cappedSince;
        cappedSince = undefined;
    }
}

let takenAt: number | undefined;

/** How long a share was capped since the last call, and how long that was. */
export function takeShareCappedMs(): { cappedMs: number; elapsedMs: number | undefined } {
    const now = Date.now();
    let total = cappedMs;
    if (cappedSince !== undefined) {
        total += now - cappedSince;
        cappedSince = now;
    }
    cappedMs = 0;
    const elapsedMs = takenAt === undefined ? undefined : now - takenAt;
    takenAt = now;
    return { cappedMs: total, elapsedMs };
}
