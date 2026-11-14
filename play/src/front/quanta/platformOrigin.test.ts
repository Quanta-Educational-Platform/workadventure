import { afterEach, expect, it, vi } from "vitest";

vi.mock("../Enum/EnvironmentVariable", () => ({ QUANTA_URL: "https://internal-testing.dev.qed.world" }));

import { fromPlatform, onPlatformOriginLearned, platformOrigin, resetPlatformOriginForTests } from "./platformOrigin";

afterEach(() => {
    resetPlatformOriginForTests();
    vi.unstubAllGlobals();
});

const parent = {};
const message = (origin: string, source: unknown = parent) => ({ origin, source }) as unknown as MessageEvent;

it("trusts the embedding workspace though the frame signed in through another workspace's consent page", () => {
    vi.stubGlobal("window", { parent, location: {} });
    vi.stubGlobal("document", { referrer: "https://internal-testing.dev.qed.world/" });
    expect(platformOrigin()).toBe("https://internal-testing.dev.qed.world");
    const learned = vi.fn();
    onPlatformOriginLearned(learned);
    expect(fromPlatform(message("https://qa-mobile.dev.qed.world"))).toBe(true);
    expect(platformOrigin()).toBe("https://qa-mobile.dev.qed.world");
    // What went to the consent page's origin is said again, once.
    expect(learned).toHaveBeenCalledTimes(1);
    expect(fromPlatform(message("https://qa-mobile.dev.qed.world"))).toBe(true);
    expect(learned).toHaveBeenCalledTimes(1);
    // Quanta's other sites embed rooms too.
    expect(fromPlatform(message("https://mit.quanta.world"))).toBe(true);
});

it("prefers the embedding page's own origin and refuses other sites and other windows", () => {
    vi.stubGlobal("window", { parent, location: { ancestorOrigins: ["https://kvanta.dev.qed.world"] } });
    vi.stubGlobal("document", { referrer: "https://internal-testing.dev.qed.world/" });
    expect(platformOrigin()).toBe("https://kvanta.dev.qed.world");
    expect(fromPlatform(message("https://evil.example"))).toBe(false);
    expect(fromPlatform(message("http://kvanta.dev.qed.world"))).toBe(false);
    expect(fromPlatform(message("https://kvanta.dev.qed.world", {}))).toBe(false);
    expect(platformOrigin()).toBe("https://kvanta.dev.qed.world");
});
