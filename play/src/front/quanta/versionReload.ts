// quanta: every image carries its own build id (apiVersionHash, play/Dockerfile's WA_BUILD_ID), and the pusher refuses
// a page of another build with NEW_VERSION. Such a page reloads by itself: after a short notice, spread over the
// room so the joins don't all land at once, and not while someone is typing. A reload that comes back as the same
// old build (a cache serving it) gets the error screen instead, so it can never turn into a loop.

/** The build this tab last reloaded away from, and when. */
export const VERSION_RELOAD_KEY = "quanta-version-reload";

const NOTICE_MS = 4_000;
const SPREAD_MS = 20_000;
// A reload of the same build this long ago is a new deploy, not a reload that failed.
const SAME_BUILD_WINDOW_MS = 10 * 60_000;
const TYPING_QUIET_MS = 3_000;
const TYPING_MAX_DEFER_MS = 30_000;
const TYPING_RECHECK_MS = 1_000;
const BEFORE_RELOAD_MAX_MS = 1_500;

type Store = Pick<Storage, "getItem" | "setItem">;

export interface VersionReloadDeps {
    build: string;
    storage: () => Store;
    now: () => number;
    random: () => number;
    setTimer: (callback: () => void, ms: number) => unknown;
    /** Whether the person is typing right now. */
    typing: () => boolean;
    showNotice: () => void;
    reload: () => void;
}

const beforeReload = new Set<() => Promise<void> | void>();

/** Work that must finish before the page goes, such as saving a chat draft. Returns the unregistration. */
export function onVersionReload(callback: () => Promise<void> | void): () => void {
    beforeReload.add(callback);
    return () => {
        beforeReload.delete(callback);
    };
}

function lastReload(storage: Store): { from?: unknown; at?: unknown } | undefined {
    try {
        const value: unknown = JSON.parse(storage.getItem(VERSION_RELOAD_KEY) ?? "null");
        return value && typeof value === "object" ? value : undefined;
    } catch {
        return undefined;
    }
}

let scheduled = false;

/**
 * Takes a NEW_VERSION refusal: true when the page will reload by itself, false when the error screen should show
 * (this build already reloaded once, or the tab cannot remember that it did).
 */
export function reloadForNewVersion(deps: VersionReloadDeps): boolean {
    if (scheduled) return true;
    try {
        const storage = deps.storage();
        const last = lastReload(storage);
        if (last?.from === deps.build && typeof last.at === "number" && deps.now() - last.at < SAME_BUILD_WINDOW_MS) {
            return false;
        }
        storage.setItem(VERSION_RELOAD_KEY, JSON.stringify({ from: deps.build, at: deps.now() }));
    } catch {
        return false;
    }
    scheduled = true;
    deps.showNotice();
    const delay = NOTICE_MS + deps.random() * SPREAD_MS;
    const deferUntil = deps.now() + delay + TYPING_MAX_DEFER_MS;
    const attempt = (): void => {
        if (deps.typing() && deps.now() < deferUntil) {
            deps.setTimer(attempt, TYPING_RECHECK_MS);
            return;
        }
        const ready = Promise.allSettled([...beforeReload].map(async (callback) => callback()));
        const capped = new Promise<void>((resolve) => {
            deps.setTimer(resolve, BEFORE_RELOAD_MAX_MS);
        });
        Promise.race([ready, capped])
            .catch(() => undefined)
            .finally(() => deps.reload());
    };
    deps.setTimer(attempt, delay);
    return true;
}

export function resetVersionReloadForTests(): void {
    scheduled = false;
    beforeReload.clear();
}

function isEditable(element: Element | null): boolean {
    if (!(element instanceof HTMLElement)) return false;
    if (element.isContentEditable || element instanceof HTMLTextAreaElement) return true;
    return element instanceof HTMLInputElement && !["button", "checkbox", "radio", "range"].includes(element.type);
}

let lastKeyAt = 0;
let watchingKeys = false;

/** Starts noting keys pressed in text fields, for typingInPage. */
export function watchTyping(): void {
    if (watchingKeys) return;
    watchingKeys = true;
    const record = (event: Event) => {
        if (isEditable(event.target as Element | null)) lastKeyAt = Date.now();
    };
    // For the page's lifetime: it ends with the reload this serves.
    // eslint-disable-next-line listeners/no-missing-remove-event-listener
    document.addEventListener("keydown", record, true);
    // eslint-disable-next-line listeners/no-missing-remove-event-listener
    document.addEventListener("input", record, true);
}

/** Typing: focus in a text field and a key pressed there in the last few seconds. */
export function typingInPage(now: number = Date.now()): boolean {
    return isEditable(document.activeElement) && now - lastKeyAt < TYPING_QUIET_MS;
}
