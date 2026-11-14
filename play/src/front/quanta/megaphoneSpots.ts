// quanta: a table's megaphone spot (a map area named "quanta:megaphone:…"). Whoever stands on it speaks to the whole
// class at once, teacher or student, as on the podium; the teacher can still turn a student's microphone off.
import type { AreaData, SpeakerMegaphonePropertyData } from "@workadventure/map-editor";
import { writable } from "svelte/store";

export const MEGAPHONE_SPOT_PREFIX = "quanta:megaphone:";

/** What standing on a spot means for this player when they are not on air, for the dock to tell them. */
export type SpotStanding = "none" | "micOff" | "stepAgain";
export const spotStandingStore = writable<SpotStanding>("none");

export const isMegaphoneSpot = (area: { name?: string }) => (area.name ?? "").startsWith(MEGAPHONE_SPOT_PREFIX);

/**
 * The lecture a spot is in: the speaker zone of a listener zone covering the spot's centre. Whoever stands on the
 * spot speaks in it, so every listener hears them, in a bubble or not. The property carries its own id, so the spot is
 * tracked apart from the speaker zone itself.
 */
export function lectureSpeakerZoneOf(
    spot: AreaData,
    areas: Iterable<AreaData>,
): { areaId: string; property: SpeakerMegaphonePropertyData } | undefined {
    if (!isMegaphoneSpot(spot)) return undefined;
    const all = [...areas];
    const cx = spot.x + spot.width / 2;
    const cy = spot.y + spot.height / 2;
    for (const area of all) {
        if (cx < area.x || cx > area.x + area.width || cy < area.y || cy > area.y + area.height) continue;
        for (const listener of area.properties) {
            if (listener.type !== "listenerMegaphone") continue;
            const speakerArea = all.find((candidate) => candidate.id === listener.speakerZoneName);
            const speaker = speakerArea?.properties.find(
                (property): property is SpeakerMegaphonePropertyData => property.type === "speakerMegaphone",
            );
            if (speakerArea && speaker)
                return { areaId: speakerArea.id, property: { ...speaker, id: `${speaker.id}:${spot.id}` } };
        }
    }
    return undefined;
}

/**
 * The class's lecture, which staff speak in from anywhere (the dock's megaphone button): the speaker zone whose
 * listener zones hold `at`, else the one whose listener zones cover the most of the map. Like a spot's, its property
 * carries its own id, so it is tracked apart from the podium the teacher may also stand on.
 */
export function classLectureOf(
    areas: Iterable<AreaData>,
    at?: { x: number; y: number },
): { areaId: string; property: SpeakerMegaphonePropertyData } | undefined {
    const all = [...areas];
    type Candidate = { areaId: string; property: SpeakerMegaphonePropertyData; holds: boolean; cover: number };
    const candidates = new Map<string, Candidate>();
    for (const area of all) {
        for (const listener of area.properties) {
            if (listener.type !== "listenerMegaphone") continue;
            let candidate = candidates.get(listener.speakerZoneName);
            if (!candidate) {
                const speakerArea = all.find((other) => other.id === listener.speakerZoneName);
                const speaker = speakerArea?.properties.find(
                    (property): property is SpeakerMegaphonePropertyData => property.type === "speakerMegaphone",
                );
                if (!speakerArea || !speaker) continue;
                candidate = { areaId: speakerArea.id, property: speaker, holds: false, cover: 0 };
                candidates.set(listener.speakerZoneName, candidate);
            }
            candidate.cover += area.width * area.height;
            if (at && at.x >= area.x && at.x <= area.x + area.width && at.y >= area.y && at.y <= area.y + area.height)
                candidate.holds = true;
        }
    }
    let best: Candidate | undefined;
    for (const candidate of candidates.values())
        if (
            !best ||
            (candidate.holds && !best.holds) ||
            (candidate.holds === best.holds && candidate.cover > best.cover)
        )
            best = candidate;
    return best && { areaId: best.areaId, property: { ...best.property, id: `${best.property.id}:class` } };
}

const silenceListeners = new Set<() => void>();

/**
 * A teacher forced this user's microphone off. Whoever was speaking from a spot stops speaking to the class, so they
 * cannot turn the microphone back on and carry on; stepping off the spot and back on lets them speak again.
 */
export function silenceSpotSpeaker(): void {
    for (const listener of silenceListeners) listener();
}

export function onSpotSpeakerSilenced(listener: () => void): () => void {
    silenceListeners.add(listener);
    return () => silenceListeners.delete(listener);
}

/**
 * The lectures the player speaks in from the spots they stand on, by spot area id. `speak` makes them a speaker of a
 * lecture (aborted by the signal when they step off before it is done); `stop` ends that. A silenced spot keeps its
 * entry, so the player only speaks from it again once they stepped off and back on.
 */
export class SpotLectures<Lecture> {
    private readonly spots = new Map<string, { lecture: Lecture; abort: AbortController; silenced: boolean }>();

    constructor(
        private readonly speak: (lecture: Lecture, signal: AbortSignal) => void,
        private readonly stop: (lecture: Lecture) => void,
    ) {}

    public enter(spotId: string, lecture: Lecture): void {
        if (this.spots.has(spotId)) return;
        const abort = new AbortController();
        this.spots.set(spotId, { lecture, abort, silenced: false });
        this.speak(lecture, abort.signal);
    }

    public has(spotId: string): boolean {
        return this.spots.has(spotId);
    }

    public leave(spotId: string): void {
        const spot = this.spots.get(spotId);
        if (!spot) return;
        this.spots.delete(spotId);
        spot.abort.abort();
        if (!spot.silenced) this.stop(spot.lecture);
    }

    /** Returns how many spots went silent: none when the player was not speaking from one. */
    public silence(): number {
        let silenced = 0;
        for (const spot of this.spots.values()) {
            if (spot.silenced) continue;
            spot.silenced = true;
            spot.abort.abort();
            this.stop(spot.lecture);
            silenced++;
        }
        return silenced;
    }

    public clear(): void {
        for (const spot of this.spots.values()) spot.abort.abort();
        this.spots.clear();
    }
}

/**
 * Who stands on a spot speaks to the class only with the microphone on and outside a bubble: a microphone that is off
 * reaches nobody, so its owner stays an ordinary person a teacher can walk up to and talk with. Someone in a bubble on
 * a spot stays in it when they unmute, or an answer to the teacher would reach the whole class; they go on air by
 * stepping off and back on, as after being stopped.
 */
export class SpotStands<Lecture> {
    private readonly stands = new Map<string, { lecture: Lecture; stepAgain: boolean; stopped: boolean }>();

    constructor(
        private readonly lectures: SpotLectures<Lecture>,
        private readonly micOn: () => boolean,
        private readonly inBubble: () => boolean,
    ) {}

    public has(spotId: string): boolean {
        return this.stands.has(spotId);
    }

    public enter(spotId: string, lecture: Lecture): void {
        if (this.stands.has(spotId)) return;
        this.stands.set(spotId, { lecture, stepAgain: false, stopped: false });
        this.update();
    }

    public leave(spotId: string): void {
        this.stands.delete(spotId);
        this.lectures.leave(spotId);
        this.update();
    }

    /** Stops whoever is on air from a spot, until they step off and back on. How many spots went silent. */
    public silence(): number {
        for (const [spotId, stand] of this.stands)
            if (this.lectures.has(spotId)) {
                stand.stepAgain = true;
                stand.stopped = true;
            }
        const silenced = this.lectures.silence();
        this.update();
        return silenced;
    }

    public clear(): void {
        this.stands.clear();
        this.lectures.clear();
        spotStandingStore.set("none");
    }

    /** Brings the spots in line with the microphone and the bubble, after either changed or the player moved. */
    public update(): void {
        const micOn = this.micOn();
        const inBubble = this.inBubble();
        let standing: SpotStanding = "none";
        for (const [spotId, stand] of this.stands) {
            if (inBubble) stand.stepAgain = true;
            const speak = micOn && !stand.stepAgain;
            if (speak && !this.lectures.has(spotId)) this.lectures.enter(spotId, stand.lecture);
            else if (!speak && this.lectures.has(spotId)) this.lectures.leave(spotId);
            if (!micOn && !stand.stepAgain) standing = "micOff";
            else if (micOn && stand.stepAgain && !stand.stopped && standing === "none") standing = "stepAgain";
        }
        spotStandingStore.set(standing);
    }
}
