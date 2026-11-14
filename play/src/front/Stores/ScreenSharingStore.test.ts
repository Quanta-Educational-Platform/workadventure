import { get } from "svelte/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const audience = vi.hoisted(() => ({ set: (_value: boolean): void => {} }));

vi.mock("./IsStreamingStore", async () => {
    const { writable } = await import("svelte/store");
    const available = writable(true);
    audience.set = (value) => available.set(value);
    return { isScreenSharingAvailableStore: available };
});
vi.mock("./MyMediaStore", async () => {
    const { writable } = await import("svelte/store");
    return { inExternalServiceStore: writable(false), myCameraStore: writable(true), myMicrophoneStore: writable(true) };
});
// Audience-only stores the capture must not depend on
vi.mock("./MediaStore", async () => {
    const { writable } = await import("svelte/store");
    return { isSpeakerStore: writable(false) };
});
vi.mock("./PeerStore", async () => {
    const { writable } = await import("svelte/store");
    return { screenShareStreamElementsStore: writable([]) };
});
vi.mock("../Connection/LocalUserStore", () => ({
    localUserStore: { getScreenShareQuality: () => "high", setScreenShareQuality: () => {} },
}));
vi.mock("../Administration/AnalyticsClient", () => ({
    analyticsClient: { openTimedEvent: () => () => {} },
}));
vi.mock("../../i18n/i18n-svelte", async () => {
    const { readable } = await import("svelte/store");
    return { default: readable({ camera: { my: { nameTag: () => "me" } } }) };
});
vi.mock("../Space/VideoBox", () => ({ VideoBox: { fromLocalStreamable: () => ({ destroy: () => {} }) } }));
vi.mock("../WebRtc/LocalEncoderStats", () => ({ localEncoderStatsStore: { screenSharing: undefined } }));
vi.mock("./MuteMediaStreamStore", () => ({ muteMediaStreamStore: (store: unknown) => store }));

import { requestedScreenSharingState, screenSharingLocalStreamStore } from "./ScreenSharingStore";

interface FakeTrack {
    stop: ReturnType<typeof vi.fn>;
    applyConstraints: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
}

function fakeCapture(): { stream: MediaStream; track: FakeTrack } {
    const track: FakeTrack = { stop: vi.fn(), applyConstraints: vi.fn().mockResolvedValue(undefined), onended: null };
    const stream = {
        getTracks: () => [track],
        getVideoTracks: () => [track],
        getAudioTracks: () => [],
    } as unknown as MediaStream;
    return { stream, track };
}

function currentStream(): MediaStream | undefined {
    const value = get(screenSharingLocalStreamStore);
    return value.type === "success" ? value.stream : undefined;
}

const flush = () =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
const setAudience = (value: boolean) => audience.set(value);

describe("screen sharing capture lifetime", () => {
    let getDisplayMedia: ReturnType<typeof vi.fn>;
    let capture: ReturnType<typeof fakeCapture>;

    beforeEach(() => {
        capture = fakeCapture();
        getDisplayMedia = vi.fn().mockResolvedValue(capture.stream);
        Object.defineProperty(navigator, "mediaDevices", { value: { getDisplayMedia }, configurable: true });
        setAudience(true);
    });

    afterEach(async () => {
        requestedScreenSharingState.disableScreenSharing();
        await flush();
    });

    it("keeps the capture while the sharer has no audience, and does not ask for a screen again", async () => {
        requestedScreenSharingState.enableScreenSharing();
        await flush();
        expect(currentStream()).toBe(capture.stream);

        // Walked out of the bubble, or off the podium
        setAudience(false);
        await flush();
        expect(get(requestedScreenSharingState)).toBe(true);
        expect(currentStream()).toBe(capture.stream);
        expect(capture.track.stop).not.toHaveBeenCalled();

        setAudience(true);
        await flush();
        expect(currentStream()).toBe(capture.stream);
        expect(getDisplayMedia).toHaveBeenCalledTimes(1);
    });

    it("stops the capture when the sharer stops it", async () => {
        requestedScreenSharingState.enableScreenSharing();
        await flush();
        setAudience(false);
        await flush();

        requestedScreenSharingState.disableScreenSharing();
        await flush();
        expect(capture.track.stop).toHaveBeenCalled();
        expect(currentStream()).toBeUndefined();
    });

    it("turns sharing off when the browser ends the capture", async () => {
        requestedScreenSharingState.enableScreenSharing();
        await flush();

        capture.track.onended?.();
        await flush();
        expect(get(requestedScreenSharingState)).toBe(false);
        expect(currentStream()).toBeUndefined();

        // Sharing again asks for a screen again
        const second = fakeCapture();
        getDisplayMedia.mockResolvedValue(second.stream);
        requestedScreenSharingState.enableScreenSharing();
        await flush();
        expect(getDisplayMedia).toHaveBeenCalledTimes(2);
        expect(currentStream()).toBe(second.stream);
    });
});

describe("screen sharing picker", () => {
    afterEach(async () => {
        requestedScreenSharingState.disableScreenSharing();
        await flush();
        vi.unstubAllGlobals();
    });

    it("lets Chrome share the lesson's own tab and opens the picker on the tabs", async () => {
        const getDisplayMedia = vi.fn().mockResolvedValue(fakeCapture().stream);
        Object.defineProperty(navigator, "mediaDevices", {
            value: { getDisplayMedia, getSupportedConstraints: () => ({ displaySurface: true }) },
            configurable: true,
        });
        vi.stubGlobal("CaptureController", class {});
        setAudience(true);

        requestedScreenSharingState.enableScreenSharing();
        await flush();

        expect(getDisplayMedia).toHaveBeenCalledWith(
            expect.objectContaining({
                video: { displaySurface: "browser" },
                selfBrowserSurface: "include",
                surfaceSwitching: "include",
            }),
        );
    });
});
