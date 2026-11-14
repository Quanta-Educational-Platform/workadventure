// quanta: a phone held sideways has the platform's room header in the dock's row (VirtualRoom's bottom bar): the
// platform sends what it keeps at either end of the row, and the dock centres between them. The dock's size goes back
// (roomBridge.ts), so the platform keeps its header on top whenever the row can't fit all three.
import { writable } from "svelte/store";

export const dockGuttersStore = writable({ left: 0, right: 0 });

/** The dock's width and height, and how far its bottom edge is from the room's: undefined until it is drawn. */
export const dockSizeStore = writable<{ width: number; height: number; bottom: number } | undefined>(undefined);
