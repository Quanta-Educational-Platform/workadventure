import { expect, it, vi } from "vitest";
import type { AreaData } from "@workadventure/map-editor";
import {
    classLectureOf,
    lectureSpeakerZoneOf,
    onSpotSpeakerSilenced,
    silenceSpotSpeaker,
    SpotLectures,
} from "./megaphoneSpots";

const area = (id: string, name: string, x: number, y: number, width: number, height: number, properties = []) =>
    ({ id, name, x, y, width, height, visible: true, properties }) as unknown as AreaData;
// The classroom's layout: the podium, the listener zones around it, a table spot inside one of them.
const podium = area("podium", "Podium", 416, 448, 160, 96, [
    { id: "speaker", type: "speakerMegaphone", name: "classroom", chatEnabled: false, seeAttendees: false },
] as never);
const listening = (id: string, y: number, height: number) =>
    area(id, "Listening to the teacher", 32, y, 928, height, [
        {
            id: `${id}-listener`,
            type: "listenerMegaphone",
            speakerZoneName: "podium",
            chatEnabled: false,
            allowTalking: true,
            raiseHandEnabled: true,
        },
    ] as never);
const classroom = [podium, listening("audience", 96, 352), listening("audience-below", 544, 384)];

it("finds the lecture a spot is in, tracked apart from the podium", () => {
    const spot = area("megaphone-3", "quanta:megaphone:3", 448, 192, 32, 32);
    const lecture = lectureSpeakerZoneOf(spot, [...classroom, spot]);
    expect(lecture?.areaId).toBe("podium");
    expect(lecture?.property).toMatchObject({ type: "speakerMegaphone", name: "classroom", seeAttendees: false });
    expect(lecture?.property.id).not.toBe("speaker");
    const other = lectureSpeakerZoneOf(area("megaphone-13", "quanta:megaphone:13", 448, 576, 32, 32), classroom);
    expect(other?.property.id).not.toBe(lecture?.property.id);
});

it("finds no lecture for a spot outside every listener zone, or for an area that is not a spot", () => {
    expect(lectureSpeakerZoneOf(area("megaphone-x", "quanta:megaphone:x", 0, 0, 32, 32), classroom)).toBeUndefined();
    expect(lectureSpeakerZoneOf(area("board", "quanta:whiteboard:main", 448, 192, 32, 32), classroom)).toBeUndefined();
    const orphan = area("megaphone-1", "quanta:megaphone:1", 448, 192, 32, 32);
    expect(lectureSpeakerZoneOf(orphan, [listening("audience", 96, 352), orphan])).toBeUndefined();
});

it("finds the class lecture from anywhere, tracked apart from the podium", () => {
    const lecture = classLectureOf(classroom, { x: 2000, y: 2000 });
    expect(lecture?.areaId).toBe("podium");
    expect(lecture?.property).toMatchObject({ type: "speakerMegaphone", name: "classroom" });
    expect(lecture?.property.id).not.toBe("speaker");
    expect(classLectureOf(classroom)?.property.id).toBe(lecture?.property.id);
});

it("prefers the lecture whose listeners the speaker stands among, else the one heard across most of the map", () => {
    const stage = area("stage", "Stage", 2000, 0, 64, 64, [
        { id: "stage-speaker", type: "speakerMegaphone", name: "hall", chatEnabled: false, seeAttendees: false },
    ] as never);
    const hall = area("hall", "Hall", 2000, 100, 64, 64, [
        { id: "hall-listener", type: "listenerMegaphone", speakerZoneName: "stage", chatEnabled: false },
    ] as never);
    const map = [...classroom, stage, hall];
    expect(classLectureOf(map, { x: 2030, y: 130 })?.areaId).toBe("stage");
    expect(classLectureOf(map, { x: 100, y: 200 })?.areaId).toBe("podium");
    expect(classLectureOf(map, { x: 5000, y: 5000 })?.areaId).toBe("podium");
});

it("finds no class lecture without a speaker zone that someone listens to", () => {
    expect(classLectureOf([podium])).toBeUndefined();
    expect(classLectureOf([listening("audience", 96, 352)])).toBeUndefined();
});

function spotLectures() {
    const signals: AbortSignal[] = [];
    const speak = vi.fn((_lecture: string, signal: AbortSignal) => {
        signals.push(signal);
    });
    const stop = vi.fn();
    return { spots: new SpotLectures<string>(speak, stop), speak, stop, signals };
}

it("speaks from a spot once while on it and stops when stepping off", () => {
    const { spots, speak, stop, signals } = spotLectures();
    spots.enter("spot-1", "lecture");
    spots.enter("spot-1", "lecture");
    expect(speak).toHaveBeenCalledOnce();
    spots.leave("spot-1");
    expect(stop).toHaveBeenCalledWith("lecture");
    expect(signals[0].aborted).toBe(true);
});

it("a silenced spot speaker stops at once and does not speak again until stepping off and back on", () => {
    const { spots, speak, stop } = spotLectures();
    // Off a spot there is nothing to silence (and nothing to tell the player).
    expect(spots.silence()).toBe(0);
    spots.enter("spot-1", "lecture");
    expect(spots.silence()).toBe(1);
    expect(stop).toHaveBeenCalledOnce();
    expect(spots.silence()).toBe(0);
    // Still on the spot: the area events of the same spot do not make them a speaker again.
    spots.enter("spot-1", "lecture");
    expect(speak).toHaveBeenCalledOnce();
    spots.leave("spot-1");
    expect(stop).toHaveBeenCalledOnce();
    spots.enter("spot-1", "lecture");
    expect(speak).toHaveBeenCalledTimes(2);
});

it("tells every listener when the microphone was forced off, until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = onSpotSpeakerSilenced(listener);
    silenceSpotSpeaker();
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    silenceSpotSpeaker();
    expect(listener).toHaveBeenCalledOnce();
});
