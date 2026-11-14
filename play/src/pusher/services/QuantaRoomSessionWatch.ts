// quanta: a room signed in with a code (Quanta: lib/workadventure/room-session.ts) is admitted once per connection, and a
// reconnecting transport resumes without admission. So a room-session connection is asked about again while it lasts:
// on a clear "no" from Quanta, or at the token's expiry, it ends. An outage never ends it: an unknown answer waits for
// the next check. Connections with any other token are not watched.

export const ROOM_SESSION_CHECK_MIN_MS = 4 * 60_000;
export const ROOM_SESSION_CHECK_MAX_MS = 6 * 60_000;

export type WatchedRoomSession = { token: string; expiresAtMs: number };

/** The session to watch, for a token that carries one; nothing for any other token. */
export function roomSessionOfToken(
    tokenData: { quantaSession?: boolean; accessToken?: string; exp?: number } | null | undefined,
): WatchedRoomSession | undefined {
    if (tokenData?.quantaSession !== true || !tokenData.accessToken) return undefined;
    return {
        token: tokenData.accessToken,
        expiresAtMs: tokenData.exp === undefined ? Number.POSITIVE_INFINITY : tokenData.exp * 1000,
    };
}

/**
 * Starts watching; returns what stops it. Spread over a window, so a class that joined together does not ask together.
 * `isLive` answers undefined when it does not know, and must not reject.
 */
export function watchRoomSession({
    session,
    isLive,
    onEnded,
    random = Math.random,
}: {
    session: WatchedRoomSession;
    isLive: (token: string) => Promise<boolean | undefined>;
    onEnded: (why: "refused" | "expired") => void;
    random?: () => number;
}): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const end = (why: "refused" | "expired") => {
        stopped = true;
        onEnded(why);
    };
    const check = async () => {
        if (stopped) return;
        if (Date.now() >= session.expiresAtMs) {
            end("expired");
            return;
        }
        const live = await isLive(session.token).catch(() => undefined);
        if (stopped) return;
        if (live === false) {
            end("refused");
            return;
        }
        schedule();
    };
    const schedule = () => {
        const wait = ROOM_SESSION_CHECK_MIN_MS + random() * (ROOM_SESSION_CHECK_MAX_MS - ROOM_SESSION_CHECK_MIN_MS);
        const left = session.expiresAtMs - Date.now();
        timer = setTimeout(() => {
            check().catch((e) => console.error("Room session check failed", e));
        }, Math.max(0, Math.min(wait, left)));
    };
    schedule();

    return () => {
        stopped = true;
        clearTimeout(timer);
    };
}
