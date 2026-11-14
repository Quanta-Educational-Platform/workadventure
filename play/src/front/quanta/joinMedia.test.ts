import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
    vi.resetModules();
    vi.doUnmock("../Enum/EnvironmentVariable");
});

it("starts a class with the microphone and camera off, whatever the last visit saved", async () => {
    vi.doMock("../Enum/EnvironmentVariable", () => ({ QUANTA_UI: true }));
    const { startingMediaState } = await import("./joinMedia");
    const saved = vi.fn(() => true);
    expect(startingMediaState(saved)).toBe(false);
    expect(saved).not.toHaveBeenCalled();
});

it("keeps WA's saved state outside a class", async () => {
    vi.doMock("../Enum/EnvironmentVariable", () => ({ QUANTA_UI: false }));
    const { startingMediaState } = await import("./joinMedia");
    expect(startingMediaState(() => true)).toBe(true);
    expect(startingMediaState(() => false)).toBe(false);
});
