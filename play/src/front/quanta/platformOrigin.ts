import { QUANTA_URL } from "../Enum/EnvironmentVariable";

// The Quanta page embedding the room. Signing in on the way (the platform's consent page, on another workspace's
// host) leaves that page as the frame's referrer, so the embedding page's own origin comes first where the browser
// gives it (not Firefox), and a message from the parent teaches the rest.
let learned: string | undefined;
const learnedListeners = new Set<() => void>();

// Quanta's sites, as the room server's frame-ancestors lists them (infra/workadventure/env/wa.env.example).
const QUANTA_SITES = ["qed.world", "quanta.world", "neoed.world"];

const site = (origin: string) => {
    const url = new URL(origin);
    return url.protocol === "https:" ? url.hostname.split(".").slice(-2).join(".") : undefined;
};

function quantaSite(origin: string): boolean {
    try {
        const own = site(origin);
        if (own === undefined) return false;
        return QUANTA_SITES.includes(own) || (!!QUANTA_URL && site(QUANTA_URL) === own);
    } catch {
        return false;
    }
}

export function platformOrigin(): string | undefined {
    if (learned) return learned;
    try {
        return new URL(window.location?.ancestorOrigins?.[0] || document.referrer || QUANTA_URL || "").origin;
    } catch {
        return undefined;
    }
}

/** Calls back when messages to the platform go to another origin from now on: what was sent before may be lost. */
export function onPlatformOriginLearned(listener: () => void): () => void {
    learnedListeners.add(listener);
    return () => learnedListeners.delete(listener);
}

/** A message from the embedding page, which is Quanta: the page's own host, or one on Quanta's sites. */
export function fromPlatform(event: MessageEvent): boolean {
    if (event.source !== window.parent) return false;
    const before = platformOrigin();
    if (event.origin !== before && !quantaSite(event.origin)) return false;
    learned = event.origin;
    if (learned !== before) for (const listener of learnedListeners) listener();
    return true;
}

export function resetPlatformOriginForTests(): void {
    learned = undefined;
    learnedListeners.clear();
}
