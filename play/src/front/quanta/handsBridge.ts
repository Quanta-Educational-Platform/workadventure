import { derived, get, readable, type Unsubscriber } from "svelte/store";
import { raisedHandSectionsStore } from "../Stores/PeerStore";
import { userIsAdminStore } from "../Stores/GameStore";
import { sectionRights } from "../Stores/RaisedHandsAdminVisibleStore";
import { currentLiveStreamingSpaceStore, givenFloorSpaceStore } from "../Stores/MegaphoneStore";
import type { FloorSpeaker, RaisedHandSection, SpaceInterface } from "../Space/SpaceInterface";
import { fromPlatform } from "./platformOrigin";
import { goTo } from "./goTo";
import { selfOnAirMutedStore, selfOnAirStore } from "./speakingToClass";
import { setFullNames } from "./fullNames";
import { setWorkspaceBrand } from "./brandAreas";
import { speakerSoundStore, type SpeakerSound } from "./onAir";

/**
 * Under the docked UI every hand goes up in the room's own queue, which has no floor of its own. A host in a lecture
 * lets a student from that queue speak in the lecture. A user's space id is the same in every space of the room, and
 * the host may not see the listeners (megaphone without seeAttendees): the back checks they are in the lecture.
 */
function lectureOf(section: RaisedHandSection, live: SpaceInterface | undefined) {
    return live && section.space !== live ? live : undefined;
}

// Who holds the floor in the lecture: under the docked UI the lecture is not one of the hand sections.
const lectureSpeakersStore = derived<typeof currentLiveStreamingSpaceStore, FloorSpeaker[]>(
    currentLiveStreamingSpaceStore,
    (live, set) => (live ? live.state.speakingUsersStore.subscribe(set) : set([])),
    [],
);

// Who speaks to the class from a megaphone spot: a speaker of the lecture who was not given the floor, so the back has
// no floor to take back. A listener of a lecture without seeAttendees sees only its speakers. Teachers are left out.
// Someone on a spot with the microphone off is listed as muted: not heard, but the teacher can still take them off.
const spotSpeakersStore = derived<typeof currentLiveStreamingSpaceStore, (FloorSpeaker & { muted: boolean })[]>(
    currentLiveStreamingSpaceStore,
    (live, set) => {
        if (!live) {
            set([]);
            return;
        }
        // Each candidate's own megaphone and microphone state: the list of users only changes when someone comes or
        // goes, not when a student back on a spot turns the microphone on.
        let onAir: Unsubscriber | undefined;
        const stopUsers = live.usersStore.subscribe((users) => {
            onAir?.();
            const candidates = [...users.values()].filter(
                (user) => user.spaceUserId !== live.mySpaceUserId && !user.tags.includes("admin"),
            );
            if (candidates.length === 0) {
                onAir = undefined;
                set([]);
                return;
            }
            onAir = derived(
                candidates.map((user) =>
                    user.reactiveUser
                        ? derived(
                              [user.reactiveUser.megaphoneState, user.reactiveUser.microphoneState],
                              ([megaphone, microphone]) => ({ onSpot: megaphone, muted: !microphone }),
                          )
                        : readable({ onSpot: user.megaphoneState, muted: !user.microphoneState }),
                ),
                (states) =>
                    candidates.flatMap((user, index) =>
                        states[index].onSpot
                            ? [{ spaceUserId: user.spaceUserId, name: user.name, muted: states[index].muted }]
                            : [],
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

// Whether sound from each student on air in the lecture reaches this host, as it reaches the class. Only a host
// listens for it; the ids are joined so an unchanged list does not start over.
const onAirIdsStore = derived(
    [userIsAdminStore, lectureSpeakersStore, spotSpeakersStore],
    ([isAdmin, lectureSpeakers, spotSpeakers]) =>
        isAdmin
            ? [...new Set([...lectureSpeakers, ...spotSpeakers].map((speaker) => speaker.spaceUserId))].join("\n")
            : "",
);
const speakerSoundsStore = derived<
    [typeof currentLiveStreamingSpaceStore, typeof onAirIdsStore],
    Map<string, SpeakerSound>
>(
    [currentLiveStreamingSpaceStore, onAirIdsStore],
    ([live, ids], set) => speakerSoundStore(live, ids ? ids.split("\n") : []).subscribe(set),
    new Map(),
);

export interface HandsState {
    /** One entry per person (a hand raised in two spaces at once), ordered by when it first went up. `floor`: this
     * host may let them speak to the whole class (their hand is up in a lecture space the host runs). `uuid`: the
     * person behind the hand, whom the host may let draw on the board (quanta/boardAccess.ts). */
    queue: { id: string; uuid?: string; name: string; at: number; self: boolean; floor: boolean }[];
    canLowerAll: boolean;
    /** Students speaking to the whole class whom this host may stop; `uuid` finds them in the people list. */
    /** `muted`: on a megaphone spot with the microphone off: not heard, but still on it. `talking`: their sound
     * reaches this host now; `quiet`: none has for a while (onAir.ts). Both known only for the lecture's speakers. */
    speaking: { id: string; uuid?: string; name: string; muted?: boolean; talking?: boolean; quiet?: boolean }[];
    selfSpeaking: boolean;
    /** On air with the microphone off: the class hears nothing until it is turned on. */
    selfMuted: boolean;
}

/** The room's hands and who speaks to the class, as this person may act on them: the platform and video tiles. */
export const handsStateStore = derived(
    [
        raisedHandSectionsStore,
        userIsAdminStore,
        givenFloorSpaceStore,
        currentLiveStreamingSpaceStore,
        lectureSpeakersStore,
        spotSpeakersStore,
        selfOnAirStore,
        selfOnAirMutedStore,
        speakerSoundsStore,
    ],
    ([
        sections,
        isAdmin,
        givenFloor,
        live,
        lectureSpeakers,
        spotSpeakers,
        selfOnAir,
        selfOnAirMuted,
        sounds,
    ]): HandsState => {
        const raised = new Map<string, HandsState["queue"][number]>();
        const speaking = new Map<string, HandsState["speaking"][number]>();
        for (const section of sections) {
            const { floorControls } = sectionRights(section, isAdmin);
            for (const hand of section.hands) {
                const seen = raised.get(hand.spaceUserId);
                raised.set(hand.spaceUserId, {
                    id: hand.spaceUserId,
                    uuid: seen?.uuid ?? section.space.getSpaceUserBySpaceUserId?.(hand.spaceUserId)?.uuid,
                    name: hand.name,
                    at: seen ? Math.min(seen.at, hand.at) : hand.at,
                    self: hand.spaceUserId === section.space.mySpaceUserId,
                    floor:
                        (seen?.floor ?? false) || floorControls || (isAdmin && lectureOf(section, live) !== undefined),
                });
            }
            if (floorControls)
                for (const speaker of section.speakers)
                    speaking.set(speaker.spaceUserId, {
                        id: speaker.spaceUserId,
                        uuid: section.space.getSpaceUserBySpaceUserId?.(speaker.spaceUserId)?.uuid,
                        name: speaker.name,
                    });
        }
        if (isAdmin && live)
            for (const speaker of [...lectureSpeakers, ...spotSpeakers]) {
                const sound = sounds.get(speaker.spaceUserId);
                speaking.set(speaker.spaceUserId, {
                    id: speaker.spaceUserId,
                    uuid: live.getSpaceUserBySpaceUserId?.(speaker.spaceUserId)?.uuid,
                    name: speaker.name,
                    ...("muted" in speaker && speaker.muted ? { muted: true } : {}),
                    ...(sound ? { talking: sound.talking, quiet: sound.quiet } : {}),
                });
            }
        return {
            queue: [...raised.values()].sort((a, b) => a.at - b.at),
            canLowerAll: sections.some(
                (section) => section.hands.length > 0 && sectionRights(section, isAdmin).canModerate,
            ),
            speaking: [...speaking.values()],
            selfSpeaking: givenFloor !== undefined || selfOnAir,
            selfMuted: selfOnAir && selfOnAirMuted,
        };
    },
);

/** The same person in `space`: by space id, or by account, since the hand and the floor may be in different spaces. */
function samePerson(space: SpaceInterface, spaceUserId: string, target: { id: string; uuid?: string }): boolean {
    return (
        spaceUserId === target.id ||
        (target.uuid !== undefined && space.getSpaceUserBySpaceUserId?.(spaceUserId)?.uuid === target.uuid)
    );
}

/** Gives `floorSpace`'s floor to the hand, then lowers the hand once the floor is theirs: the back refuses someone no
 * longer there, and a refusal resolves too. */
function giveFloorAndLowerHand(floorSpace: SpaceInterface, handSpace: SpaceInterface, hand: string): void {
    const uuid = handSpace.getSpaceUserBySpaceUserId?.(hand)?.uuid;
    const target = (uuid !== undefined ? floorSpace.getSpaceUserByUuid?.(uuid)?.spaceUserId : undefined) ?? hand;
    floorSpace.state
        .giveFloor(target)
        .then(() =>
            get(floorSpace.state.speakingUsersStore).some((speaker) =>
                samePerson(floorSpace, speaker.spaceUserId, { id: target, uuid }),
            )
                ? handSpace.state.lowerHand(hand)
                : undefined,
        )
        .catch((error) => console.error(error));
}

/** Lets a student whose hand is up speak to the whole class: only a host's rights, which the back checks again. */
export function giveFloorTo(target: string): void {
    const isAdmin = get(userIsAdminStore);
    const live = get(currentLiveStreamingSpaceStore);
    for (const section of get(raisedHandSectionsStore)) {
        if (!section.hands.some((hand) => hand.spaceUserId === target)) continue;
        // A hand from the room's queue: the floor is given in the lecture.
        const lecture = isAdmin ? lectureOf(section, live) : undefined;
        if (lecture) giveFloorAndLowerHand(lecture, section.space, target);
        else if (sectionRights(section, isAdmin).floorControls)
            giveFloorAndLowerHand(section.space, section.space, target);
    }
}

/** Stops a student speaking to the whole class. */
export function revokeFloorFrom(target: string): void {
    const isAdmin = get(userIsAdminStore);
    const live = get(currentLiveStreamingSpaceStore);
    if (isAdmin && live && get(lectureSpeakersStore).some((speaker) => speaker.spaceUserId === target)) {
        live.state.revokeFloor(target).catch((error) => console.error(error));
        return;
    }
    // A spot's speaker holds no floor: taking it back turns their microphone off (forced, from an admin).
    if (isAdmin && live && get(spotSpeakersStore).some((speaker) => speaker.spaceUserId === target)) {
        live.emitPrivateMessage({ $case: "muteAudio", muteAudio: { force: true } }, target);
        return;
    }
    for (const section of get(raisedHandSectionsStore)) {
        if (!sectionRights(section, isAdmin).floorControls) continue;
        if (section.speakers.some((speaker) => speaker.spaceUserId === target))
            section.space.state.revokeFloor(target).catch((error) => console.error(error));
    }
}

export function startHandsBridge(): () => void {
    if (window.parent === window) return () => {};
    let last = "";
    const unsubscribe = handsStateStore.subscribe(({ queue, canLowerAll, speaking, selfSpeaking, selfMuted }) => {
        const message = {
            type: "quanta_wa_hands",
            hands: queue.map((hand) => hand.name),
            queue,
            canLowerAll,
            speaking,
            selfSpeaking,
            selfMuted,
        };
        const key = JSON.stringify(message);
        if (key === last) return;
        last = key;
        window.parent.postMessage(message, "*");
    });

    const onMessage = (event: MessageEvent) => {
        if (event.source !== window.parent) return;
        const type = (event.data as { type?: unknown } | null)?.type;
        if (type === "quanta_wa_full_names") {
            setFullNames((event.data as { names?: unknown }).names);
            return;
        }
        if (type === "quanta_wa_workspace") {
            if (!fromPlatform(event)) return;
            setWorkspaceBrand(event.data);
            return;
        }
        // The platform asks again once the frame has loaded (it clears its list then): answer even if unchanged.
        if (type === "quanta_wa_hands_request") {
            if (last) window.parent.postMessage(JSON.parse(last), "*");
            return;
        }
        // The platform's people list shows the same queue: its own card over the map would repeat it while open.
        if (type === "quanta_wa_people_panel") {
            if (!fromPlatform(event)) return;
            document.documentElement.classList.toggle(
                "quanta-people-open",
                (event.data as { open?: unknown }).open === true,
            );
            return;
        }
        // Letting a student speak to the whole class, or taking it back: only the platform asks, only a host's rights.
        if (type === "quanta_wa_give_floor" || type === "quanta_wa_revoke_floor") {
            if (!fromPlatform(event)) return;
            const target = (event.data as { id?: unknown }).id;
            if (typeof target !== "string" || !target) return;
            if (type === "quanta_wa_give_floor") giveFloorTo(target);
            else revokeFloorFrom(target);
            return;
        }
        // A teacher jumps to a student (a raised hand's id, or a uuid from the people list): only a host, only asked
        // by the platform.
        if (type === "quanta_wa_go_to") {
            if (!fromPlatform(event) || !get(userIsAdminStore)) return;
            const { id, uuid } = event.data as { id?: unknown; uuid?: unknown };
            const target = {
                id: typeof id === "string" && id ? id.slice(0, 300) : undefined,
                uuid: typeof uuid === "string" && uuid ? uuid.slice(0, 200) : undefined,
            };
            if (!target.id && !target.uuid) return;
            try {
                goTo(target);
            } catch (error) {
                console.error(error);
            }
            return;
        }
        if (type !== "quanta_wa_lower_all_hands" && type !== "quanta_wa_lower_hand") return;
        const target = (event.data as { id?: unknown }).id;
        const isAdmin = get(userIsAdminStore);
        for (const section of get(raisedHandSectionsStore)) {
            if (!sectionRights(section, isAdmin).canModerate) continue;
            for (const hand of section.hands) {
                if (type === "quanta_wa_lower_hand" && hand.spaceUserId !== target) continue;
                section.space.state.lowerHand(hand.spaceUserId).catch((error) => console.error(error));
            }
        }
    };
    window.addEventListener("message", onMessage);

    return () => {
        unsubscribe();
        window.removeEventListener("message", onMessage);
        // The dock goes with an error screen (a reconnect, the room opened elsewhere): the platform must not keep
        // showing hands or "speaking to the whole class" from before it.
        if (last)
            window.parent.postMessage(
                {
                    type: "quanta_wa_hands",
                    hands: [],
                    queue: [],
                    canLowerAll: false,
                    speaking: [],
                    selfSpeaking: false,
                    selfMuted: false,
                },
                "*",
            );
        // A list closed while nothing listened must not leave the room's own card hidden; the platform tells the next
        // bridge again when it reports hands.
        document.documentElement.classList.remove("quanta-people-open");
    };
}
