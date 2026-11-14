import { asError } from "catch-unknown";
import { getRedisClient } from "./RedisClient";

// quanta: Redis keeps a space's raised hands and given floor across back and play restarts, by account (a user's
// spaceUserId changes on every join). Every call degrades to memory only: a missing, slow or broken Redis never
// fails or holds up a hand, a join or a teacher's action.
export const HANDS_READ_TIMEOUT_MS = 5_000;
export const HANDS_WRITE_TIMEOUT_MS = 5_000;
/** A saved queue lapses this long after its last change. */
export const HANDS_TTL_MS = 2 * 60 * 60 * 1000;
const LIMIT = 1000;

export type SavedHand = { uuid: string; name: string; at: number; leftAt?: number };
export type SavedFloor = { uuid: string; name: string; leftAt?: number };
export type SavedHands = { hands: SavedHand[]; floor: SavedFloor[] };

export interface HandsStore {
    /** @throws when Redis doesn't answer in HANDS_READ_TIMEOUT_MS or fails. */
    load(space: string): Promise<SavedHands | undefined>;
    save(space: string, saved: SavedHands): void;
}

const key = (space: string) => `quanta:space-hands:${space}`;

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Redis did not answer within ${ms} ms`)), ms);
        timer.unref?.();
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const text = (value: unknown, max: number): value is string =>
    typeof value === "string" && value.length > 0 && value.length <= max;
const time = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

export function parseSavedHands(raw: string): SavedHands | undefined {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return undefined;
    }
    if (!value || typeof value !== "object") return undefined;
    const saved = Object.fromEntries(Object.entries(value));
    const entries = (list: unknown) =>
        (Array.isArray(list) ? list : [])
            .filter((entry): entry is object => !!entry && typeof entry === "object")
            .map((entry) => Object.fromEntries(Object.entries(entry)));
    const leftAt = (entry: Record<string, unknown>) => (time(entry.leftAt) ? { leftAt: entry.leftAt } : {});
    return {
        hands: entries(saved.hands)
            .flatMap((entry) =>
                text(entry.uuid, 200) && typeof entry.name === "string" && time(entry.at)
                    ? [{ uuid: entry.uuid, name: entry.name.slice(0, 256), at: entry.at, ...leftAt(entry) }]
                    : [],
            )
            .slice(0, LIMIT),
        floor: entries(saved.floor)
            .flatMap((entry) =>
                text(entry.uuid, 200) && typeof entry.name === "string"
                    ? [{ uuid: entry.uuid, name: entry.name.slice(0, 256), ...leftAt(entry) }]
                    : [],
            )
            .slice(0, LIMIT),
    };
}

export const redisHandsStore: HandsStore = {
    async load(space) {
        try {
            return await within(
                (async () => {
                    const redis = await getRedisClient();
                    const raw = redis ? await redis.get(key(space)) : null;
                    return raw ? parseSavedHands(raw) : undefined;
                })(),
                HANDS_READ_TIMEOUT_MS,
            );
        } catch (error) {
            console.warn("Raised hands could not be read from Redis", asError(error).message);
            throw error;
        }
    },
    save(space, saved) {
        // Serialized now: a later change must not leak into this write.
        const value =
            saved.hands.length || saved.floor.length
                ? JSON.stringify({ hands: saved.hands.slice(0, LIMIT), floor: saved.floor.slice(0, LIMIT) })
                : undefined;
        within(
            (async () => {
                const redis = await getRedisClient();
                if (!redis) return;
                if (value) await redis.set(key(space), value, { expiration: { type: "PX", value: HANDS_TTL_MS } });
                else await redis.del(key(space));
            })(),
            HANDS_WRITE_TIMEOUT_MS,
        ).catch((error: unknown) => console.warn("Raised hands could not be saved in Redis", asError(error).message));
    },
};
