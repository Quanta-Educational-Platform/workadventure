import type { Request, Response } from "express";
import express from "express";
import axios, { isAxiosError } from "axios";
import { z } from "zod";
import type { ResponseWithUserIdentifier } from "../middlewares/Authenticated";
import { authenticated } from "../middlewares/Authenticated";
import { ADMIN_API_TOKEN, ADMIN_API_URL } from "../enums/EnvironmentVariable";
import { BaseHttpController } from "./BaseHttpController";

// quanta: a picture or PDF sent in a room's chat goes to Quanta, which keeps it 12 hours and answers with a signed
// link; the room server vouches for the sender (their room token) and the room they are in. Replaces the
// browser-to-browser transfer for these files, so latecomers and reloads see them too.
const MAX_BYTES = 10 * 1024 * 1024;
const Query = z.object({
    roomUrl: z.string().min(1).max(2048),
    name: z.string().min(1).max(200),
    mime: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"]),
});

export class QuantaChatFileController extends BaseHttpController {
    routes(): void {
        this.app.options("/quanta/chat-file", (req: Request, res: Response) => {
            res.status(200).send("");
        });
        this.app.post(
            "/quanta/chat-file",
            [authenticated, express.raw({ type: () => true, limit: MAX_BYTES })],
            async (req: Request, res: ResponseWithUserIdentifier) => {
                const query = Query.safeParse(req.query);
                if (!query.success) {
                    res.status(400).json({ error: "bad_request" });
                    return;
                }
                if (!res.userIdentifier) {
                    res.status(401).json({ error: "unauthenticated" });
                    return;
                }
                if (!ADMIN_API_URL || !ADMIN_API_TOKEN) {
                    res.status(503).json({ error: "unavailable" });
                    return;
                }
                const body = req.body as unknown;
                if (!Buffer.isBuffer(body) || body.length === 0) {
                    res.status(400).json({ error: "empty" });
                    return;
                }
                try {
                    const answer = await axios.post(`${ADMIN_API_URL}/api/chat-file`, body, {
                        params: {
                            playUri: query.data.roomUrl,
                            userIdentifier: res.userIdentifier,
                            name: query.data.name,
                            mime: query.data.mime,
                        },
                        headers: { Authorization: ADMIN_API_TOKEN, "Content-Type": query.data.mime },
                        maxBodyLength: MAX_BYTES + 1024,
                        timeout: 30_000,
                    });
                    res.status(200).json(answer.data);
                } catch (error) {
                    if (isAxiosError(error) && error.response) {
                        res.status(error.response.status).json(error.response.data ?? { error: "failed" });
                        return;
                    }
                    console.error("[quanta chat-file]", error);
                    res.status(502).json({ error: "failed" });
                }
            },
        );
    }
}
