import axios from "axios";
import { ADMIN_API_TOKEN, ADMIN_API_URL } from "../enums/EnvironmentVariable";
import { isPrivateMessage, type RoomMessage } from "../../common/quanta/RoomSession";

// quanta: a course room may keep a transcript of its class chat (QNT-696): each class message, its edits and its
// deletion go to Quanta, which keeps them only while the course asks for a transcript and posts them into the
// lesson's Discussion after the lesson. Direct and group messages never leave the room.
type LineChange = { op: "send" | "edit"; message: RoomMessage } | { op: "delete"; message: RoomMessage };

export function forwardTranscriptLine(playUri: string, change: LineChange): void {
    if (!ADMIN_API_URL || !ADMIN_API_TOKEN || !playUri) return;
    if (isPrivateMessage(change.message)) return;
    const { message } = change;
    axios
        .post(
            `${ADMIN_API_URL}/api/chat-line`,
            change.op === "delete"
                ? { op: "delete", id: message.id }
                : { op: change.op, id: message.id, name: message.name, body: message.body, at: message.at },
            {
                params: { playUri },
                headers: { Authorization: ADMIN_API_TOKEN, "X-Wa-User-Identifier": message.sender },
                timeout: 10_000,
            },
        )
        .catch(() => {
            // A transcript line lost to a hiccup is not worth holding the class chat for.
        });
}
