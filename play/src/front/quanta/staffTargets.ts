import { QUANTA_UI } from "../Enum/EnvironmentVariable";

/** The room's staff by user uuid, from the room's moderation state (everyone in the room, not only who one sees). */
let staffUuids: ReadonlySet<string> = new Set();
let knownUuids: ReadonlySet<string> = new Set();

export function setRoomStaff(people: ReadonlyArray<{ id: string; staff: boolean }>): void {
    staffUuids = new Set(people.filter((person) => person.staff).map((person) => person.id));
    knownUuids = new Set(people.map((person) => person.id));
}

/**
 * Whether someone runs the room, from what is known of them: the room's own list, else the tags their space gave
 * them. Undefined when neither knows them (just joined, in no call): the person menus then treat them as staff, so a
 * student is never offered to block or report someone who may be the teacher.
 */
export function staffTarget(uuid: string, tags?: ReadonlyArray<string>): boolean | undefined {
    if (knownUuids.has(uuid)) return staffUuids.has(uuid);
    if (tags?.includes("admin")) return true;
    return tags && tags.length > 0 ? false : undefined;
}

/**
 * Whether the block / report actions are offered on someone. In a Quanta classroom nobody blocks or reports the
 * teachers (the admin tag): a student who blocked the teacher would silently stop seeing and hearing the lesson.
 * Classmates stay blockable: blocking only hides them from the one who blocks, and class moderation itself is the
 * teachers', from the platform.
 */
export function mayBlockOrReport(
    target: { uuid?: string; tags?: ReadonlyArray<string>; isAdmin?: boolean },
    quantaUi = QUANTA_UI,
): boolean {
    if (!quantaUi) return true;
    if (target.isAdmin || target.tags?.includes("admin")) return false;
    return !(target.uuid && staffUuids.has(target.uuid));
}
