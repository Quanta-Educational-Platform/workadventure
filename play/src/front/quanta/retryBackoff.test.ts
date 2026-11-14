import { describe, expect, it } from "vitest";
import { retryWaitMs } from "./retryBackoff";

describe("retryWaitMs", () => {
    it("doubles the server's wait for each retry in a row, in whole seconds, up to 3 minutes", () => {
        expect(retryWaitMs(12_000, 0)).toBe(12_000);
        expect(retryWaitMs(12_000, 1)).toBe(24_000);
        expect(retryWaitMs(12_000, 3)).toBe(96_000);
        expect(retryWaitMs(12_000, 9, () => 0)).toBe(120_000);
        expect(retryWaitMs(12_000, 9, () => 0.999)).toBe(180_000);
        expect(retryWaitMs(12_345, 0) % 1000).toBe(0);
    });

    it("never waits less than a second, whatever it is handed", () => {
        expect(retryWaitMs(0, 0)).toBe(1000);
        expect(retryWaitMs(5_000, -2)).toBe(5_000);
    });
});
