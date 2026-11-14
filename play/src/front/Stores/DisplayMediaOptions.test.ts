import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDisplayMediaOptions, detectDisplayCaptureSupport } from "./DisplayMediaOptions";

const chrome = { displaySurface: true, restrictOwnAudio: true, chromiumPickerOptions: true };
const plain = { displaySurface: false, restrictOwnAudio: false, chromiumPickerOptions: false };

describe("buildDisplayMediaOptions", () => {
    it("offers this tab in Chrome's picker, opens it on the tabs and keeps the room's sound out", () => {
        expect(buildDisplayMediaOptions({ video: true, audio: true }, chrome)).toEqual({
            video: { displaySurface: "browser" },
            audio: { restrictOwnAudio: true },
            selfBrowserSurface: "include",
            surfaceSwitching: "include",
            systemAudio: "exclude",
        });
    });

    it("passes nothing a browser without those options does not know", () => {
        expect(buildDisplayMediaOptions({ video: true, audio: true }, plain)).toEqual({ video: true, audio: true });
    });

    it("still offers this tab where only the picker options exist", () => {
        expect(
            buildDisplayMediaOptions(
                { video: true, audio: true },
                { displaySurface: false, restrictOwnAudio: false, chromiumPickerOptions: true },
            ),
        ).toMatchObject({ video: true, audio: true, selfBrowserSurface: "include" });
    });

    it("asks for no sound when none is wanted", () => {
        expect(buildDisplayMediaOptions({ video: true, audio: false }, chrome).audio).toBe(false);
    });
});

describe("detectDisplayCaptureSupport", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("reads the supported constraints and Chromium's CaptureController", () => {
        vi.stubGlobal("navigator", {
            mediaDevices: { getSupportedConstraints: () => ({ displaySurface: true, restrictOwnAudio: true }) },
        });
        vi.stubGlobal("CaptureController", class {});

        expect(detectDisplayCaptureSupport()).toEqual(chrome);
    });

    it("assumes nothing when the browser does not say", () => {
        vi.stubGlobal("navigator", { mediaDevices: {} });
        vi.stubGlobal("CaptureController", undefined);

        expect(detectDisplayCaptureSupport()).toEqual(plain);
    });
});
