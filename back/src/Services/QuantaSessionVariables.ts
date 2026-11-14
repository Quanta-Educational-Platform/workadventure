import { asError } from "catch-unknown";
import { getRedisClient } from "./RedisClient";

// quanta: map variables the map doesn't persist, but a class must not lose to a back or play restart: the presented
// board and who may draw on it (presentedBoard, set by the room script). They live while the room is in use, and
// lapse soon after it empties, so the next class starts without them. Every call degrades to memory only.
export const SESSION_VARIABLES: ReadonlySet<string> = new Set(["presentedBoard"]);
/** While the room is in use: from its last change, or the room's last start. */
export const SESSION_VARIABLE_TTL_MS = 3 * 60 * 60 * 1000;
/** Once the room is empty: long enough for everyone to rejoin after a restart. */
export const EMPTY_ROOM_VARIABLE_TTL_MS = 10 * 60 * 1000;
export const SESSION_VARIABLE_READ_TIMEOUT_MS = 2_000;
const WRITE_TIMEOUT_MS = 5_000;

const key = (roomUrl: string, name: string) => `quanta:room-variable:${roomUrl}:${name}`;

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Redis did not answer within ${ms} ms`)), ms);
        timer.unref?.();
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function write(action: string, command: () => Promise<unknown>): void {
    within(command(), WRITE_TIMEOUT_MS).catch((error: unknown) =>
        console.warn(`Room variables could not be ${action} in Redis`, asError(error).message),
    );
}

/** The saved values of `names` in the room, renewed for SESSION_VARIABLE_TTL_MS: the room is in use again. */
export async function loadSessionVariables(roomUrl: string, names: string[]): Promise<Map<string, string>> {
    const values = new Map<string, string>();
    if (!names.length) return values;
    try {
        await within(
            (async () => {
                const redis = await getRedisClient();
                if (!redis) return;
                const saved = await Promise.all(names.map((name) => redis.get(key(roomUrl, name))));
                saved.forEach((value, index) => {
                    if (typeof value === "string") values.set(names[index], value);
                });
            })(),
            SESSION_VARIABLE_READ_TIMEOUT_MS,
        );
    } catch (error) {
        console.warn("Room variables could not be read from Redis", asError(error).message);
    }
    expireSessionVariables(roomUrl, [...values.keys()], SESSION_VARIABLE_TTL_MS);
    return values;
}

export function saveSessionVariable(roomUrl: string, name: string, value: string): void {
    write("saved", async () => {
        const redis = await getRedisClient();
        if (!redis) return;
        // A cleared variable has nothing to restore ("" is how a client's undefined arrives).
        if (value === "" || value === "null") await redis.del(key(roomUrl, name));
        else await redis.set(key(roomUrl, name), value, { expiration: { type: "PX", value: SESSION_VARIABLE_TTL_MS } });
    });
}

export function expireSessionVariables(roomUrl: string, names: Iterable<string>, ttlMs: number): void {
    const keys = [...names].map((name) => key(roomUrl, name));
    if (!keys.length) return;
    write("expired", async () => {
        const redis = await getRedisClient();
        if (!redis) return;
        await Promise.all(keys.map((entry) => redis.pExpire(entry, ttlMs)));
    });
}
