// quanta: staff are told when a colleague on air to the class has a weak link (LiveKit's rating of that person, held as
// their tile's amber mark holds it: Livekit/WeakConnection.ts), so another of them can take over. The weak presenter
// hears about their own link from WeakLinkNotice.ts. Once per weak spell; a spell that starts again within a few
// minutes of the last notice about that person counts as the same one. Never to students.
import { derived, get, readable, writable, type Readable, type Unsubscriber } from "svelte/store";
import { weakPeersStore } from "../Livekit/WeakConnection";
import { currentLiveStreamingSpaceStore } from "../Stores/MegaphoneStore";
import { userIsAdminStore } from "../Stores/GameStore";
import { fullNamesStore, shownName } from "./fullNames";
import { nameTag } from "./nameTag";
import { staffTarget } from "./staffTargets";

const RETELL_MS = 3 * 60_000;

interface OnAirStaff {
    spaceUserId: string;
    uuid: string;
    name: string;
}

/** The room's staff other than this person on air in the class lecture (podium, or speaking to the class). */
const onAirStaffStore = derived<typeof currentLiveStreamingSpaceStore, OnAirStaff[]>(
    currentLiveStreamingSpaceStore,
    (live, set) => {
        if (!live) {
            set([]);
            return;
        }
        // Each one's megaphone state: the list of users only changes when someone comes or goes.
        let onAir: Unsubscriber | undefined;
        const stopUsers = live.usersStore.subscribe((users) => {
            onAir?.();
            const candidates = [...users.values()].filter(
                (user) => user.spaceUserId !== live.mySpaceUserId && staffTarget(user.uuid, user.tags) === true,
            );
            if (candidates.length === 0) {
                onAir = undefined;
                set([]);
                return;
            }
            onAir = derived(
                candidates.map((user) =>
                    user.reactiveUser ? user.reactiveUser.megaphoneState : readable(user.megaphoneState),
                ),
                (states) =>
                    candidates.flatMap((user, index) =>
                        states[index] ? [{ spaceUserId: user.spaceUserId, uuid: user.uuid, name: user.name }] : [],
                    ),
            ).subscribe(set);
        });
        return () => {
            stopUsers();
            onAir?.();
        };
    },
    [],
);

const weakPresentersStore = derived([onAirStaffStore, weakPeersStore], ([staff, weak]) =>
    staff.filter((person) => weak.has(person.spaceUserId)),
);

/** Whom the notice is about now. */
const shownStore = writable<string | undefined>(undefined);
/** People whose weak spell has had its notice (shown, closed, or folded into the last one), until the spell ends. */
const told = new Set<string>();
const lastToldAt = new Map<string, number>();
/** Closed by this viewer: not told about that person again this session, however often their link flaps. */
const dismissed = new Set<string>();

function consider(weak: OnAirStaff[], staffViewer: boolean): void {
    const ids = new Set(weak.map((person) => person.spaceUserId));
    for (const id of [...told]) if (!ids.has(id)) told.delete(id);
    const shown = get(shownStore);
    if (!staffViewer || (shown !== undefined && !ids.has(shown))) shownStore.set(undefined);
    if (!staffViewer || get(shownStore) !== undefined) return;
    const now = Date.now();
    for (const person of weak) {
        if (told.has(person.spaceUserId) || dismissed.has(person.spaceUserId)) continue;
        told.add(person.spaceUserId);
        if (now - (lastToldAt.get(person.spaceUserId) ?? 0) < RETELL_MS) continue;
        lastToldAt.set(person.spaceUserId, now);
        shownStore.set(person.spaceUserId);
        return;
    }
}

let watchers = 0;
let stopWatching: Unsubscriber | undefined;

/** Watches while the dock is up; the notice is in `presenterWeakNoticeStore`. */
export function startPresenterLinkWatch(): () => void {
    watchers++;
    if (watchers === 1)
        stopWatching = derived([weakPresentersStore, userIsAdminStore], (values) => values).subscribe(
            ([weak, staff]) => consider(weak, staff),
        );
    let stopped = false;
    return () => {
        if (stopped) return;
        stopped = true;
        watchers--;
        if (watchers > 0) return;
        stopWatching?.();
        stopWatching = undefined;
        shownStore.set(undefined);
    };
}

/** Closed: not again about that person this session; someone else's weak link may show next. */
export function dismissPresenterWeakNotice(): void {
    const shown = get(shownStore);
    if (shown !== undefined) dismissed.add(shown);
    shownStore.set(undefined);
    consider(get(weakPresentersStore), get(userIsAdminStore));
}

export interface PresenterWeakNotice {
    spaceUserId: string;
    /** As staff see names elsewhere: the real one where Quanta sent it, short as on the on-air line. */
    name: string;
}

export const presenterWeakNoticeStore: Readable<PresenterWeakNotice | undefined> = derived(
    [shownStore, weakPresentersStore, fullNamesStore],
    ([shown, weak, names]) => {
        const person = shown === undefined ? undefined : weak.find((entry) => entry.spaceUserId === shown);
        return person
            ? { spaceUserId: person.spaceUserId, name: nameTag(shownName(names, person.uuid, person.name)) }
            : undefined;
    },
);
