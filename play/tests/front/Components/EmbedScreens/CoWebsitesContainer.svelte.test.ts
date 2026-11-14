import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { get } from "svelte/store";
import type * as EnvironmentVariable from "../../../../src/front/Enum/EnvironmentVariable";

vi.mock("../../../../src/front/Enum/EnvironmentVariable", async (importOriginal) => ({
    ...(await importOriginal<typeof EnvironmentVariable>()),
    QUANTA_UI: true,
    EXCALIDRAW_DOMAINS: ["draw.qed.world"],
}));

// The scripting API and other co-website kinds pull in the game; these tests only open plain websites.
vi.mock("../../../../src/front/Api/IframeListener", () => ({
    iframeListener: { registerIframe: vi.fn(), unregisterIframe: vi.fn() },
}));
vi.mock("../../../../src/front/Api/ScriptUtils", () => ({ scriptUtils: { getWebsiteUrl: (url: string) => url } }));
vi.mock("../../../../src/front/WebRtc/CoWebsite/JitsiCoWebsite", () => ({ JitsiCoWebsite: class {} }));
vi.mock("../../../../src/front/WebRtc/CoWebsite/BBBCoWebsite", () => ({ BBBCoWebsite: class {} }));
vi.mock("../../../../src/front/WebRtc/CoWebsite/VideoCoWebsite", () => ({ VideoCoWebsite: class {} }));
vi.mock("../../../../src/front/WebRtc/CoWebsite/ImageCoWebsite", () => ({ ImageCoWebsite: class {} }));
vi.mock("../../../../src/front/Components/Cowebsites/JistiCowebsiteComponent.svelte", () => ({ default: () => {} }));
vi.mock("../../../../src/front/Components/Cowebsites/BigBlueButtonCowebsiteComponent.svelte", () => ({
    default: () => {},
}));
vi.mock("../../../../src/front/Components/Cowebsites/VideoCowebsiteComponent.svelte", () => ({ default: () => {} }));
vi.mock("../../../../src/front/Components/Cowebsites/ImageCowebsiteComponent.svelte", () => ({ default: () => {} }));

import CoWebsitesContainer from "../../../../src/front/Components/EmbedScreens/CoWebsitesContainer.svelte";
import { coWebsites, fullScreenCowebsite } from "../../../../src/front/Stores/CoWebsiteStore";
import { SimpleCoWebsite } from "../../../../src/front/WebRtc/CoWebsite/SimpleCoWebsite";
import { loadLocale } from "../../../../src/i18n/i18n-util.sync";
import { setLocale } from "../../../../src/i18n/i18n-svelte";
import { localUserStore } from "../../../../src/front/Connection/LocalUserStore";

describe("CoWebsitesContainer (Quanta UI)", () => {
    let component: ReturnType<typeof mount> | undefined;
    let target: HTMLElement;

    beforeAll(() => {
        // bind:clientWidth needs it; jsdom has none.
        globalThis.ResizeObserver ??= class {
            observe() {}
            unobserve() {}
            disconnect() {}
        } as unknown as typeof ResizeObserver;
        loadLocale("uk-UA");
        setLocale("uk-UA");
    });

    afterEach(async () => {
        const mounted = component;
        component = undefined;
        if (mounted) await unmount(mounted);
        target?.remove();
        for (const site of get(coWebsites)) coWebsites.remove(site);
        fullScreenCowebsite.set(false);
    });

    function render(...sites: SimpleCoWebsite[]) {
        for (const site of sites) coWebsites.add(site);
        target = document.createElement("div");
        document.body.appendChild(target);
        component = mount(CoWebsitesContainer, { target });
        flushSync();
    }

    const board = () => new SimpleCoWebsite(new URL("https://draw.qed.world/#room=abc_def,0123456789abcdefghijkl"));

    it("puts the close button last in the bar, after full screen, and closes the board", () => {
        const site = board();
        render(site);

        const bar = target.querySelector<HTMLElement>("[data-testid=cowebsite-close]")!.parentElement!;
        const buttons = [...bar.querySelectorAll("button")].map((b) => b.dataset.testid);
        expect(buttons).toEqual(["cowebsite-fullscreen", "cowebsite-close"]);
        expect(target.querySelector("[data-testid=cowebsite-close]")!.getAttribute("aria-label")).toBe("Закрити");

        target.querySelector<HTMLButtonElement>("[data-testid=cowebsite-close]")!.click();
        flushSync();
        expect(get(coWebsites)).not.toContain(site);
    });

    it("shows one close for the active board, not a second one in its tab", () => {
        render(board());
        const tab = target.querySelector("[data-testid=tab1]")!;
        expect(tab.querySelectorAll("button").length).toBe(2);
        expect(target.querySelectorAll("[data-testid=cowebsite-close]").length).toBe(1);
    });

    it("has no close for a board the map made unclosable", () => {
        render(new SimpleCoWebsite(new URL("https://draw.qed.world/#room=a,b"), false, "", 50, false));
        expect(target.querySelector("[data-testid=cowebsite-close]")).toBeNull();
    });

    it("full screen shows the expand icon, then the collapse one with its label", () => {
        render(board());
        const fullscreen = target.querySelector<HTMLButtonElement>("[data-testid=cowebsite-fullscreen]")!;
        const before = fullscreen.innerHTML;
        fullscreen.click();
        flushSync();
        expect(get(fullScreenCowebsite)).toBe(true);
        expect(fullscreen.innerHTML).not.toBe(before);
        expect(fullscreen.getAttribute("aria-label")).toBe("Вийти з повноекранного режиму");
    });

    it("opens the board iframe in the room's language; the tab keeps the map's link", () => {
        render(board());
        expect(target.querySelector("iframe")!.getAttribute("src")).toBe(
            "https://draw.qed.world/?lng=uk-UA#room=abc_def,0123456789abcdefghijkl",
        );
        expect(get(coWebsites)[0].getUrl().toString()).toBe(
            "https://draw.qed.world/#room=abc_def,0123456789abcdefghijkl",
        );
    });

    it("opens the board under the person's room name", () => {
        localUserStore.notifyPlayerDisplayNameChanged("Олена К.");
        render(board());
        const src = new URL(target.querySelector("iframe")!.getAttribute("src")!);
        expect(src.searchParams.get("name")).toBe("Олена К.");
        expect(src.searchParams.get("lng")).toBe("uk-UA");
    });
});
