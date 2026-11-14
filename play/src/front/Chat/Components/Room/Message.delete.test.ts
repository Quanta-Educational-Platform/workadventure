import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { readable, writable } from "svelte/store";
import { MapStore } from "@workadventure/store-utils";
import type { ChatMessage } from "../../Connection/ChatConnection";
import type * as EnvironmentVariable from "../../../Enum/EnvironmentVariable";
import Message from "./Message.svelte";

vi.mock("../../../Enum/EnvironmentVariable", async (original) => ({
    ...(await original<typeof EnvironmentVariable>()),
    QUANTA_UI: true,
}));
vi.mock("../../Stores/ChatStore", async () => {
    const { writable } = await import("svelte/store");
    return { selectedChatMessageToEdit: writable(null), selectedChatMessageToReply: writable(null) };
});
vi.mock("../../Stores/SelectRoomStore", async () => ({
    selectedRoomStore: (await import("svelte/store")).writable(undefined),
}));
vi.mock("../../Stores/SelectedThreadStore", async () => {
    const { writable } = await import("svelte/store");
    return { isThreadPanelEnabledStore: writable(false), selectedThreadStore: { ...writable(undefined), clear() {} } };
});
vi.mock("../../Stores/RoomSidePanelStore", () => ({ roomSidePanelStore: { open() {} } }));
vi.mock("../../Connection/Matrix/services/WaMatrixProfileService", () => ({ resolveChatUserColor: () => "#fff" }));
vi.mock("../../Utils", () => ({ getMatrixClientForChatTint: () => undefined }));
for (const child of [
    "./MessageOptions.svelte",
    "./Message/MessageImage.svelte",
    "./Message/MessageText.svelte",
    "./Message/MessageFile.svelte",
    "./Message/MessageAudioFile.svelte",
    "./Message/MessageVideoFile.svelte",
    "./Message/MessageAttachmentRecipients.svelte",
    "./MessageEdition.svelte",
    "./MessageReactions.svelte",
    "./Message/MessageIncoming.svelte",
    "./Message/MessageOutcoming.svelte",
    "./ThreadSummary.svelte",
    "../../../Components/UI/Avatar.svelte",
    "../Avatar.svelte",
]) {
    vi.doMock(child, () => ({ default: () => undefined }));
}

function chatMessage(isMyMessage: boolean) {
    const isDeleted = writable(false);
    const remove = vi.fn(() => isDeleted.set(true));
    const message = {
        id: "m1",
        sender: { chatId: "u1", username: "iryna.m", pictureStore: readable(undefined) },
        content: readable({ body: "hello" }),
        isMyMessage,
        isQuotedMessage: false,
        date: new Date(),
        quotedMessage: undefined,
        type: "proximity",
        reactions: new MapStore(),
        remove,
        edit: vi.fn(),
        isDeleted,
        isModified: readable(false),
        canEdit: readable(isMyMessage),
        addReaction: vi.fn(),
        canReact: readable(false),
        canDelete: readable(true),
    } as unknown as ChatMessage;
    return { message, remove };
}

let target: HTMLElement;
beforeEach(() => {
    target = document.createElement("div");
    document.body.appendChild(target);
});
afterEach(() => target.remove());

const button = (testId: string) => target.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);

describe("deleting a chat message", () => {
    it("asks before deleting someone else's message", () => {
        const { message, remove } = chatMessage(false);
        const component = mount(Message, { target, props: { message } });
        flushSync();
        button("deleteMessageButton")?.click();
        flushSync();
        expect(remove).not.toHaveBeenCalled();
        expect(target.querySelector('[data-testid="deleteMessageConfirm"]')?.textContent).toContain(
            "Delete this message?",
        );
        expect(document.activeElement).toBe(button("cancelDeleteMessageButton"));

        button("cancelDeleteMessageButton")?.click();
        flushSync();
        expect(target.querySelector('[data-testid="deleteMessageConfirm"]')).toBeNull();
        expect(remove).not.toHaveBeenCalled();

        button("deleteMessageButton")?.click();
        flushSync();
        target
            .querySelector('[data-testid="deleteMessageConfirm"]')
            ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        flushSync();
        expect(target.querySelector('[data-testid="deleteMessageConfirm"]')).toBeNull();

        button("deleteMessageButton")?.click();
        flushSync();
        button("confirmDeleteMessageButton")?.click();
        flushSync();
        expect(remove).toHaveBeenCalledOnce();
        expect(target.querySelector('[data-testid="deleteMessageConfirm"]')).toBeNull();
        unmount(component).catch(() => {});
    });

    it("deletes one's own message at once", () => {
        const { message, remove } = chatMessage(true);
        const component = mount(Message, { target, props: { message } });
        flushSync();
        button("deleteMessageButton")?.click();
        flushSync();
        expect(remove).toHaveBeenCalledOnce();
        expect(target.querySelector('[data-testid="deleteMessageConfirm"]')).toBeNull();
        unmount(component).catch(() => {});
    });
});
