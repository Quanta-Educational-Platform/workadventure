// quanta: in the platform's frame the camera stays on while alone (roomBridge.ts sets this): WA's energy saving
// switched it off after a few still seconds and back on at every move or resize, so the user's own picture kept
// appearing and going. Only the camera: the microphone is still released when idle (MediaStore.ts).
import { writable } from "svelte/store";

export const quantaCameraAwakeStore = writable(false);
