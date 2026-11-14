import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    VERSION_RELOAD_KEY,
    onVersionReload,
    reloadForNewVersion,
    resetVersionReloadForTests,
    typingInPage,
    watchTyping,
    type VersionReloadDeps,
} from "./versionReload";

function memoryStorage(initial: Record<string, string> = {}) {
    const items = new Map(Object.entries(initial));
    return {
        getItem: (key: string) => items.get(key) ?? null,
        setItem: (key: string, value: string) => {
            items.set(key, value);
        },
        items,
    };
}

function harness(overrides: Partial<VersionReloadDeps> = {}) {
    const storage = memoryStorage();
    const deps = {
        build: "local.54",
        storage: () => storage,
        now: () => Date.now(),
        random: () => 0.5,
        setTimer: (callback: () => void, ms: number) => setTimeout(callback, ms),
        typing: vi.fn(() => false),
        showNotice: vi.fn(),
        reload: vi.fn(),
        ...overrides,
    };
    return { deps, storage };
}

describe("reloadForNewVersion", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        resetVersionReloadForTests();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it("shows the notice at once and reloads after it, spread over the room", async () => {
        const { deps, storage } = harness({ random: () => 0.5 });
        expect(reloadForNewVersion(deps)).toBe(true);
        expect(deps.showNotice).toHaveBeenCalledTimes(1);

        // 4 s of notice plus half of the 20 s spread.
        await vi.advanceTimersByTimeAsync(13_999);
        expect(deps.reload).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(deps.reload).toHaveBeenCalledTimes(1);
        expect(JSON.parse(storage.items.get(VERSION_RELOAD_KEY) ?? "{}")).toMatchObject({ from: "local.54" });
    });

    it("spreads the reloads between 4 and 24 seconds", async () => {
        const early = harness({ random: () => 0 });
        reloadForNewVersion(early.deps);
        await vi.advanceTimersByTimeAsync(4_000);
        expect(early.deps.reload).toHaveBeenCalledTimes(1);

        resetVersionReloadForTests();
        const late = harness({ random: () => 0.999_999 });
        reloadForNewVersion(late.deps);
        await vi.advanceTimersByTimeAsync(23_000);
        expect(late.deps.reload).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(late.deps.reload).toHaveBeenCalledTimes(1);
    });

    it("waits while the person types, up to 30 seconds more", async () => {
        const typing = vi.fn(() => true);
        const { deps } = harness({ random: () => 0, typing });
        reloadForNewVersion(deps);

        await vi.advanceTimersByTimeAsync(10_000);
        expect(deps.reload).not.toHaveBeenCalled();
        typing.mockReturnValue(false);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(deps.reload).toHaveBeenCalledTimes(1);

        resetVersionReloadForTests();
        const busy = harness({ random: () => 0, typing: () => true });
        reloadForNewVersion(busy.deps);
        await vi.advanceTimersByTimeAsync(33_000);
        expect(busy.deps.reload).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(busy.deps.reload).toHaveBeenCalledTimes(1);
    });

    it("keeps the chat draft before the page goes, without waiting on it for long", async () => {
        const order: string[] = [];
        const { deps } = harness({ random: () => 0, reload: vi.fn(() => order.push("reload")) });
        onVersionReload(
            () =>
                new Promise<void>((resolve) => {
                    setTimeout(() => {
                        order.push("draft");
                        resolve();
                    }, 200);
                }),
        );
        reloadForNewVersion(deps);
        await vi.advanceTimersByTimeAsync(4_000);
        expect(deps.reload).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(200);
        expect(order).toEqual(["draft", "reload"]);

        resetVersionReloadForTests();
        const stuck = harness({ random: () => 0 });
        onVersionReload(
            () =>
                new Promise<void>(() => {
                    // Never settles.
                }),
        );
        onVersionReload(() => {
            throw new Error("broken");
        });
        reloadForNewVersion(stuck.deps);
        await vi.advanceTimersByTimeAsync(4_000 + 1_500);
        expect(stuck.deps.reload).toHaveBeenCalledTimes(1);
    });

    it("plans one reload however many refusals arrive", async () => {
        const { deps } = harness({ random: () => 0 });
        expect(reloadForNewVersion(deps)).toBe(true);
        expect(reloadForNewVersion(deps)).toBe(true);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(deps.showNotice).toHaveBeenCalledTimes(1);
        expect(deps.reload).toHaveBeenCalledTimes(1);
    });

    it("leaves it to the error screen when the reload came back as the same old build", () => {
        const storage = memoryStorage({
            [VERSION_RELOAD_KEY]: JSON.stringify({ from: "local.54", at: Date.now() - 60_000 }),
        });
        const { deps } = harness({ storage: () => storage });
        expect(reloadForNewVersion(deps)).toBe(false);
        expect(deps.showNotice).not.toHaveBeenCalled();
    });

    it("reloads again for a later deploy, or from another build", () => {
        const old = memoryStorage({
            [VERSION_RELOAD_KEY]: JSON.stringify({ from: "local.54", at: Date.now() - 11 * 60_000 }),
        });
        expect(reloadForNewVersion(harness({ storage: () => old }).deps)).toBe(true);

        resetVersionReloadForTests();
        const other = memoryStorage({
            [VERSION_RELOAD_KEY]: JSON.stringify({ from: "local.53", at: Date.now() }),
        });
        expect(reloadForNewVersion(harness({ storage: () => other }).deps)).toBe(true);

        resetVersionReloadForTests();
        const garbled = memoryStorage({ [VERSION_RELOAD_KEY]: "{not json" });
        expect(reloadForNewVersion(harness({ storage: () => garbled }).deps)).toBe(true);
    });

    it("never reloads a tab that cannot remember it did", () => {
        const blocked = harness({
            storage: () => {
                throw new Error("SecurityError");
            },
        });
        expect(reloadForNewVersion(blocked.deps)).toBe(false);

        const full = harness({
            storage: () => ({
                getItem: () => null,
                setItem: () => {
                    throw new Error("QuotaExceededError");
                },
            }),
        });
        expect(reloadForNewVersion(full.deps)).toBe(false);
    });
});

describe("typingInPage", () => {
    it("is a key pressed in the focused text field in the last 3 seconds", () => {
        watchTyping();
        const field = document.createElement("textarea");
        document.body.append(field);
        const button = document.createElement("button");
        document.body.append(button);

        field.focus();
        expect(typingInPage()).toBe(false);
        field.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
        expect(typingInPage()).toBe(true);
        expect(typingInPage(Date.now() + 3_000)).toBe(false);

        button.focus();
        expect(typingInPage()).toBe(false);
        field.remove();
        button.remove();
    });
});
