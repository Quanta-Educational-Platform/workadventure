// quanta: who is talking, over their avatar (quanta-ui.css draws it in the name tag). WA marks only a lecture's
// speakers, with a faint ring around the name; a class marks anyone heard in a conversation too. Each person's own
// volume meter drives it, held over the short gaps inside speech, so it neither flickers nor sends an update to the
// room for every syllable.
import { readable, type Readable } from "svelte/store";

export const TALK_HOLD_MS = 800;

/** Whether this person's talking is shown to others: on air in a lecture, or, in a class, in any conversation. */
export function voiceIndicatorWanted(quantaUi: boolean, onAir: boolean, inConversation: boolean): boolean {
    return onAir || (quantaUi && inConversation);
}

/** On as soon as `talking` is; off only once it has stayed off for `holdMs`. */
export function heldTalking(talking: Readable<boolean>, holdMs = TALK_HOLD_MS): Readable<boolean> {
    return readable(false, (set) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const unsubscribe = talking.subscribe((on) => {
            if (on) {
                clearTimeout(timer);
                timer = undefined;
                set(true);
            } else if (timer === undefined) {
                timer = setTimeout(() => {
                    timer = undefined;
                    set(false);
                }, holdMs);
            }
        });
        return () => {
            unsubscribe();
            clearTimeout(timer);
        };
    });
}
