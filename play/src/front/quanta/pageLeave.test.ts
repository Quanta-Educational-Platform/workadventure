import { describe, expect, it } from "vitest";
import { pageLeaving, watchPageLeave } from "./pageLeave";

describe("pageLeaving", () => {
    it("is leaving from pagehide until the page comes back, and for a short while after beforeunload", () => {
        const page = new EventTarget() as Window;
        watchPageLeave(page);
        expect(pageLeaving()).toBe(false);
        page.dispatchEvent(new Event("beforeunload"));
        expect(pageLeaving()).toBe(true);
        expect(pageLeaving(Date.now() + 11_000)).toBe(false);
        page.dispatchEvent(new Event("pagehide"));
        expect(pageLeaving(Date.now() + 60_000)).toBe(true);
        page.dispatchEvent(new Event("pageshow"));
        expect(pageLeaving()).toBe(false);
    });
});
