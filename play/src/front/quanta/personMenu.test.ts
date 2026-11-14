import { expect, it } from "vitest";
import { personMenuItems, type PersonMenuContext } from "./personMenu";

const teacherOnStudent: PersonMenuContext = {
    viewerStaff: true,
    targetStaff: false,
    self: false,
    canGoTo: true,
    canMessage: true,
    mayLetSpeak: false,
    speaking: false,
    canLetDraw: false,
    drawing: false,
    canTurnOffCamera: true,
    chatMuted: false,
    mayReport: true,
};

it("gives a teacher the whole menu on a student, the removal last on its own", () => {
    expect(personMenuItems(teacherOnStudent)).toEqual([
        ["go_to", "message"],
        ["mute_mic", "mute_camera", "mute_chat"],
        ["remove"],
    ]);
});

it("offers the class's stage only when there is something to do there", () => {
    expect(personMenuItems({ ...teacherOnStudent, mayLetSpeak: true, canLetDraw: true })[1]).toEqual([
        "let_speak",
        "let_draw",
    ]);
    // Already speaking: taking it back, whether or not the hand is still up.
    expect(personMenuItems({ ...teacherOnStudent, mayLetSpeak: true, speaking: true })[1]).toEqual(["stop_speaking"]);
    expect(personMenuItems({ ...teacherOnStudent, canLetDraw: true, drawing: true })[1]).toEqual(["stop_drawing"]);
});

it("swaps mute for unmute and leaves the camera out where the room cannot turn it off", () => {
    expect(personMenuItems({ ...teacherOnStudent, chatMuted: true, canTurnOffCamera: false })[1]).toEqual([
        "mute_mic",
        "unmute_chat",
    ]);
});

it("lets staff only go to and message each other", () => {
    expect(personMenuItems({ ...teacherOnStudent, targetStaff: true, mayLetSpeak: true, canLetDraw: true })).toEqual([
        ["go_to", "message"],
    ]);
    expect(personMenuItems({ ...teacherOnStudent, targetStaff: true, canGoTo: false, canMessage: false })).toEqual([]);
});

it("gives a student nothing but blocking or reporting a classmate", () => {
    const student = { ...teacherOnStudent, viewerStaff: false, mayLetSpeak: true, canLetDraw: true };
    expect(personMenuItems(student)).toEqual([["report"]]);
    expect(personMenuItems({ ...student, targetStaff: true })).toEqual([]);
    expect(personMenuItems({ ...student, mayReport: false })).toEqual([]);
});

it("has nothing for oneself", () => {
    expect(personMenuItems({ ...teacherOnStudent, self: true })).toEqual([]);
});

it("offers a teacher, on a tile in a conversation they may silence, everyone in it at once, before Remove", () => {
    const base = {
        viewerStaff: true,
        targetStaff: false,
        self: false,
        canGoTo: true,
        canMessage: true,
        mayLetSpeak: false,
        speaking: false,
        canLetDraw: false,
        drawing: false,
        canTurnOffCamera: true,
        chatMuted: false,
        mayReport: false,
    };
    expect(personMenuItems({ ...base, canSilenceConversation: true }).at(-2)).toEqual([
        "mute_everyone_mic",
        "mute_everyone_camera",
    ]);
    expect(personMenuItems({ ...base, canSilenceConversation: true }).at(-1)).toEqual(["remove"]);
    expect(personMenuItems(base).flat()).not.toContain("mute_everyone_mic");
    expect(personMenuItems({ ...base, viewerStaff: false, canSilenceConversation: true }).flat()).toEqual([]);
});
