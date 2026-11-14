import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import type { Writable } from "svelte/store";

vi.mock("../../../../src/front/Stores/ErrorScreenStore", async () => {
    const { writable } = await import("svelte/store");
    return { errorScreenStore: writable(undefined) };
});
vi.mock("../../../../src/front/Phaser/Game/GameManager", () => ({ gameManager: { currentStartedRoom: undefined } }));
vi.mock("../../../../src/front/Connection/ConnectionManager", () => ({ connectionManager: { logout: vi.fn() } }));
vi.mock("../../../../src/front/Enum/EnvironmentVariable", () => ({ QUANTA_UI: true }));
vi.mock("../../../../src/front/Stores/MenuStore", async () => {
    const { readable } = await import("svelte/store");
    return { userIsConnected: readable(false) };
});
vi.mock("../../../../src/i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    return { default: readable({ menu: { profile: { logout: () => "Log out" } } }) };
});

import { errorScreenStore } from "../../../../src/front/Stores/ErrorScreenStore";
import ErrorScreen from "../../../../src/front/Components/UI/ErrorScreen.svelte";

// The mock above is a plain writable store.
const showScreen = (screen: Record<string, unknown> | undefined) =>
    (errorScreenStore as unknown as Writable<Record<string, unknown> | undefined>).set(screen);

describe("ErrorScreen retry", () => {
    let component: ReturnType<typeof mount> | undefined;
    let reload: ReturnType<typeof vi.fn>;
    const retry = {
        type: "retry",
        code: "ROOM_ACCESS_RETRY",
        subtitle: "Hang on",
        details: "Trying again in {time} seconds",
        timeToRetry: 10_000,
        canRetryManual: true,
        buttonTitle: "Try again",
    };

    beforeEach(() => {
        vi.useFakeTimers();
        sessionStorage.clear();
        reload = vi.fn();
        Object.defineProperty(window, "location", { value: { ...window.location, reload }, configurable: true });
        showScreen(undefined);
    });
    afterEach(async () => {
        const mounted = component;
        component = undefined;
        if (mounted) await unmount(mounted);
        vi.useRealTimers();
    });

    it("counts down and reloads once when a shown screen turns into a retry", () => {
        showScreen({ type: "reconnecting", code: "", details: "" });
        component = mount(ErrorScreen, { target: document.createElement("div") });
        flushSync();
        showScreen(retry);
        flushSync();
        vi.advanceTimersByTime(9_000);
        expect(reload).not.toHaveBeenCalled();
        vi.advanceTimersByTime(2_000);
        expect(reload).toHaveBeenCalledTimes(1);
        vi.advanceTimersByTime(30_000);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(sessionStorage.getItem("quanta-retry-attempt")).toBe("1");
    });

    it("waits twice as long on the next retry in a row", () => {
        sessionStorage.setItem("quanta-retry-attempt", "1");
        showScreen(retry);
        component = mount(ErrorScreen, { target: document.createElement("div") });
        flushSync();
        vi.advanceTimersByTime(19_000);
        expect(reload).not.toHaveBeenCalled();
        vi.advanceTimersByTime(2_000);
        expect(reload).toHaveBeenCalledTimes(1);
        expect(sessionStorage.getItem("quanta-retry-attempt")).toBe("2");
    });
});
