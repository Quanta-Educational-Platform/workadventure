import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { connectionManager as ConnectionManager } from "../Connection/ConnectionManager";

const http = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));

vi.mock("../Connection/AxiosUtils", () => ({
    axiosToPusher: { post: http.post, get: http.get },
    axiosWithRetry: { post: http.post, get: http.get },
}));
vi.mock("../Connection/Room", () => ({
    Room: {
        createRoom: (url: URL) =>
            Promise.resolve({
                key: url.href,
                href: url.href,
                authenticationMandatory: true,
                opidLogoutRedirectUrl: "/logout",
            }),
    },
}));
vi.mock("../Connection/RoomConnection", () => ({ RoomConnection: class {} }));
vi.mock("../Phaser/Game/GameManager", () => ({
    gameManager: { setMatrixServerUrl: vi.fn(), setPlayerName: vi.fn(), logout: () => Promise.resolve() },
}));
vi.mock("../Administration/AnalyticsClient", () => ({
    analyticsClient: new Proxy({}, { get: () => () => () => undefined }),
}));
vi.mock("../Network/ServiceWorker", () => ({ _ServiceWorker: class {} }));
vi.mock("../Chat/Utils", () => ({ openChatRoom: vi.fn() }));
vi.mock("../Stores/ToastStoreSingleton", () => ({ toastStore: { addToast: vi.fn(), removeToast: vi.fn() } }));
vi.mock("../Components/Toasts/WebsocketReconnectingToast.svelte", () => ({ default: {} }));
vi.mock("../Enum/EnvironmentVariable", async (original) => ({
    ...(await original<object>()),
    ENABLE_OPENID: true,
}));
vi.mock("../Enum/ComputedConst", async (original) => ({
    ...(await original<object>()),
    ABSOLUTE_PUSHER_URL: "https://wa.example/",
}));

const CODE = "c".repeat(43);
const ROOM = "/@/quanta/qa/courses/course-c";

function jwt(claims: object): string {
    return `h.${btoa(JSON.stringify(claims))}.s`;
}
const CACHED_OTHER_ACCOUNT = jwt({ identifier: "other@example.com", accessToken: "their-token" });
const ROOM_TOKEN = jwt({ identifier: "me@example.com", accessToken: "qrs1.a.b", quantaSession: true });

const me = (authToken: string) => ({
    status: "ok",
    authToken,
    userUuid: "userID_me",
    email: "me@example.com",
    username: "me",
    visitCardUrl: null,
    tags: [],
    isCharacterTexturesValid: true,
    characterTextures: [],
    isCompanionTextureValid: true,
    companionTexture: null,
    canEdit: false,
    world: "w",
    activatedInviteUser: false,
    canRecord: false,
    analyticsEventsEnabled: false,
});

let manager: typeof ConnectionManager;
beforeAll(async () => {
    ({ connectionManager: manager } = await import("../Connection/ConnectionManager"));
}, 120_000);

function open(address: string) {
    history.replaceState(null, "", address);
    vi.stubGlobal("parent", { postMessage: vi.fn() });
    return manager;
}
const asked = () =>
    (window.parent.postMessage as ReturnType<typeof vi.fn>).mock.calls
        .map(([data]) => data as { type: string })
        .filter((data) => data.type === "quanta_wa_sign_in_needed");
const axiosFailure = (status?: number) =>
    Object.assign(new Error("failed"), { isAxiosError: true, ...(status ? { response: { status } } : {}) });

afterEach(() => {
    // Ends whatever a test left the frame asking the page.
    window.dispatchEvent(
        new MessageEvent("message", { data: { type: "quanta_wa_sign_in_mode", codes: true }, source: window.parent }),
    );
});

beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    http.post.mockReset();
    http.get.mockReset();
    document.body.innerHTML = '<input id="authToken" /><input id="matrixLoginToken" />';
    localStorage.setItem("authToken", CACHED_OTHER_ACCOUNT);
    localStorage.setItem("localUser", JSON.stringify({ uuid: "userID_other", email: "other@example.com" }));
});

describe("a code that is refused", () => {
    it("stays out of the room, forgets the cached account and never asks about it", async () => {
        http.post.mockRejectedValue(axiosFailure(401));
        const result = await open(`${ROOM}#quantaCode=${CODE}`).initGameConnexion();
        expect(result).toMatchObject({ nextScene: "errorScene", error: { type: "retry" } });
        expect(http.get).not.toHaveBeenCalled();
        expect(localStorage.getItem("authToken")).toBeNull();
        expect(localStorage.getItem("localUser")).toBeNull();
        expect(asked()).toEqual([{ type: "quanta_wa_sign_in_needed", reason: "refused" }]);
    });

    it("stays out on a reload too, without starting the redirect chain", async () => {
        http.post.mockRejectedValue(axiosFailure(401));
        await open(`${ROOM}#quantaCode=${CODE}`).initGameConnexion();
        const result = await open(ROOM).initGameConnexion();
        expect(result).not.toBeInstanceOf(URL);
        expect(result).toMatchObject({ nextScene: "errorScene" });
        expect(asked()).toEqual([{ type: "quanta_wa_sign_in_needed", reason: "expired" }]);
    });
});

describe("a shared token another tab left behind", () => {
    it("is not who a code-signed frame comes back as, after a failure or on a reload", async () => {
        http.post.mockRejectedValue(axiosFailure(401));
        await open(`${ROOM}#quantaCode=${CODE}`).initGameConnexion();
        localStorage.setItem("authToken", CACHED_OTHER_ACCOUNT);
        const result = await open(ROOM).initGameConnexion();
        expect(result).toMatchObject({ nextScene: "errorScene" });
        expect(http.get).not.toHaveBeenCalled();
        expect(asked()).toEqual([{ type: "quanta_wa_sign_in_needed", reason: "expired" }]);
    });

    it("does not replace the tab's own token in a code-signed frame", async () => {
        const own = jwt({ identifier: "me@example.com", accessToken: "qrs1.a.b", quantaSession: true, quantaUserId: "userID_me" });
        sessionStorage.setItem("quantaCodeSignedFrame", "1");
        sessionStorage.setItem("authToken", own);
        localStorage.setItem("authToken", CACHED_OTHER_ACCOUNT);
        http.get.mockResolvedValue({ data: me(own) });
        const running = open(ROOM).initGameConnexion();
        await vi.waitFor(() => expect((window.parent as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage).toHaveBeenCalled());
        window.dispatchEvent(
            new MessageEvent("message", { data: { type: "quanta_wa_sign_in_mode", codes: true, userId: "userID_me" }, source: window.parent }),
        );
        await running;
        expect(http.get.mock.calls[0][1].params.token).toBe(own);
    });
});

describe("an outage during the exchange", () => {
    it.each([[500], [503], [undefined]])("reads as a retry, never a login: status %s", async (status) => {
        http.post.mockRejectedValue(axiosFailure(status));
        const result = await open(`${ROOM}#quantaCode=${CODE}`).initGameConnexion();
        expect(result).not.toBeInstanceOf(URL);
        expect(result).toMatchObject({ nextScene: "errorScene", error: { type: "retry", canRetryManual: true } });
        expect(http.get).not.toHaveBeenCalled();
        expect(localStorage.getItem("authToken")).toBeNull();
        expect(asked()).toEqual([{ type: "quanta_wa_sign_in_needed", reason: "unavailable" }]);
    });
});

describe("a code that is accepted", () => {
    it("signs in with the new token alone, kept to the tab, and the cached account is gone", async () => {
        http.post.mockResolvedValue({ data: { authToken: ROOM_TOKEN } });
        http.get.mockResolvedValue({ data: me(ROOM_TOKEN) });
        const result = await open(`${ROOM}?lang=uk#quantaCode=${CODE}`).initGameConnexion();
        expect(result).toMatchObject({ nextScene: "gameScene" });
        expect(http.post).toHaveBeenCalledWith(
            "quanta-sign-in",
            { code: CODE, playUri: `${window.location.origin}${ROOM}` },
            expect.anything(),
        );
        expect(http.get.mock.calls[0][1].params.token).toBe(ROOM_TOKEN);
        expect(sessionStorage.getItem("authToken")).toBe(ROOM_TOKEN);
        expect(localStorage.getItem("authToken")).toBeNull();
        expect(window.location.href).not.toContain(CODE);
    });
});

describe("a code-signed frame whose session stops standing", () => {
    const OWN = jwt({ identifier: "me@example.com", accessToken: "qrs1.a.b", quantaSession: true, quantaUserId: "userID_me" });
    const pageAgrees = async () => {
        await vi.waitFor(() => expect((window.parent as unknown as { postMessage: ReturnType<typeof vi.fn> }).postMessage).toHaveBeenCalled());
        window.dispatchEvent(
            new MessageEvent("message", { data: { type: "quanta_wa_sign_in_mode", codes: true, userId: "userID_me" }, source: window.parent }),
        );
    };

    beforeEach(() => {
        sessionStorage.setItem("quantaCodeSignedFrame", "1");
        sessionStorage.setItem("authToken", OWN);
    });

    it("asks the page on the Admin API's refusal", async () => {
        http.get.mockResolvedValue({
            data: { status: "error", type: "unauthorized", code: "SIGN_IN_REQUIRED", title: "t", subtitle: "s", details: "", image: "", buttonTitle: "b" },
        });
        const running = open(ROOM).initGameConnexion();
        await pageAgrees();
        const result = await running;
        expect(result).not.toBeInstanceOf(URL);
        expect(asked()).toEqual([{ type: "quanta_wa_sign_in_needed", reason: "expired" }]);
    });

    it("asks the page on a 401, without the redirect chain", async () => {
        http.get.mockRejectedValue(axiosFailure(401));
        const running = open(ROOM).initGameConnexion();
        await pageAgrees();
        const result = await running;
        expect(result).not.toBeInstanceOf(URL);
        expect(asked()).toEqual([{ type: "quanta_wa_sign_in_needed", reason: "expired" }]);
    });

    it("logging out asks the page", () => {
        open(ROOM).logout();
        expect(sessionStorage.getItem("authToken")).toBeNull();
        expect(asked()).toEqual([{ type: "quanta_wa_sign_in_needed", reason: "expired" }]);
    });
});

describe("a tab that used a code, on a page that no longer does", () => {
    const answer = (codes: boolean) =>
        window.dispatchEvent(
            new MessageEvent("message", { data: { type: "quanta_wa_sign_in_mode", codes }, source: window.parent }),
        );

    beforeEach(() => {
        sessionStorage.setItem("quantaCodeSignedFrame", "1");
        localStorage.removeItem("authToken");
    });

    it("goes back to the old flow, knowing nobody, when the flag is off", async () => {
        const first = await open(ROOM).initGameConnexion();
        expect(first).not.toBeInstanceOf(URL);
        localStorage.setItem("authToken", CACHED_OTHER_ACCOUNT);
        sessionStorage.setItem("authToken", ROOM_TOKEN);
        answer(false);
        expect(sessionStorage.getItem("quantaCodeSignedFrame")).toBeNull();
        expect(sessionStorage.getItem("authToken")).toBeNull();
        expect(localStorage.getItem("authToken")).toBeNull();
        expect(localStorage.getItem("localUser")).toBeNull();

        const reloaded = await open(ROOM).initGameConnexion();
        expect(reloaded).toBeInstanceOf(URL);
        expect((reloaded as URL).pathname).toContain("login-screen");
        expect(http.get).not.toHaveBeenCalled();
    });

    it("stays out, and off the old flow, when the page uses codes and only the server is out", async () => {
        http.post.mockRejectedValue(axiosFailure(503));
        const result = await open(`${ROOM}#quantaCode=${CODE}`).initGameConnexion();
        expect(result).not.toBeInstanceOf(URL);
        answer(true);
        expect(sessionStorage.getItem("quantaCodeSignedFrame")).toBe("1");
        const reloaded = await open(ROOM).initGameConnexion();
        expect(reloaded).not.toBeInstanceOf(URL);
        expect(reloaded).toMatchObject({ nextScene: "errorScene" });
        answer(true);
    });
});

describe("a code-signed frame coming back on the token it kept", () => {
    const ALICE = jwt({ identifier: "alice@example.com", accessToken: "qrs1.a.b", quantaSession: true, quantaUserId: "userID_alice" });
    const fromPage = (data: object) =>
        window.dispatchEvent(new MessageEvent("message", { data: { type: "quanta_wa_sign_in_mode", ...data }, source: window.parent }));
    // The frame asks before anything else it awaits, so the page can answer as soon as the question is out.
    const whenAsked = async (answer: () => void) => {
        await vi.waitFor(() => {
            const asks = (window.parent.postMessage as ReturnType<typeof vi.fn>).mock.calls.filter(
                ([data]) => (data as { type: string }).type === "quanta_wa_sign_in_mode_asked",
            );
            expect(asks.length).toBeGreaterThan(0);
        });
        answer();
    };

    beforeEach(() => {
        sessionStorage.setItem("quantaCodeSignedFrame", "1");
        sessionStorage.setItem("authToken", ALICE);
    });

    it("flag off, page now showing someone else: forgets the token and takes the old flow, without entering", async () => {
        const running = open(ROOM).initGameConnexion();
        await whenAsked(() => fromPage({ codes: false }));
        const result = await running;
        expect(result).toBeInstanceOf(URL);
        expect((result as URL).pathname).toContain("login-screen");
        expect(http.get).not.toHaveBeenCalled();
        expect(sessionStorage.getItem("authToken")).toBeNull();
        expect(sessionStorage.getItem("quantaCodeSignedFrame")).toBeNull();
        expect(localStorage.getItem("localUser")).toBeNull();
    });

    it("flag on, page showing someone else: forgets the token and asks for a code, without entering", async () => {
        const running = open(ROOM).initGameConnexion();
        await whenAsked(() => fromPage({ codes: true, userId: "userID_bob" }));
        const result = await running;
        expect(result).not.toBeInstanceOf(URL);
        expect(result).toMatchObject({ nextScene: "errorScene" });
        expect(http.get).not.toHaveBeenCalled();
        expect(sessionStorage.getItem("authToken")).toBeNull();
        expect(sessionStorage.getItem("quantaCodeSignedFrame")).toBe("1");
        expect(asked()).toEqual([{ type: "quanta_wa_sign_in_needed", reason: "expired" }]);
    });

    it("flag on, page showing the same person: enters on the kept token, with no new code", async () => {
        http.get.mockResolvedValue({ data: me(ALICE) });
        const running = open(ROOM).initGameConnexion();
        await whenAsked(() => fromPage({ codes: true, userId: "userID_alice" }));
        expect(await running).toMatchObject({ nextScene: "gameScene" });
        expect(http.get.mock.calls[0][1].params.token).toBe(ALICE);
        expect(asked()).toEqual([]);
    });

    it("does not touch the server before the page has answered", async () => {
        http.get.mockResolvedValue({ data: me(ALICE) });
        const running = open(ROOM).initGameConnexion();
        await whenAsked(() => undefined);
        expect(http.get).not.toHaveBeenCalled();
        fromPage({ codes: true, userId: "userID_alice" });
        await running;
    });

    it("a token that names nobody is not taken on trust", async () => {
        sessionStorage.setItem("authToken", ROOM_TOKEN);
        const running = open(ROOM).initGameConnexion();
        await whenAsked(() => fromPage({ codes: true, userId: "userID_me" }));
        expect(await running).toMatchObject({ nextScene: "errorScene" });
        expect(http.get).not.toHaveBeenCalled();
    });

    it("a page that stays silent: forgets the token first, then the old flow", async () => {
        vi.useFakeTimers();
        try {
            const running = open(ROOM).initGameConnexion();
            await vi.advanceTimersByTimeAsync(22_000);
            const result = await running;
            expect(result).toBeInstanceOf(URL);
            expect(http.get).not.toHaveBeenCalled();
            expect(sessionStorage.getItem("authToken")).toBeNull();
            expect(sessionStorage.getItem("quantaCodeSignedFrame")).toBeNull();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("with the flag off: no code, no marker", () => {
    it("waits for no answer: an unmarked frame asks the page nothing before entering", async () => {
        http.get.mockResolvedValue({ data: me(CACHED_OTHER_ACCOUNT) });
        await open(ROOM).initGameConnexion();
        const sent = (window.parent.postMessage as ReturnType<typeof vi.fn>).mock.calls;
        expect(sent).toEqual([]);
    });

    it("keeps the cached token and the usual calls, and asks the page nothing", async () => {
        http.get.mockResolvedValue({ data: me(CACHED_OTHER_ACCOUNT) });
        const result = await open(ROOM).initGameConnexion();
        expect(result).toMatchObject({ nextScene: "gameScene" });
        expect(http.post).not.toHaveBeenCalled();
        expect(http.get.mock.calls[0][1].params.token).toBe(CACHED_OTHER_ACCOUNT);
        expect(localStorage.getItem("authToken")).toBe(CACHED_OTHER_ACCOUNT);
        expect(sessionStorage.getItem("authToken")).toBeNull();
        expect(asked()).toEqual([]);
    });

    it("still goes to the login screen on a 401", async () => {
        http.get.mockRejectedValue(axiosFailure(401));
        const result = await open(ROOM).initGameConnexion();
        expect(result).toBeInstanceOf(URL);
        expect((result as URL).pathname).toContain("login-screen");
        expect(asked()).toEqual([]);
    });

    it("still goes to the login screen with no token", async () => {
        localStorage.removeItem("authToken");
        const result = await open(ROOM).initGameConnexion();
        expect(result).toBeInstanceOf(URL);
        expect(asked()).toEqual([]);
    });
});
