import { expect, it } from "vitest";
import { get } from "svelte/store";
import { LONG_NOTIFICATION_MS, notificationPlayingStore } from "./NotificationStore";

it("keeps a notification's own duration and leaves the others at WA's default", () => {
    notificationPlayingStore.clearAllNotification();
    notificationPlayingStore.playNotification("short", "microphone-off.png");
    notificationPlayingStore.playNotification("two sentences", "microphone-off.png", undefined, LONG_NOTIFICATION_MS);
    const [short, long] = [...get(notificationPlayingStore)];
    expect(short.durationMs).toBeUndefined();
    expect(long).toMatchObject({ text: "two sentences", durationMs: 9000 });
    notificationPlayingStore.clearAllNotification();
});
