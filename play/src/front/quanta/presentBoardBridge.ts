// quanta: "Present board" from inside the room, for a presenter whose screen share their link can't carry
// (WeakLinkNotice.ts). The button is the page's (VirtualRoom): the page says when it can present, the room asks it
// to, and the page opens it as a click there would (a course room's board picker included). Once a board is presented
// on that request, the screen share stops: the board reaches the class from Quanta's servers, not from this upload.
import { get, writable, type Readable } from "svelte/store";
import { requestedScreenSharingState } from "../Stores/ScreenSharingStore";
import { localUserStore } from "../Connection/LocalUserStore";
import { presentedBoardStore } from "./boardAccess";
import { fromPlatform, platformOrigin } from "./platformOrigin";

/** A board presented this long after the request still counts as its answer (a lesson picked in the picker). */
const ANSWER_MS = 3 * 60_000;

const available = writable(false);
/** The page can present a board for this person now (staff, outside student view, nothing presented yet). */
export const presentBoardAvailableStore: Readable<boolean> = available;

let started = false;
let askedAt = 0;

export function startPresentBoardBridge(): void {
    if (started) return;
    started = true;
    window.addEventListener("message", (event: MessageEvent) => {
        if (event.data?.type !== "quanta_present_board" || !fromPlatform(event)) return;
        available.set(event.data.available === true);
    });
    // Singleton for the page's lifetime.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    presentedBoardStore.subscribe((value) => {
        if (!value || typeof value !== "object" || Date.now() - askedAt > ANSWER_MS) return;
        // Only a board this person presents answers the request: a co-teacher's must not stop their share.
        const presenter = (value as { presenter?: unknown }).presenter;
        const own = localUserStore.getLocalUser()?.uuid;
        if (!own || presenter !== own) return;
        askedAt = 0;
        if (get(requestedScreenSharingState)) requestedScreenSharingState.disableScreenSharing();
    });
}

export function presentBoardInstead(): void {
    const origin = platformOrigin();
    if (!origin || window.parent === window) return;
    askedAt = Date.now();
    window.parent.postMessage({ type: "quanta_wa_present_board" }, origin);
}
