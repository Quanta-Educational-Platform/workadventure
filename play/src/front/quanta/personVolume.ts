// quanta: this viewer's own listening volume for each person in the room, the same in the menu on their video tile and
// in the platform's people list (by account uuid). It is their voice: the audio of their camera stream, which keeps it
// when the stream starts again (a reconnection, a move between P2P and LiveKit). Never sent to anyone else.
import { derived, get, writable, type Readable, type Unsubscriber } from "svelte/store";
import type { VideoBox } from "../Space/VideoBox";
import type { Streamable } from "../Space/Streamable";
import { fromPlatform, platformOrigin } from "./platformOrigin";
import { roomModerationStore } from "./moderationBridge";

const chosen = writable<ReadonlyMap<string, number>>(new Map());

export function clampVolume(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined;
}

export function setPersonVolume(uuid: string, volume: number): void {
    const value = clampVolume(volume);
    if (value === undefined || get(chosen).get(uuid) === value) return;
    chosen.update((all) => new Map(all).set(uuid, value));
}

/**
 * Everyone else in the room and how loud this viewer hears them: what they chose, or the volume streams start at.
 * Rounded, so a slider dragged across the room is not a message per pixel of precision.
 */
export function personVolumesStore(defaultVolume: Readable<number>): Readable<Record<string, number>> {
    return derived([chosen, roomModerationStore, defaultVolume], ([$chosen, room, $default]) => {
        const volumes: Record<string, number> = {};
        for (const person of room?.people ?? [])
            if (person.id !== room?.self)
                volumes[person.id] = Math.round(($chosen.get(person.id) ?? $default) * 100) / 100;
        return volumes;
    });
}

function isVoice(streamable: Streamable | undefined): streamable is Streamable {
    return !!streamable && streamable.videoType === "video";
}

/**
 * Keeps each person's voice stream at their chosen volume, and a change on a tile as their chosen volume. Only a change
 * the viewer made counts as a choice: a stream's starting volume and our own updates of it are not.
 */
export function bindVoices(boxes: Readable<ReadonlyMap<string, VideoBox>>): Unsubscriber {
    // By key and box: a person's box can be replaced under the same key (a move between spaces).
    const bound = new Map<string, { box: VideoBox; unbind: Unsubscriber }>();
    const stop = boxes.subscribe((all) => {
        for (const [key, entry] of bound)
            if (all.get(key) !== entry.box) {
                entry.unbind();
                bound.delete(key);
            }
        for (const [key, box] of all) {
            const uuid = box.spaceUser?.uuid;
            if (bound.has(key) || !uuid) continue;
            let unbindStream: Unsubscriber | undefined;
            const unbindBox = box.streamable.subscribe((streamable) => {
                unbindStream?.();
                unbindStream = undefined;
                if (!isVoice(streamable)) return;
                let applying = false;
                const toStream = chosen.subscribe((volumes) => {
                    const volume = volumes.get(uuid);
                    if (volume === undefined || volume === get(streamable.volume)) return;
                    applying = true;
                    try {
                        streamable.volume.set(volume);
                    } finally {
                        applying = false;
                    }
                });
                let initial = true;
                const fromStream = streamable.volume.subscribe((volume) => {
                    if (initial) {
                        initial = false;
                        return;
                    }
                    if (!applying) setPersonVolume(uuid, volume);
                });
                unbindStream = () => {
                    toStream();
                    fromStream();
                };
            });
            bound.set(key, {
                box,
                unbind: () => {
                    unbindBox();
                    unbindStream?.();
                },
            });
        }
    });
    return () => {
        stop();
        for (const entry of bound.values()) entry.unbind();
        bound.clear();
    };
}

/**
 * The people list's volume slider: the room reports everyone's volume (`quanta_wa_volumes`) and takes the platform's
 * `quanta_wa_set_volume` for someone actually in the room, never oneself.
 */
export function startVolumeBridge(volumes: Readable<Record<string, number>>): Unsubscriber {
    if (window.parent === window) return () => {};
    let last = "";
    const publish = (value: Record<string, number>, force = false) => {
        const origin = platformOrigin();
        const key = JSON.stringify(value);
        if (!origin || (key === last && !force)) return;
        last = key;
        window.parent.postMessage({ type: "quanta_wa_volumes", volumes: value }, origin);
    };
    const stop = volumes.subscribe((value) => publish(value));
    const receive = (event: MessageEvent) => {
        if (!fromPlatform(event)) return;
        const data = event.data as { type?: unknown; id?: unknown; volume?: unknown } | null;
        if (data?.type === "quanta_wa_volumes_request") return publish(get(volumes), true);
        if (data?.type !== "quanta_wa_set_volume" || typeof data.id !== "string" || data.id.length > 200) return;
        const volume = clampVolume(data.volume);
        const room = get(roomModerationStore);
        const id = data.id;
        if (volume === undefined || !room || id === room.self || !room.people.some((person) => person.id === id))
            return;
        setPersonVolume(id, volume);
    };
    window.addEventListener("message", receive);
    return () => {
        stop();
        window.removeEventListener("message", receive);
    };
}

export function resetPersonVolumesForTests(): void {
    chosen.set(new Map());
}
