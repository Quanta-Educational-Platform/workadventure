// quanta: in the platform's frame the camera stays on while alone (roomBridge.ts sets this): WA's energy saving
// switched it off after a few still seconds and back on at every move or resize, so the user's own picture kept
// appearing and going. A microphone left on stays on too: released, its button still said on, the first words after
// standing still were lost while it reopened, and nothing could tell the person that nobody hears them. Muting still
// releases it (MediaStore.ts).
import { writable } from "svelte/store";

export const quantaCameraAwakeStore = writable(false);
