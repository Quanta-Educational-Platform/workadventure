// quanta: the real names Quanta tells this viewer, by Quanta user id, for the room's teachers and admins alone: for
// anyone else, and in student view, the page sends none, so the room shows usernames. Held in this viewer's page only.
import { writable } from "svelte/store";

const MAX_NAME = 64;

export const fullNamesStore = writable<ReadonlyMap<string, string>>(new Map());

/** What to call a player: their real name where Quanta sent this viewer one, else the name the room has for them. */
export function shownName(names: ReadonlyMap<string, string>, uuid: string | null | undefined, name: string): string {
    return (uuid && names.get(uuid)) || name;
}

export function setFullNames(names: unknown): void {
    if (!names || typeof names !== "object") return;
    const valid = Object.entries(names).flatMap(([uuid, name]) =>
        typeof name === "string" && name.trim() ? [[uuid, name.trim().slice(0, MAX_NAME)] as const] : [],
    );
    fullNamesStore.set(new Map(valid));
}
