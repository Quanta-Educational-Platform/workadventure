// quanta: what someone whose own link is weak (WeakConnection.ts) is told, and how often, in the blue notice above the
// dock (OnAirStrip). A presenter sharing their screen hears about the share (it is what suffers most, and teachers are
// pointed at Present board, which sends drawings rather than video); anyone else, once as the link turns weak and at
// most every five minutes, even across reloads, which weak links bring plenty of.
// A link that stays weak turns a student's camera off to keep their sound (a screen share stays on), once a page: the
// notice offers it back, and whoever turns it back on, there or in the dock, keeps it. Never staff's, nor anyone's on
// air: the class is watching them; they get the advice only.
import { get, writable } from "svelte/store";
import { localUserStore } from "../Connection/LocalUserStore";
import { requestedCameraState } from "../Stores/MediaStore";
import { userIsAdminStore } from "../Stores/GameStore";
import { selfOnAirStore } from "../quanta/speakingToClass";
import { canViewAsStudentStore } from "../quanta/studentView";
import { linkRecoveredStore, weakConnectionStore } from "./WeakConnection";

const LINK_NOTICE_EVERY_MS = 5 * 60_000;
const SHARE_NOTICE_EVERY_MS = 2 * 60_000;
const NOTICE_MS = 12_000;
/** Weak for this much longer than WeakConnection's own 6 s before the camera goes off. */
const CAMERA_OFF_AFTER_MS = 15_000;
const STORAGE_KEY = "quanta.weakLinkNoticeAt";

export type WeakLinkNotice =
    | { kind: "linkCameraOn" | "linkCameraOff" | "share" }
    /** The camera was turned off for the link; `better` once the link has recovered. */
    | { kind: "cameraOff"; better: boolean };

export const weakLinkNoticeStore = writable<WeakLinkNotice | undefined>(undefined);

let shareNoticeAt = 0;
let started = false;
let cappedShares = 0;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let cameraOffTimer: ReturnType<typeof setTimeout> | undefined;
/** The camera is off because of the link, and the person hasn't touched it since. */
let cameraOffByUs = false;
/** Turned back on after that: never again this page. */
let cameraKept = false;

function storage(): Storage | undefined {
    try {
        return typeof localStorage === "undefined" ? undefined : localStorage;
    } catch {
        return undefined;
    }
}

function linkNoticeAt(): number {
    try {
        const at = Number(storage()?.getItem(STORAGE_KEY));
        return Number.isFinite(at) ? at : 0;
    } catch {
        return 0;
    }
}

function show(notice: WeakLinkNotice): void {
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    hideTimer = undefined;
    // The camera notice waits for the person; it is not replaced by a passing one.
    if (get(weakLinkNoticeStore)?.kind === "cameraOff" && notice.kind !== "cameraOff") return;
    weakLinkNoticeStore.set(notice);
    if (notice.kind !== "cameraOff") {
        hideTimer = setTimeout(() => {
            hideTimer = undefined;
            if (get(weakLinkNoticeStore) === notice) weakLinkNoticeStore.set(undefined);
        }, NOTICE_MS);
    }
}

export function dismissWeakLinkNotice(): void {
    if (hideTimer !== undefined) clearTimeout(hideTimer);
    hideTimer = undefined;
    weakLinkNoticeStore.set(undefined);
}

/** The notice's button: the camera back on, kept on from now. */
export function turnCameraBackOn(): void {
    requestedCameraState.enableWebcam();
    dismissWeakLinkNotice();
}

/** Held by a running share cap (ScreenShareCap.ts), which tells its presenter about the share instead. */
export function holdScreenShareNotice(): () => void {
    cappedShares++;
    let released = false;
    return () => {
        if (released) return;
        released = true;
        cappedShares--;
    };
}

/** For the presenter while the share is capped (ScreenShareCap.ts); a share started again doesn't repeat it sooner. */
export function noticeWeakScreenShare(): void {
    const now = Date.now();
    if (now - shareNoticeAt < SHARE_NOTICE_EVERY_MS) return;
    shareNoticeAt = now;
    show({ kind: "share" });
}

function mayTurnCameraOff(): boolean {
    // Whoever runs the room keeps their camera, viewing as a student or not: the class still watches them.
    return !cameraKept && !get(userIsAdminStore) && !get(canViewAsStudentStore) && !get(selfOnAirStore);
}

function turnCameraOffForLink(): void {
    cameraOffTimer = undefined;
    if (!mayTurnCameraOff() || !get(weakConnectionStore) || !get(requestedCameraState)) return;
    // Their saved choice stays: a reload on a better link starts with the camera as they had it.
    const saved = localUserStore.getRequestedCameraState();
    cameraOffByUs = true;
    requestedCameraState.disableWebcam();
    localUserStore.setRequestedCameraState(saved);
    show({ kind: "cameraOff", better: false });
}

/** Starts telling this person when their own link turns weak. Once per page; later calls do nothing. */
export function startWeakLinkNotice(): void {
    if (started) return;
    started = true;
    // Singletons for the page's lifetime, like the stores they read.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    requestedCameraState.subscribe((on) => {
        if (!on || !cameraOffByUs) return;
        // Back on, by the notice or by hand: theirs to keep.
        cameraOffByUs = false;
        cameraKept = true;
        if (get(weakLinkNoticeStore)?.kind === "cameraOff") dismissWeakLinkNotice();
    });
    // Only a link really good again says so (WeakConnection), not one that stopped being measured with the call left;
    // a camera notice closed earlier comes back to say it.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    linkRecoveredStore.subscribe((count) => {
        // Another of their calls may still be weak.
        if (count > 0 && cameraOffByUs && !get(weakConnectionStore)) show({ kind: "cameraOff", better: true });
    });
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    weakConnectionStore.subscribe((weak) => {
        if (!weak) {
            if (cameraOffTimer !== undefined) clearTimeout(cameraOffTimer);
            cameraOffTimer = undefined;
            return;
        }
        if (mayTurnCameraOff() && !cameraOffByUs && cameraOffTimer === undefined)
            cameraOffTimer = setTimeout(turnCameraOffForLink, CAMERA_OFF_AFTER_MS);
        // The share cap tells a presenter within a couple of seconds, about the share. A share LiveKit doesn't carry
        // (peer to peer, or a listener's in a megaphone space) has no cap: its presenter gets this notice.
        if (cappedShares > 0) return;
        const now = Date.now();
        if (now - linkNoticeAt() < LINK_NOTICE_EVERY_MS || now - shareNoticeAt < LINK_NOTICE_EVERY_MS) return;
        try {
            storage()?.setItem(STORAGE_KEY, String(now));
        } catch {
            // Storage blocked: the notice may come back sooner after a reload.
        }
        show({ kind: get(requestedCameraState) ? "linkCameraOn" : "linkCameraOff" });
    });
}
