import { asError } from "catch-unknown";
import {
    ROOM_CHAT_TTL,
    ROOM_DIRECT_LIMIT,
    ROOM_HISTORY_LIMIT,
    isPrivateMessage,
    type RoomMessage,
    type RoomPerson,
    type SavedModeration,
} from "../../common/quanta/RoomSession";
import { getRedisClient, type RedisClient } from "../services/RedisClient";

// Redis keeps a room's removals, chat mutes and class chat across play restarts. Every call degrades to memory only:
// a missing, slow or broken Redis never fails or holds up a join or a teacher's action.
export const MODERATION_READ_TIMEOUT_MS = 10_000;
export const MODERATION_WRITE_TIMEOUT_MS = 5_000;

const key = (world: string) => `quanta:room-moderation:${world}`;
// A list, one JSON message per entry: a message costs one append, not a rewrite of the whole history.
const chatKey = (world: string) => `quanta:room-chat:${world}`;
/** Direct messages, in a list of their own: neither kind's limit ever pushes out the other's messages. */
const directKey = (world: string) => `quanta:room-chat-direct:${world}`;
const deletedKey = (world: string) => `quanta:room-chat-tombstones:${world}`;
const directDeletedKey = (world: string) => `quanta:room-chat-direct-tombstones:${world}`;
const occupiedKey = (world: string) => `quanta:room-chat-occupied:${world}`;
/** The class chat's pinned messages (copies), all in one value: they outlast the history's limit, not its life. */
const pinsKey = (world: string) => `quanta:room-chat-pins:${world}`;

function within<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Redis did not answer within ${ms} ms`)), ms);
        timer.unref?.();
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isPerson(value: unknown): value is RoomPerson {
    if (!value || typeof value !== "object") return false;
    const person = Object.fromEntries(Object.entries(value));
    return typeof person.id === "string" && typeof person.name === "string" && typeof person.staff === "boolean";
}

function parse(raw: string): SavedModeration | undefined {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return undefined;
    }
    if (!value || typeof value !== "object") return undefined;
    const saved = Object.fromEntries(Object.entries(value));
    if (!Array.isArray(saved.removed) || !Array.isArray(saved.muted)) return undefined;
    return {
        removed: saved.removed.filter(isPerson).slice(0, 1000),
        muted: saved.muted.filter((id): id is string => typeof id === "string").slice(0, 1000),
        cameraOff: Array.isArray(saved.cameraOff)
            ? saved.cameraOff.filter((id): id is string => typeof id === "string").slice(0, 1000)
            : [],
    };
}

/**
 * The room's saved decisions, or undefined when there are none (or none readable).
 * @throws when Redis doesn't answer in MODERATION_READ_TIMEOUT_MS or fails: worth asking again later.
 */
export async function loadModeration(world: string): Promise<SavedModeration | undefined> {
    try {
        return await within(
            (async () => {
                const redis = await getRedisClient();
                const raw = redis ? await redis.get(key(world)) : null;
                return raw ? parse(raw) : undefined;
            })(),
            MODERATION_READ_TIMEOUT_MS,
        );
    } catch (error) {
        console.warn("Room moderation could not be read from Redis", asError(error).message);
        throw error;
    }
}

function write(action: string, command: (redis: RedisClient) => Promise<unknown>): void {
    within(
        (async () => {
            const redis = await getRedisClient();
            if (redis) await command(redis);
        })(),
        MODERATION_WRITE_TIMEOUT_MS,
    ).catch((error: unknown) =>
        console.warn(`Room moderation could not be ${action} in Redis`, asError(error).message),
    );
}

export function saveModeration(world: string, saved: SavedModeration, ttlMs: number): void {
    // Serialized now: a later change must not leak into this write.
    const value = JSON.stringify(saved);
    write("saved", (redis) => redis.set(key(world), value, { expiration: { type: "PX", value: ttlMs } }));
}

export function expireModeration(world: string, ttlMs: number): void {
    write("expired", (redis) => redis.pExpire(key(world), ttlMs));
}

function isMessage(value: unknown): value is RoomMessage {
    if (!value || typeof value !== "object") return false;
    const message = Object.fromEntries(Object.entries(value));
    return (
        typeof message.id === "string" &&
        typeof message.sender === "string" &&
        typeof message.name === "string" &&
        typeof message.body === "string" &&
        message.body.length <= 4000 &&
        typeof message.at === "number" &&
        // A direct message's recipient: without it the message would read as the class's, to everyone.
        (message.to === undefined || (typeof message.to === "string" && message.to.length > 0)) &&
        (message.toName === undefined || typeof message.toName === "string") &&
        (message.fromStaff === undefined || message.fromStaff === true) &&
        (message.toStaff === undefined || message.toStaff === true) &&
        // A group's readers: without them the message would read as the class's, to everyone.
        (message.group === undefined ||
            (Array.isArray(message.group) &&
                message.group.length >= 2 &&
                message.group.length <= 20 &&
                message.group.every(
                    (member: unknown) =>
                        !!member &&
                        typeof member === "object" &&
                        typeof (member as { id?: unknown }).id === "string" &&
                        (member as { id: string }).id.length > 0 &&
                        typeof (member as { name?: unknown }).name === "string",
                ))) &&
        !(message.to !== undefined && message.group !== undefined) &&
        (message.mentions === undefined ||
            (Array.isArray(message.mentions) &&
                message.mentions.length <= 20 &&
                message.mentions.every(
                    (mention: unknown) =>
                        !!mention &&
                        typeof mention === "object" &&
                        typeof (mention as { id?: unknown }).id === "string" &&
                        typeof (mention as { name?: unknown }).name === "string",
                )))
    );
}

/**
 * The room's saved class chat, oldest first, without the messages deleted since; none once the room has been empty
 * for longer than ROOM_CHAT_TTL.
 * @throws when Redis doesn't answer in MODERATION_READ_TIMEOUT_MS or fails: worth asking again later.
 */
export async function loadRoomChat(world: string): Promise<RoomMessage[]> {
    try {
        return await within(
            (async () => {
                const redis = await getRedisClient();
                if (!redis) return [];
                const [classRaw, directRaw, deleted, directDeleted, occupiedAt] = await Promise.all([
                    redis.lRange(chatKey(world), -ROOM_HISTORY_LIMIT, -1),
                    redis.lRange(directKey(world), -ROOM_DIRECT_LIMIT, -1),
                    redis.zRange(deletedKey(world), 0, -1),
                    redis.zRange(directDeletedKey(world), 0, -1),
                    redis.get(occupiedKey(world)),
                ]);
                const parsed = (entries: string[], direct: boolean) =>
                    entries.flatMap((entry) => {
                        try {
                            const message: unknown = JSON.parse(entry);
                            // A message in the other kind's list is never shown: a direct one there would be the class's.
                            return isMessage(message) && isPrivateMessage(message) === direct ? [message] : [];
                        } catch {
                            return [];
                        }
                    });
                // A history outlives ROOM_CHAT_TTL only when an expiry was lost: the room's last use is what counts.
                if (!occupiedAt || Date.now() - Number(occupiedAt) > ROOM_CHAT_TTL) return [];
                const gone = new Set([...deleted, ...directDeleted]);
                return [...parsed(classRaw, false), ...parsed(directRaw, true)]
                    .filter((message) => !gone.has(message.id))
                    .sort((a, b) => Number(a.id) - Number(b.id));
            })(),
            MODERATION_READ_TIMEOUT_MS,
        );
    } catch (error) {
        console.warn("Room chat could not be read from Redis", asError(error).message);
        throw error;
    }
}

// Stored as serialized here, so a delete can name the same entry.
const serialize = (message: RoomMessage) =>
    JSON.stringify({
        id: message.id,
        sender: message.sender,
        name: message.name,
        body: message.body,
        at: message.at,
        ...(message.edited ? { edited: true } : {}),
        ...(message.reactions ? { reactions: message.reactions } : {}),
        ...(message.mentions ? { mentions: message.mentions } : {}),
        ...(message.to !== undefined ? { to: message.to, toName: message.toName ?? "" } : {}),
        ...(message.group !== undefined ? { group: message.group } : {}),
        ...(message.fromStaff ? { fromStaff: true } : {}),
        ...(message.toStaff ? { toStaff: true } : {}),
    });

/**
 * KEYS: the history, the ids deleted from it (a sorted set scored by id), when the room was last occupied, the
 * other kind's history and deleted ids (class chat or direct messages), and the class chat's pins, cleared and
 * renewed with these. ARGV: the
 * time after which this write is stale, the TTL, the history's length, the message to append, the id and entry to
 * delete (either may be empty), now, "1" when the room is (or was until now) occupied, ROOM_CHAT_TTL, when the
 * writing process's session of the room began, and an entry to replace in place with its edited version (both empty
 * when nothing was edited; an entry no longer saved stays gone).
 *
 * A write Redis only gets to after its deadline (queued while Redis was away) does nothing: it could otherwise bring
 * back a history that has lapsed. Only an occupied room's writes renew the history's life; a deletion retried after
 * everyone left never lengthens it. A session that began after the room stood empty longer than ROOM_CHAT_TTL (the
 * history's expiry was lost) starts from nothing, before anything is renewed; one that was live all along, however
 * long Redis missed its writes, keeps its history. Deleted ids older than the oldest message kept, or beyond
 * the history's length of deletions, can't name a message that could come back: they go.
 */
export const CHAT_WRITE_SCRIPT = `
local clock = redis.call('TIME')
if tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000) > tonumber(ARGV[1]) then return 0 end
local ttl = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
if ARGV[8] == '1' then
    local last = tonumber(redis.call('GET', KEYS[3]))
    if (not last and redis.call('EXISTS', KEYS[1], KEYS[2], KEYS[4], KEYS[5], KEYS[6]) > 0) or (last and tonumber(ARGV[10]) - last > tonumber(ARGV[9])) then
        redis.call('DEL', KEYS[1], KEYS[2], KEYS[4], KEYS[5], KEYS[6])
    end
end
if ARGV[4] ~= '' then
    redis.call('RPUSH', KEYS[1], ARGV[4])
    redis.call('LTRIM', KEYS[1], -limit, -1)
end
if ARGV[11] and ARGV[11] ~= '' and redis.call('LINSERT', KEYS[1], 'BEFORE', ARGV[11], ARGV[12]) > 0 then
    redis.call('LREM', KEYS[1], 1, ARGV[11])
end
if ARGV[5] ~= '' then
    redis.call('LREM', KEYS[1], 1, ARGV[6])
    redis.call('ZADD', KEYS[2], ARGV[5], ARGV[5])
    redis.call('ZREMRANGEBYRANK', KEYS[2], 0, -limit - 1)
end
local oldest = redis.call('LINDEX', KEYS[1], 0)
if oldest then
    local first = tonumber(cjson.decode(oldest).id)
    if first then redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', '(' .. first) end
end
if ARGV[8] == '1' then
    redis.call('SET', KEYS[3], ARGV[7], 'PX', ttl)
    for _, key in ipairs({ KEYS[1], KEYS[2], KEYS[4], KEYS[5], KEYS[6] }) do redis.call('PEXPIRE', key, ttl) end
else
    for _, i in ipairs({ 1, 2, 4, 5, 6 }) do
        local left = redis.call('PTTL', KEYS[i])
        if left == -1 or left > ttl then redis.call('PEXPIRE', KEYS[i], ttl) end
    end
end
return 1`;
// node-redis queues commands without bound while Redis is away: past this many unanswered, chat writes are dropped.
export const MAX_PENDING_CHAT_WRITES = 64;
let pendingChatWrites = 0;

type ChatWrite = {
    ttlMs: number;
    occupied: boolean;
    /** When this process's session of the room began (RoomSession.startedAt). */
    liveSince: number;
    append?: RoomMessage;
    deleted?: RoomMessage;
    /** A saved message and its edited version. */
    edited?: { before: RoomMessage; after: RoomMessage };
};

/** True once Redis applied the write; false when it was dropped, stale, failed or timed out. A write with a message
 *  goes to that message's list (the class's or the direct messages'); either way both lists are cleared when stale and
 *  renewed together, in one script, so neither outlives the other. */
function chatWrite(world: string, write: ChatWrite): Promise<boolean> {
    const message = write.append ?? write.deleted ?? write.edited?.before;
    return listWrite(world, write, message !== undefined && isPrivateMessage(message));
}

function listWrite(
    world: string,
    { ttlMs, occupied, liveSince, append, deleted, edited }: ChatWrite,
    direct: boolean,
): Promise<boolean> {
    if (pendingChatWrites >= MAX_PENDING_CHAT_WRITES) return Promise.resolve(false);
    pendingChatWrites++;
    const now = Date.now();
    const command = (async () => {
        const redis = await getRedisClient();
        if (!redis) return true;
        const applied = await redis.eval(CHAT_WRITE_SCRIPT, {
            keys: direct
                ? [
                      directKey(world),
                      directDeletedKey(world),
                      occupiedKey(world),
                      chatKey(world),
                      deletedKey(world),
                      pinsKey(world),
                  ]
                : [
                      chatKey(world),
                      deletedKey(world),
                      occupiedKey(world),
                      directKey(world),
                      directDeletedKey(world),
                      pinsKey(world),
                  ],
            arguments: [
                String(now + MODERATION_WRITE_TIMEOUT_MS),
                String(ttlMs),
                String(direct ? ROOM_DIRECT_LIMIT : ROOM_HISTORY_LIMIT),
                append ? serialize(append) : "",
                deleted?.id ?? "",
                deleted ? serialize(deleted) : "",
                String(now),
                occupied ? "1" : "",
                String(ROOM_CHAT_TTL),
                String(liveSince),
                edited ? serialize(edited.before) : "",
                edited ? serialize(edited.after) : "",
            ],
        });
        return applied === 1;
    })();
    command
        .finally(() => {
            pendingChatWrites--;
        })
        .catch(() => {});
    return within(command, MODERATION_WRITE_TIMEOUT_MS).catch((error: unknown) => {
        console.warn("Room chat could not be saved in Redis", asError(error).message);
        return false;
    });
}

export function appendRoomChat(world: string, message: RoomMessage, ttlMs: number, liveSince: number): void {
    chatWrite(world, { ttlMs, occupied: true, liveSince, append: message }).catch(() => {});
}

/** Replaces a saved message with its edited version, where it stands in the history. */
export function editRoomChat(
    world: string,
    before: RoomMessage,
    after: RoomMessage,
    ttlMs: number,
    liveSince: number,
): void {
    chatWrite(world, { ttlMs, occupied: true, liveSince, edited: { before, after } }).catch(() => {});
}

// A deletion is tried until Redis confirms it, for as long as the history could still be restored.
export const DELETE_RETRY_MIN_MS = 2000;
const DELETE_RETRY_MAX_MS = 60_000;

/** Removes the message from the saved history and keeps its id, so a restore never brings it back. */
export function deleteRoomChat(world: string, message: RoomMessage, ttlMs: number): void {
    const giveUpAt = Date.now() + ttlMs;
    let failures = 0;
    const attempt = () => {
        chatWrite(world, { ttlMs, occupied: false, liveSince: 0, deleted: message })
            .then((done) => {
                if (done) return;
                if (Date.now() >= giveUpAt) {
                    console.warn("Room chat gave up removing a deleted message from Redis");
                    return;
                }
                failures++;
                const delay = Math.min(DELETE_RETRY_MAX_MS, DELETE_RETRY_MIN_MS * 2 ** (failures - 1));
                setTimeout(attempt, delay).unref?.();
            })
            .catch(() => {});
    };
    attempt();
}

/** The room is occupied, or was until now: the history lives for `ttlMs` from now. */
export function expireRoomChat(world: string, ttlMs: number, liveSince: number): void {
    chatWrite(world, { ttlMs, occupied: true, liveSince }).catch(() => {});
}

/** Saves the class chat's pins as they now are; none deletes them. */
export function saveRoomPins(world: string, pins: RoomMessage[], ttlMs: number): void {
    const value = JSON.stringify(pins.map((pin) => JSON.parse(serialize(pin)) as unknown));
    write("saved", (redis) =>
        pins.length > 0
            ? redis.set(pinsKey(world), value, { expiration: { type: "PX", value: ttlMs } })
            : redis.del(pinsKey(world)),
    );
}

/**
 * The class chat's saved pins, newest first; none once the room has been empty for longer than ROOM_CHAT_TTL, as
 * with the history they belong to.
 * @throws when Redis doesn't answer in MODERATION_READ_TIMEOUT_MS or fails: worth asking again later.
 */
export async function loadRoomPins(world: string): Promise<RoomMessage[]> {
    const [raw, occupiedAt] = await within(
        (async () => {
            const redis = await getRedisClient();
            return redis ? await Promise.all([redis.get(pinsKey(world)), redis.get(occupiedKey(world))]) : [null, null];
        })(),
        MODERATION_READ_TIMEOUT_MS,
    );
    if (!raw || !occupiedAt || Date.now() - Number(occupiedAt) > ROOM_CHAT_TTL) return [];
    try {
        const value: unknown = JSON.parse(raw);
        return Array.isArray(value) ? value.filter(isMessage).filter((pin) => !isPrivateMessage(pin)) : [];
    } catch {
        return [];
    }
}
