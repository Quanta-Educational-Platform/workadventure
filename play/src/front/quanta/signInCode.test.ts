import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CODE = "c".repeat(43);
const ROOM = "/@/o/w/courses/course-c";

async function load(address: string, framed: boolean) {
    history.replaceState(null, "", address);
    vi.stubGlobal("parent", framed ? { postMessage: vi.fn() } : window);
    vi.resetModules();
    return import("./signInCode");
}

beforeEach(() => sessionStorage.clear());
afterEach(() => {
    vi.unstubAllGlobals();
    history.replaceState(null, "", "/");
});

describe("taking the code", () => {
    it("takes it out of the address before anything else runs, keeping the rest", async () => {
        const module = await load(`${ROOM}?lang=uk#moveTo=x&quantaCode=${CODE}`, true);
        expect(window.location.search).toBe("?lang=uk");
        expect(window.location.hash).toBe("#moveTo=x");
        expect(window.location.href).not.toContain(CODE);
        expect(module.takeSignInCode()).toBe(CODE);
    });

    it("gives it out once", async () => {
        const module = await load(`${ROOM}#quantaCode=${CODE}`, true);
        expect(window.location.hash).toBe("");
        expect(module.takeSignInCode()).toBe(CODE);
        expect(module.takeSignInCode()).toBeNull();
    });

    it("drops a code outside a frame, and does not mark the tab", async () => {
        const module = await load(`${ROOM}#quantaCode=${CODE}`, false);
        expect(window.location.href).not.toContain(CODE);
        expect(module.takeSignInCode()).toBeNull();
        expect(module.inCodeSignedFrame()).toBe(false);
    });
});

describe("with no code in sight", () => {
    it("does nothing: the address stays, and the frame is no code-signed one", async () => {
        const module = await load(`${ROOM}?lang=uk#moveTo=x`, true);
        expect(window.location.search).toBe("?lang=uk");
        expect(window.location.hash).toBe("#moveTo=x");
        expect(module.takeSignInCode()).toBeNull();
        expect(module.inCodeSignedFrame()).toBe(false);
    });
});

describe("a frame that held a code", () => {
    it("stays code-signed across a reload, which comes with no code", async () => {
        await load(`${ROOM}#quantaCode=${CODE}`, true);
        const reloaded = await load(ROOM, true);
        expect(reloaded.takeSignInCode()).toBeNull();
        expect(reloaded.inCodeSignedFrame()).toBe(true);
    });

    it("asks the page, not the redirect chain", async () => {
        const module = await load(`${ROOM}#quantaCode=${CODE}`, true);
        module.askPageForSignIn("refused", vi.fn());
        expect((window.parent as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage).toHaveBeenCalledWith(
            { type: "quanta_wa_sign_in_needed", reason: "refused" },
            "*",
        );
    });
});

describe("the exchange", () => {
    const axiosError = (status?: number) => Object.assign(new Error("failed"), status ? { response: { status } } : {});

    it("sends the code and the room it is being used in, without query or fragment", async () => {
        const module = await load(`${ROOM}?lang=uk#quantaCode=${CODE}`, true);
        const post = vi.fn().mockResolvedValue({ authToken: "wa-token" });
        expect(await module.exchangeSignInCode(CODE, post)).toEqual({ authToken: "wa-token" });
        expect(post).toHaveBeenCalledWith({ code: CODE, playUri: `${window.location.origin}${ROOM}` });
    });

    it("reads a clear refusal as one", async () => {
        const module = await load(ROOM, true);
        const answers = await Promise.all(
            [400, 401].map((status) => module.exchangeSignInCode(CODE, () => Promise.reject(axiosError(status)))),
        );
        expect(answers).toEqual([{ failed: "refused" }, { failed: "refused" }]);
    });

    it("reads everything else as an outage", async () => {
        const module = await load(ROOM, true);
        const failures = [axiosError(500), axiosError(502), axiosError(503), axiosError(), new Error("timeout")];
        const answers = await Promise.all(
            failures.map((failure) => module.exchangeSignInCode(CODE, () => Promise.reject(failure))),
        );
        expect(answers).toEqual(failures.map(() => ({ failed: "unavailable" })));
        expect(await module.exchangeSignInCode(CODE, () => Promise.resolve({ nonsense: true }))).toEqual({ failed: "unavailable" });
    });
});

describe("whether the page still uses codes", () => {
    const fromPage = (data: unknown, source: unknown = window.parent) =>
        window.dispatchEvent(new MessageEvent("message", { data, source: source as Window }));
    const sent = () => (window.parent as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage.mock.calls.map(([d]) => d as { type: string });
    const asks = () => sent().filter((d) => d.type === "quanta_wa_sign_in_mode_asked").length;

    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("leaves codes behind at once when the page says it does not use them", async () => {
        const module = await load(`${ROOM}#quantaCode=${CODE}`, true);
        const leave = vi.fn();
        module.askPageForSignIn("expired", leave);
        expect(asks()).toBe(1);
        fromPage({ type: "quanta_wa_sign_in_mode", codes: false });
        expect(leave).toHaveBeenCalledTimes(1);
        expect(module.inCodeSignedFrame()).toBe(false);
    });

    it("stays with codes when the page says it uses them, however long the server then takes", async () => {
        const module = await load(`${ROOM}#quantaCode=${CODE}`, true);
        const leave = vi.fn();
        module.askPageForSignIn("unavailable", leave);
        fromPage({ type: "quanta_wa_sign_in_mode", codes: true });
        vi.advanceTimersByTime(10 * 60_000);
        expect(leave).not.toHaveBeenCalled();
        expect(asks()).toBe(1);
        expect(module.inCodeSignedFrame()).toBe(true);
    });

    it("does not leave for a page that is slow to answer, but answers", async () => {
        const module = await load(`${ROOM}#quantaCode=${CODE}`, true);
        const leave = vi.fn();
        module.askPageForSignIn("refused", leave);
        vi.advanceTimersByTime(module.MODE_ASK_EVERY_MS * module.MODE_SILENT_ASKS_LIMIT);
        fromPage({ type: "quanta_wa_sign_in_mode", codes: true });
        vi.advanceTimersByTime(10 * 60_000);
        expect(leave).not.toHaveBeenCalled();
        expect(module.inCodeSignedFrame()).toBe(true);
    });

    it("leaves codes behind when a page in view never answers: a page from before codes", async () => {
        const module = await load(`${ROOM}#quantaCode=${CODE}`, true);
        const leave = vi.fn();
        module.askPageForSignIn("expired", leave);
        vi.advanceTimersByTime(module.MODE_ASK_EVERY_MS * module.MODE_SILENT_ASKS_LIMIT);
        expect(leave).not.toHaveBeenCalled();
        vi.advanceTimersByTime(module.MODE_ASK_EVERY_MS);
        expect(leave).toHaveBeenCalledTimes(1);
        expect(module.inCodeSignedFrame()).toBe(false);
    });

    it("does not count silence while the tab is in the background", async () => {
        const module = await load(`${ROOM}#quantaCode=${CODE}`, true);
        const hidden = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        const leave = vi.fn();
        module.askPageForSignIn("expired", leave);
        vi.advanceTimersByTime(30 * 60_000);
        expect(leave).not.toHaveBeenCalled();
        hidden.mockReturnValue("visible");
        fromPage({ type: "quanta_wa_sign_in_mode", codes: true });
        vi.advanceTimersByTime(30 * 60_000);
        expect(leave).not.toHaveBeenCalled();
    });

    it("hears only its parent", async () => {
        const module = await load(`${ROOM}#quantaCode=${CODE}`, true);
        const leave = vi.fn();
        module.askPageForSignIn("expired", leave);
        fromPage({ type: "quanta_wa_sign_in_mode", codes: false }, {});
        expect(leave).not.toHaveBeenCalled();
        fromPage({ type: "quanta_wa_sign_in_mode", codes: true });
    });

    it("sends the frame's stored token on only when the page uses codes and shows that person", async () => {
        const module = await load(`${ROOM}#quantaCode=${CODE}`, true);
        const answer = async (tokenUser: string | null, data: unknown) => {
            const verdict = module.confirmStoredTokenWithPage(tokenUser);
            fromPage(data);
            return verdict;
        };
        expect(await answer("userID_a", { type: "quanta_wa_sign_in_mode", codes: true, userId: "userID_a" })).toBe("enter");
        expect(await answer("userID_a", { type: "quanta_wa_sign_in_mode", codes: true, userId: "userID_b" })).toBe("renew");
        expect(await answer("userID_a", { type: "quanta_wa_sign_in_mode", codes: true })).toBe("renew");
        expect(await answer(null, { type: "quanta_wa_sign_in_mode", codes: true, userId: "userID_a" })).toBe("renew");
        expect(module.inCodeSignedFrame()).toBe(true);
        expect(await answer("userID_a", { type: "quanta_wa_sign_in_mode", codes: false })).toBe("leave");
        expect(module.inCodeSignedFrame()).toBe(false);
    });

    it("a stored token waits out a silent page, and is not good for anyone after", async () => {
        const module = await load(`${ROOM}#quantaCode=${CODE}`, true);
        const verdict = module.confirmStoredTokenWithPage("userID_a");
        vi.advanceTimersByTime(module.MODE_ASK_EVERY_MS * (module.MODE_SILENT_ASKS_LIMIT + 1));
        expect(await verdict).toBe("leave");
        expect(module.inCodeSignedFrame()).toBe(false);
    });

    it("asks once at a time, while each need still reaches the page", async () => {
        const module = await load(`${ROOM}#quantaCode=${CODE}`, true);
        module.askPageForSignIn("refused", vi.fn());
        module.askPageForSignIn("expired", vi.fn());
        expect(asks()).toBe(1);
        expect(sent().filter((d) => d.type === "quanta_wa_sign_in_needed")).toHaveLength(2);
        fromPage({ type: "quanta_wa_sign_in_mode", codes: true });
    });
});
