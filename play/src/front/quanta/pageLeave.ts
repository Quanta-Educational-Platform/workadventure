// quanta: whether this page is closing or reloading, or the platform's page around it is (its frames get the same
// events). The room's connection goes down with the page, which is not a connection lost, so the platform is told of
// neither the "Connection lost" toast nor the error screen from then on.

/** beforeunload can still be cancelled, so it marks the page as leaving only this long. */
const UNLOAD_MS = 10_000;

let hidden = false;
let unloadingAt = Number.NEGATIVE_INFINITY;
let watching = false;

function onBeforeUnload(): void {
    unloadingAt = Date.now();
}

function onPageHide(): void {
    hidden = true;
}

/** Back from the browser's page cache: the page lives on. */
function onPageShow(): void {
    hidden = false;
    unloadingAt = Number.NEGATIVE_INFINITY;
}

/** For the page's lifetime, once. */
export function watchPageLeave(target: Window = window): void {
    if (watching) return;
    watching = true;
    // eslint-disable-next-line listeners/no-missing-remove-event-listener
    target.addEventListener("beforeunload", onBeforeUnload);
    // eslint-disable-next-line listeners/no-missing-remove-event-listener
    target.addEventListener("pagehide", onPageHide);
    // eslint-disable-next-line listeners/no-missing-remove-event-listener
    target.addEventListener("pageshow", onPageShow);
}

export function pageLeaving(now = Date.now()): boolean {
    return hidden || now - unloadingAt < UNLOAD_MS;
}
