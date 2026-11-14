// quanta: the one menu for a person in the room, the same on their video tile and in the platform's people list
// (web/src/components/wa/person-menu.ts holds the same rules): same items, order and words. Groups are shown with a
// divider between them; the destructive item is last.

export type PersonMenuItem =
    | "go_to"
    | "message"
    | "poke"
    | "let_speak"
    | "stop_speaking"
    | "let_draw"
    | "stop_drawing"
    | "mute_mic"
    | "mute_camera"
    | "allow_camera"
    | "mute_chat"
    | "unmute_chat"
    | "remove"
    | "report"
    | "mute_everyone_mic"
    | "mute_everyone_camera";

export interface PersonMenuContext {
    /** The viewer runs the room (the admin tag). */
    viewerStaff: boolean;
    /** The person runs the room too: staff only go to and message each other. */
    targetStaff: boolean;
    self: boolean;
    canGoTo: boolean;
    canMessage: boolean;
    /** Their hand is up where this viewer may let them speak to the class. */
    mayLetSpeak: boolean;
    /** They speak to the whole class now. */
    speaking: boolean;
    /** The room has the teacher's board, and the viewer may say who draws on it. */
    canLetDraw: boolean;
    drawing: boolean;
    /** The room turns a camera off for the teacher (older rooms only turn microphones off). */
    canTurnOffCamera: boolean;
    /** Staff turned their camera off, and it stays off until allowed (older rooms never keep it off). */
    cameraHeld?: boolean;
    chatMuted: boolean;
    /** Classmates may block or report each other, never staff. */
    mayReport: boolean;
    /** On a video tile in a conversation the viewer may silence: everyone in it, at once (a noisy group). */
    canSilenceConversation?: boolean;
}

export function personMenuItems(context: PersonMenuContext): PersonMenuItem[][] {
    if (context.self) return [];
    if (!context.viewerStaff) return context.mayReport && !context.targetStaff ? [["report"]] : [];
    const reach: PersonMenuItem[] = [];
    if (context.canGoTo) reach.push("go_to");
    if (context.canMessage) reach.push("message");
    if (context.targetStaff) return reach.length ? [reach] : [];
    reach.push("poke");
    const stage: PersonMenuItem[] = [];
    if (context.speaking) stage.push("stop_speaking");
    else if (context.mayLetSpeak) stage.push("let_speak");
    if (context.canLetDraw) stage.push(context.drawing ? "stop_drawing" : "let_draw");
    const silence: PersonMenuItem[] = ["mute_mic"];
    if (context.canTurnOffCamera) silence.push(context.cameraHeld ? "allow_camera" : "mute_camera");
    silence.push(context.chatMuted ? "unmute_chat" : "mute_chat");
    const everyone: PersonMenuItem[] = context.canSilenceConversation
        ? ["mute_everyone_mic", "mute_everyone_camera"]
        : [];
    const groups: PersonMenuItem[][] = [reach, stage, silence, everyone, ["remove"]];
    return groups.filter((group) => group.length > 0);
}
