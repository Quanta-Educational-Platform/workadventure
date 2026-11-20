import { axiosToPusher } from "../Connection/AxiosUtils";
import { localUserStore } from "../Connection/LocalUserStore";
import { gameManager } from "../Phaser/Game/GameManager";

// quanta: pictures and PDFs sent in the room's chat are kept on Quanta for 12 hours (agreed 2026-11-04) instead of
// travelling browser to browser: everyone in the chat sees them, latecomers and reloads included. The message
// itself carries a signed link to the file, so it lives in the chat history like any other message.

export const CHAT_FILE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"] as const;
export const CHAT_FILE_MAX_BYTES = 10 * 1024 * 1024;
const PREFIX = "⁣qfile:";

export interface ChatFileRef {
    url: string;
    name: string;
    mime: string;
    size: number;
}

/** Kept on Quanta: a picture or a PDF up to 10 MB. Anything else still goes browser to browser. */
export function isServerChatFile(file: File): boolean {
    return (CHAT_FILE_MIME_TYPES as readonly string[]).includes(file.type) && file.size <= CHAT_FILE_MAX_BYTES;
}

export function chatFileBody(ref: ChatFileRef): string {
    return PREFIX + JSON.stringify(ref);
}

/** The file a message carries, if it is one of ours; anything malformed reads as plain text. */
export function chatFileFromBody(body: string): ChatFileRef | null {
    if (!body.startsWith(PREFIX)) return null;
    try {
        const ref = JSON.parse(body.slice(PREFIX.length)) as Partial<ChatFileRef>;
        if (typeof ref.url !== "string" || !/^https:\/\/[^\s]+$/.test(ref.url)) return null;
        if (!new URL(ref.url).pathname.startsWith("/api/room-chat-file/")) return null;
        if (typeof ref.mime !== "string" || !(CHAT_FILE_MIME_TYPES as readonly string[]).includes(ref.mime)) return null;
        return {
            url: ref.url,
            name: typeof ref.name === "string" && ref.name ? ref.name.slice(0, 200) : "file",
            mime: ref.mime,
            size: typeof ref.size === "number" ? ref.size : 0,
        };
    } catch {
        return null;
    }
}

/** Sends one file to Quanta through the room server, which vouches for the sender. */
export async function uploadChatFile(file: File): Promise<ChatFileRef> {
    const token = localUserStore.getAuthToken();
    if (!token) throw new Error("Not signed in to the room.");
    const answer = await axiosToPusher.post<ChatFileRef>("quanta/chat-file", file, {
        params: { roomUrl: gameManager.currentStartedRoom.key, name: file.name || "file", mime: file.type },
        headers: { Authorization: token, "Content-Type": file.type },
        timeout: 60_000,
    });
    return answer.data;
}
