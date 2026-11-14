// quanta: the page's side of quanta/versionReload.ts.
import { apiVersionHash } from "@workadventure/messages";
import { mount } from "svelte";
import { reloadForNewVersion, typingInPage, watchTyping } from "./versionReload";
import VersionReloadToast from "./VersionReloadToast.svelte";

/** True when the page reloads by itself; false when the NEW_VERSION error screen should show. */
export function reloadPageForNewVersion(): boolean {
    watchTyping();
    return reloadForNewVersion({
        build: apiVersionHash,
        storage: () => window.sessionStorage,
        now: () => Date.now(),
        random: Math.random,
        setTimer: (callback, ms) => setTimeout(callback, ms),
        typing: () => typingInPage(),
        showNotice: () => mount(VersionReloadToast, { target: document.body }),
        reload: () => window.location.reload(),
    });
}
