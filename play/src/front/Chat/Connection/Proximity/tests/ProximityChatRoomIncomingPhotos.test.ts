import { get } from "svelte/store";
import { Subject } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadLocale } from "../../../../../i18n/i18n-util.sync";
import { setLocale } from "../../../../../i18n/i18n-svelte";
import type { IncomingProximityFileTransferOffer } from "../ProximityFileTransferService";
import { ProximityChatRoom } from "../ProximityChatRoom";

const env = vi.hoisted(() => ({ QUANTA_UI: true }));
vi.mock("../../../../Enum/EnvironmentVariable", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    get QUANTA_UI() {
        return env.QUANTA_UI;
    },
}));
vi.mock("../../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        getCurrentGameScene: () => ({
            playSound: vi.fn(),
        }),
    },
}));
vi.mock("../../../Phaser/Game/GameManager", () => ({
    gameManager: {
        getCurrentGameScene: () => ({
            playSound: vi.fn(),
        }),
    },
}));
vi.mock("../../../../Phaser/Game/GameScene", () => ({}));
vi.mock("../../../Phaser/Game/GameScene", () => ({}));

function createRoom() {
    return new ProximityChatRoom(
        "recipient",
        "Recipient",
        "default",
        "recipient",
        {
            leaveSpace: vi.fn().mockResolvedValue(undefined),
        } as never,
        {
            newChatMessageWritingStatusStream: new Subject(),
        },
        {
            getPlayers: () => new Map(),
        } as never,
        {
            playBubbleInSound: vi.fn(),
            playBubbleOutSound: vi.fn(),
            playMeetingInSound: vi.fn(),
            playMeetingOutSound: vi.fn(),
        },
        undefined,
        [],
        vi.fn(),
    );
}

function offer(mimeType: string, size: number): IncomingProximityFileTransferOffer {
    return {
        transferId: "transfer-1",
        fileName: "photo",
        mimeType,
        size,
        characterTextures: [],
        name: "Sender",
        senderSpaceUserId: "sender",
    };
}

function roomWithService() {
    const room = createRoom();
    const download = vi.fn().mockResolvedValue(undefined);
    Reflect.set(room, "fileTransferService", { download });
    return { room, download };
}

describe("ProximityChatRoom incoming photos", () => {
    beforeEach(() => {
        loadLocale("en-US");
        setLocale("en-US");
        env.QUANTA_UI = true;
    });

    it("fetches a small photo in a class chat without waiting for Accept", () => {
        const { room, download } = roomWithService();

        Reflect.get(room, "addIncomingFileOffer").call(room, offer("image/jpeg", 2_000_000));

        expect(download).toHaveBeenCalledWith("transfer-1");
    });

    it("still asks before fetching other files, and outside a class", () => {
        const { room, download } = roomWithService();
        Reflect.get(room, "addIncomingFileOffer").call(room, offer("application/pdf", 1000));
        expect(download).not.toHaveBeenCalled();

        env.QUANTA_UI = false;
        const other = roomWithService();
        Reflect.get(other.room, "addIncomingFileOffer").call(other.room, offer("image/jpeg", 1000));
        expect(other.download).not.toHaveBeenCalled();
    });

    it.each([
        ["connection", "connection"],
        ["interrupted", "interrupted"],
        ["unavailable", "unavailable"],
        ["write-failed", "download"],
    ])("shows a %s failure on the card as %s", (failure, shown) => {
        const { room } = roomWithService();
        env.QUANTA_UI = false;
        Reflect.get(room, "addIncomingFileOffer").call(room, offer("application/pdf", 1000));

        Reflect.get(room, "applyFileTransferUpdate").call(room, {
            transferId: "transfer-1",
            state: "error",
            progress: 0,
            error: failure,
        });

        const [message] = get(room.messages);
        expect(get(message.attachment!.status)).toEqual({ state: "error", error: shown });
    });
});
