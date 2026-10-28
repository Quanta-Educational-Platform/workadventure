import type { Readable, Unsubscriber } from "svelte/store";

export type MediaKind = "microphone" | "camera" | "screenshare";

/** Watch only inside a room, so analytics cannot start capture on a setup screen. */
export function watchMediaStates(
    inRoom: Readable<boolean>,
    sources: Record<MediaKind, Readable<boolean>>,
    report: (kind: MediaKind, enabled: boolean) => void,
): Unsubscriber {
    let active = false;
    let subscriptions: Unsubscriber[] = [];
    const stop = () => {
        subscriptions.forEach((unsubscribe) => unsubscribe());
        subscriptions = [];
    };
    const unsubscribeRoom = inRoom.subscribe((loaded) => {
        if (loaded === active) return;
        active = loaded;
        stop();
        if (!loaded) return;
        for (const kind of ["microphone", "camera", "screenshare"] as const) {
            let previous: boolean | undefined;
            subscriptions.push(
                sources[kind].subscribe((enabled) => {
                    if (enabled === previous) return;
                    previous = enabled;
                    report(kind, enabled);
                }),
            );
        }
    });
    return () => {
        unsubscribeRoom();
        stop();
    };
}
