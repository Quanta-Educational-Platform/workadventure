import { expect, it } from "vitest";
import { permissionPromptPending, permissionPromptPlace } from "./permissionPrompt";

it("waits on the browser while either device is still to be allowed, and says nothing when unknown", () => {
    expect(permissionPromptPending("prompt", "granted")).toBe(true);
    expect(permissionPromptPending("granted", "prompt")).toBe(true);
    expect(permissionPromptPending("granted", "granted")).toBe(false);
    expect(permissionPromptPending("denied", "granted")).toBe(false);
    expect(permissionPromptPending(null, null)).toBe(false);
});

const chrome =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const edge = `${chrome} Edg/130.0.0.0`;
const firefox = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0";
const safari =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const iphone =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1";
const android =
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";

it("points at the address bar on desktop Chrome, Edge and Firefox, at the browser's dialog elsewhere", () => {
    expect(permissionPromptPlace(chrome)).toBe("addressBar");
    expect(permissionPromptPlace(edge)).toBe("addressBar");
    expect(permissionPromptPlace(firefox)).toBe("addressBar");
    expect(permissionPromptPlace(safari)).toBe("dialog");
    expect(permissionPromptPlace(iphone)).toBe("dialog");
    expect(permissionPromptPlace(android)).toBe("dialog");
    // An iPad asking for the desktop site.
    expect(permissionPromptPlace(safari, 5)).toBe("dialog");
});
