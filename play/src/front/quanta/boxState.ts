// quanta: what a call tile shows, for the layouts that arrange tiles by it (rail.ts, bubbles.ts): a picture (a camera
// that is on), a shared screen, and whether the person is talking, held a few seconds past each pause so a tile that
// grows for a speaker doesn't shrink between sentences, and whether they talk now (the green ring), which follows the
// voice closely.
import { derived, readable, type Readable } from "svelte/store";
import type { VideoBox } from "../Space/VideoBox";
import { heldTalking, TALK_HOLD_MS } from "./talkingIndicator";

export interface BoxState {
    video: boolean;
    talking: boolean;
    /** Talking now, held only over the short gaps inside speech: what the green ring shows. */
    speaking: boolean;
    share: boolean;
}

const NONE: BoxState = { video: false, talking: false, speaking: false, share: false };
export const TALKING_HOLD_MS = 4000;

const states = new WeakMap<VideoBox, Readable<BoxState>>();

/** The woka pictures of these tiles' people, in order (none for a tile without a person). */
export function picturesOf(boxes: VideoBox[]): Readable<(string | undefined)[]> {
    if (!boxes.length) return readable([]);
    return derived(
        boxes.map((box) => box.spaceUser?.pictureStore ?? readable(undefined)),
        // A copy each time: derived() hands back the same array, which a rune would take as unchanged.
        (pictures) => [...pictures],
    );
}

/** One store per tile, shared by everything that reads it (the tile's own attributes, the face pile). */
export function boxStateStore(box: VideoBox): Readable<BoxState> {
    let state = states.get(box);
    if (state) return state;
    state = derived(
        box.streamable,
        ($streamable, set) => {
            if (!$streamable) {
                set(NONE);
                return;
            }
            const share = $streamable.videoType === "screenSharing";
            const talking = share ? readable(false) : heldTalking($streamable.showVoiceIndicator, TALKING_HOLD_MS);
            const speaking = share ? readable(false) : heldTalking($streamable.showVoiceIndicator, TALK_HOLD_MS);
            return derived([$streamable.hasVideo, talking, speaking], ([$video, $talking, $speaking]) => ({
                video: $video,
                talking: $talking,
                speaking: $speaking,
                share,
            })).subscribe(set);
        },
        NONE,
    );
    states.set(box, state);
    return state;
}
