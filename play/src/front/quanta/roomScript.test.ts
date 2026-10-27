import { describe, expect, it, vi } from "vitest";

vi.mock("../Enum/EnvironmentVariable", () => ({ QUANTA_URL: "https://www.dev.qed.world" }));

import { quantaRoomScript } from "./roomScript";

describe("quantaRoomScript", () => {
    it("loads Quanta's room script from this server's Quanta, whichever Quanta the map names", () => {
        expect(quantaRoomScript("https://app.quanta.world/wa/quanta-button.js")).toBe(
            "https://www.dev.qed.world/wa/quanta-button.js",
        );
        expect(quantaRoomScript("https://kvanta.qed.world/wa/quanta-button.js?v=2")).toBe(
            "https://www.dev.qed.world/wa/quanta-button.js?v=2",
        );
    });

    it("leaves every other script alone", () => {
        for (const url of [
            "https://app.quanta.world/wa/other.js",
            "https://example.com/wa/quanta-button.js",
            "https://quanta.world.example.com/wa/quanta-button.js",
            "https://wa-dev.qed.world/map-storage/dev/script.js",
        ]) {
            expect(quantaRoomScript(url)).toBe(url);
        }
    });
});
