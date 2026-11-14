// quanta: a teacher only receives what happens near their own view, so a student's reaction or bubble elsewhere in the
// room never reaches them. Students report these over the class chat's space and the room's server tells only staff;
// those out of view show in a small corner list. One row per person, so someone spamming can't fill the screen.
import { get, writable } from "svelte/store";
import { z } from "zod";
import { gameManager } from "../Phaser/Game/GameManager";
import { userIsAdminStore } from "../Stores/GameStore";
import { classChatRoom } from "./chatAudience";

export type ActivityKind = "emote" | "say" | "think";

export interface ActivityRow {
    uuid: string;
    name: string;
    kind: ActivityKind;
    text: string;
    at: number;
}

const HOLD_MS = 6000;
const KEPT = 20;
const update = z.object({
    activity: z.object({
        uuid: z.string(),
        name: z.string(),
        kind: z.enum(["emote", "say", "think"]),
        text: z.string(),
    }),
});

/** Newest first. */
export const activityRowsStore = writable<ActivityRow[]>([]);

export function reportRoomActivity(kind: ActivityKind, text: string): void {
    if (get(userIsAdminStore) || !text.trim()) return;
    classChatRoom()?.reportActivity(kind, text);
}

function inView(uuid: string): boolean {
    try {
        const scene = gameManager.getCurrentGameScene();
        for (const player of scene.MapPlayersByKey.values())
            if (player.userUuid === uuid) return scene.cameras.main.worldView.contains(player.x, player.y);
    } catch {
        // Not in the room: nothing is in view.
    }
    return false;
}

let expiry: ReturnType<typeof setTimeout> | undefined;
function expireRows(): void {
    clearTimeout(expiry);
    const now = Date.now();
    activityRowsStore.update((rows) => rows.filter((row) => now - row.at < HOLD_MS));
    const oldest = get(activityRowsStore).at(-1);
    if (oldest) expiry = setTimeout(expireRows, oldest.at + HOLD_MS - now);
}

/** Whether this update from the room's server was an activity: nothing else of the chat's cares about it. */
export function receiveRoomActivity(raw: unknown): boolean {
    const parsed = update.safeParse(raw);
    if (!parsed.success) return false;
    const { uuid, name, kind, text } = parsed.data.activity;
    if (!get(userIsAdminStore) || inView(uuid)) return true;
    activityRowsStore.update((rows) =>
        [{ uuid, name, kind, text, at: Date.now() }, ...rows.filter((row) => row.uuid !== uuid)].slice(0, KEPT),
    );
    expireRows();
    return true;
}
