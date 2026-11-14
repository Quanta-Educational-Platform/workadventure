// quanta: staff can look at the room as a student does. It changes this person's own screen only: the room's server
// still has them as staff, and everyone else still sees a teacher.
import { derived, get, writable } from "svelte/store";
import { QUANTA_UI } from "../Enum/EnvironmentVariable";
import { userIsAdminStore } from "../Stores/GameStore";
import { platformOrigin } from "./platformOrigin";

const roomAdminStore = writable(false);
const wantedStore = writable(false);

export const canViewAsStudentStore = derived(roomAdminStore, ($admin) => QUANTA_UI && $admin);
export const studentViewStore = derived(
    [roomAdminStore, wantedStore],
    ([$admin, $wanted]) => QUANTA_UI && $admin && $wanted,
);

/** What the room says this person is, once connected; their view of it follows. */
export function setRoomAdmin(isAdmin: boolean): void {
    roomAdminStore.set(isAdmin);
    userIsAdminStore.set(isAdmin && !get(studentViewStore));
}

export function setStudentView(on: boolean): void {
    wantedStore.set(on);
    userIsAdminStore.set(get(roomAdminStore) && !get(studentViewStore));
    const origin = platformOrigin();
    if (origin && window.parent !== window)
        window.parent.postMessage({ type: "quanta_wa_student_view", on: get(studentViewStore) }, origin);
}

/** What moderation offers this view: staff previewing as a student are offered what a student is. */
export function moderationInView(canModerate: boolean, studentView: boolean): boolean {
    return canModerate && !studentView;
}
