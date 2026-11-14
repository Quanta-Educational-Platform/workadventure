import { errors } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    verify: vi.fn(),
    create: vi.fn(() => Promise.resolve("wa-token")),
    exchange: vi.fn(),
    enabled: vi.fn(() => true),
    userinfo: vi.fn(),
    member: vi.fn((..._args: unknown[]) => Promise.resolve({ status: "ok", userUuid: "u", email: "s@example.com" })),
}));

vi.mock("../services/JWTTokenManager", () => ({
    jwtTokenManager: { verifyJWTToken: mocks.verify, createAuthToken: mocks.create },
}));
vi.mock("../services/AdminApi", () => ({
    adminApi: { isEnabled: () => mocks.enabled(), exchangeQuantaSignInCode: mocks.exchange },
}));
vi.mock("../services/AdminService", () => ({ adminService: { fetchMemberDataByUuid: mocks.member } }));
vi.mock("../services/OpenIDClient", () => ({ openIDClient: { checkTokenAuthWithRefresh: mocks.userinfo } }));
vi.mock("../services/MatrixProvider", () => ({ matrixProvider: { getBareMatrixIdFromEmail: () => "@s:matrix" } }));
vi.mock("../services/verifyDomain/VerifyDomainService", () => ({ VerifyDomainService: { get: () => ({}) } }));
vi.mock("../enums/EnvironmentVariable", () => ({ DISABLE_ANONYMOUS: false, FRONT_URL: "", MATRIX_PUBLIC_URI: "", PUSHER_URL: "" }));
vi.mock("../services/QueryValidator", () => ({ validateQuery: (req: { query: unknown }) => req.query }));

const { AuthenticateController } = await import("./AuthenticateController");

type Handler = (req: unknown, res: ReturnType<typeof response>) => Promise<void>;
const routes: Record<string, Handler> = {};
const app = new Proxy(
    {},
    {
        get: (_t, method: string) => (path: string, ...handlers: Handler[]) => {
            routes[`${method} ${path}`] = handlers[handlers.length - 1];
        },
    },
);
new AuthenticateController(app as never);

function response() {
    const res = {
        statusCode: 200,
        body: undefined as unknown,
        set: () => res,
        header: () => "",
        status(code: number) {
            res.statusCode = code;
            return res;
        },
        send(body: unknown) {
            res.body = body;
            return res;
        },
        json(body: unknown) {
            res.body = body;
            return res;
        },
    };
    return res;
}
const me = async () => {
    const res = response();
    await routes["get /me"]({ method: "GET", originalUrl: "/me", query: { token: "t", playUri: "p" }, header: () => "" }, res);
    return res;
};
const ROOM = "https://wa.qed.world/@/o/w/courses/course-c";
const signIn = async (code: unknown, playUri: unknown = ROOM) => {
    const res = response();
    await routes["post /quanta-sign-in"]({ body: { code, playUri } }, res);
    return res;
};

beforeEach(() => {
    Object.values(mocks).forEach((mock) => mock.mockClear());
    mocks.enabled.mockReturnValue(true);
    mocks.verify.mockResolvedValue({ identifier: "s@example.com", accessToken: "qrs1.room.session", quantaSession: true });
});

describe("POST /quanta-sign-in", () => {
    const CODE = "c".repeat(43);

    it("answers a token carrying the room session, for the room it was asked in", async () => {
        mocks.exchange.mockResolvedValue({ email: "s@example.com", userId: "userID_me", roomSession: "qrs1.room.session" });
        expect((await signIn(CODE)).body).toEqual({ authToken: "wa-token" });
        expect(mocks.exchange).toHaveBeenCalledWith(CODE, ROOM);
        expect(mocks.create).toHaveBeenCalledWith(
            "s@example.com",
            "qrs1.room.session",
            undefined,
            undefined,
            undefined,
            "@s:matrix",
            undefined,
            true,
            "userID_me",
        );
    });

    it("refuses a spent code and a malformed request", async () => {
        mocks.exchange.mockResolvedValue(null);
        expect((await signIn(CODE)).statusCode).toBe(401);
        expect((await signIn("short")).statusCode).toBe(400);
        expect((await signIn(CODE, "not a url")).statusCode).toBe(400);
        expect(mocks.create).not.toHaveBeenCalled();
    });

    it("answers an outage as an outage, never a refusal", async () => {
        mocks.exchange.mockRejectedValue(new Error("connect ECONNREFUSED"));
        expect((await signIn(CODE)).statusCode).toBe(503);
        mocks.enabled.mockReturnValue(false);
        expect((await signIn(CODE)).statusCode).toBe(503);
        expect(mocks.create).not.toHaveBeenCalled();
    });
});

describe("GET /me with a sign-in code's token", () => {
    it("asks only the Admin API about the room session, with no OpenID call that would refuse it", async () => {
        const res = await me();
        expect(res.statusCode).toBe(200);
        expect(mocks.userinfo).not.toHaveBeenCalled();
        expect(mocks.member.mock.calls[0][1]).toBe("qrs1.room.session");
        expect((res.body as { authToken: string }).authToken).toBe("t");
    });

    it("passes on the Admin API's refusal, which the framed room turns into a request for a new code", async () => {
        mocks.member.mockResolvedValueOnce({ status: "error", type: "unauthorized", code: "SIGN_IN_REQUIRED" } as never);
        const res = await me();
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ status: "error", type: "unauthorized" });
    });

    it("does not read an Admin API outage as signed out", async () => {
        mocks.member.mockRejectedValueOnce(new Error("Admin API down"));
        await expect(me()).rejects.toThrow("Admin API down");
    });

    it("leaves an OpenID token on the OpenID check, as it was", async () => {
        mocks.verify.mockResolvedValue({ identifier: "s@example.com", accessToken: "oauth-token" });
        mocks.userinfo.mockResolvedValue({ userInfo: {}, claims: {}, accessToken: "oauth-token", refreshed: false });
        await me();
        expect(mocks.userinfo).toHaveBeenCalled();
        expect(mocks.member.mock.calls[0][1]).toBe("oauth-token");
    });

    it("still answers 401 for an invalid token", async () => {
        mocks.verify.mockRejectedValue(new errors.JWTInvalid("bad"));
        expect((await me()).statusCode).toBe(401);
    });
});
