<script lang="ts">
    // quanta: a private conversation in the chat column (directMessages.ts): the class chat's own messages, so it
    // reads, copies, links, reacts, edits and deletes the same way.
    import { onDestroy, tick, untrack } from "svelte";
    import { get } from "svelte/store";
    import { IconPaperclip, IconPencil, IconX } from "@wa-icons";
    import { LL } from "../../i18n/i18n-svelte";
    import Message from "../Chat/Components/Room/Message.svelte";
    import { selectedChatMessageToEdit } from "../Chat/Stores/ChatStore";
    import type { ChatMessage } from "../Chat/Connection/ChatConnection";
    import { chatBodyFromText, chatTextFromBody } from "../../common/quanta/chatBody";
    import {
        directConversationsStore,
        directDrafts,
        directFailuresStore,
        directSendErrors,
        sendDirect,
        sendDirectFiles,
        takeDirectFailure,
    } from "./directMessages";
    import { fullNamesStore, shownName } from "./fullNames";
    import { QL } from "./i18n";
    import MentionPicker from "./MentionPicker.svelte";
    import { mentionMatches, mentionPeople, mentionQueryBefore, type MentionPerson } from "./mentions";

    /** As the class chat's timeline: a sender's messages within 5 minutes of each other read as one run. */
    const RUN_GAP_MS = 5 * 60 * 1000;

    let { peerId }: { peerId: string } = $props();

    let conversation = $derived($directConversationsStore.find((entry) => entry.peerId === peerId));
    let peerName = $derived(shownName($fullNamesStore, peerId, conversation?.name ?? ""));
    let draft = $state(untrack(() => directDrafts.get(peerId) ?? ""));
    let list: HTMLUListElement | undefined = $state();

    const senderOf = (message: ChatMessage | undefined) => message?.sender?.spaceUserId ?? message?.sender?.chatId;
    let items = $derived.by(() => {
        const out: { message: ChatMessage; showHeader: boolean; run: ChatMessage[] }[] = [];
        for (const message of conversation?.messages ?? []) {
            const previous = out.at(-1);
            const repeated =
                previous !== undefined &&
                senderOf(previous.message) === senderOf(message) &&
                (message.date?.getTime() ?? 0) - (previous.message.date?.getTime() ?? 0) < RUN_GAP_MS;
            const run = repeated ? previous.run : [];
            run.push(message);
            out.push({ message, showHeader: !repeated, run });
        }
        return out;
    });

    // The newest message in view, as in the class chat.
    $effect(() => {
        if (!conversation?.messages.length) return;
        tick()
            .then(() => list?.lastElementChild?.scrollIntoView({ block: "end" }))
            .catch(() => {});
    });

    // Editing one of our messages here, as the class chat's box does it: its text in the box, Enter saves, Escape leaves.
    // Followed by id: every update of the chat builds its messages anew.
    let editingId: string | null = $state(null);
    let editing = $derived(
        editingId === null ? null : (conversation?.messages.find((m) => m.id === editingId) ?? null),
    );
    let editFailed = $state(false);
    let sendError: string | undefined = $state();
    let draftBeforeEdit = "";
    let box: HTMLTextAreaElement | undefined = $state();
    // A save answered late (held back by the server's limit) belongs to the edit it was made for, not to one begun since.
    let editAttempt = 0;

    function stopEditing(): void {
        editAttempt++;
        if (editingId === null) return;
        editingId = null;
        draft = draftBeforeEdit;
        draftBeforeEdit = "";
    }

    const unsubscribeEdit = selectedChatMessageToEdit.subscribe((toEdit) => {
        if (toEdit && untrack(() => conversation?.messages.some((message) => message.id === toEdit.id))) {
            if (untrack(() => editingId) === toEdit.id) return;
            if (untrack(() => editingId) === null) draftBeforeEdit = untrack(() => draft);
            editAttempt++;
            editingId = toEdit.id;
            editFailed = false;
            draft = chatTextFromBody(get(toEdit.content).body);
            tick()
                .then(() => box?.focus())
                .catch(() => {});
        } else if (!toEdit) stopEditing();
    });
    // The message being edited was deleted (by its sender elsewhere, or a teacher): the edit ends, the draft comes back.
    $effect(() => {
        if (editingId !== null && !editing) untrack(() => selectedChatMessageToEdit.set(null));
    });
    onDestroy(() => {
        unsubscribeEdit();
        editAttempt++;
        directDrafts.set(shownPeer, editingId !== null ? draftBeforeEdit : draft);
        if (sendError) directSendErrors.set(shownPeer, sendError);
        else directSendErrors.delete(shownPeer);
        // An edit begun here doesn't follow the person to another chat.
        if (editingId !== null) selectedChatMessageToEdit.set(null);
    });

    let shownPeer = untrack(() => peerId);
    sendError = directSendErrors.get(shownPeer);
    directSendErrors.delete(shownPeer);
    $effect(() => {
        const next = peerId;
        untrack(() => {
            if (next === shownPeer) return;
            if (editingId !== null) {
                selectedChatMessageToEdit.set(null);
                stopEditing();
            }
            directDrafts.set(shownPeer, draft);
            if (sendError) directSendErrors.set(shownPeer, sendError);
            draft = directDrafts.get(next) ?? "";
            sendError = directSendErrors.get(next);
            directSendErrors.delete(next);
            shownPeer = next;
        });
    });

    // Pictures and PDFs, from the paperclip or pasted: kept on Quanta and sent one message each.
    let fileInput: HTMLInputElement | undefined = $state();
    let sendingFiles = $state(false);
    function sendFiles(files: FileList | File[] | null | undefined): void {
        const picked = [...(files ?? [])];
        if (picked.length === 0 || sendingFiles) return;
        sendingFiles = true;
        sendError = undefined;
        sendDirectFiles(peerId, picked)
            .then((refused) => {
                if (refused) sendError = refused;
            })
            .finally(() => (sendingFiles = false));
    }
    function onpaste(event: ClipboardEvent): void {
        const files = [...(event.clipboardData?.files ?? [])];
        if (files.length === 0) return;
        event.preventDefault();
        sendFiles(files);
    }

    function send(): void {
        // What is in the box while editing is an edit, never a new message (even if the message just went away).
        if (editingId !== null) {
            if (!editing || !draft.trim()) return;
            const attempt = ++editAttempt;
            editing
                .edit(chatBodyFromText(draft))
                .then(() => {
                    if (attempt === editAttempt) selectedChatMessageToEdit.set(null);
                })
                .catch(() => {
                    if (attempt === editAttempt) editFailed = true;
                });
            return;
        }
        if (!sendDirect(peerId, draft)) return;
        draft = "";
        sendError = undefined;
    }

    // A message refused for this conversation (now, or while it wasn't shown) comes back with why, ahead of anything
    // typed since; an edit begun meanwhile keeps its own text, and the refused one waits for the box after it.
    $effect(() => {
        if (!$directFailuresStore.has(peerId)) return;
        untrack(() => {
            const failure = takeDirectFailure(peerId);
            if (!failure) return;
            const restore = (typed: string) => (typed ? `${failure.text}\n${typed}` : failure.text);
            if (editingId !== null) draftBeforeEdit = restore(draftBeforeEdit);
            else draft = restore(draft);
            sendError = failure.reason;
        });
    });

    // "@" names the other person (mentions.ts): in a direct message nobody else reads it.
    let mention = $state<{ people: MentionPerson[]; active: number; start: number; end: number }>();
    let mentionDismissedAt: number | undefined;
    const mentionListId = `direct-mention-${Math.random().toString(36).slice(2)}`;

    function updateMention(): void {
        mention = undefined;
        if (!box || box.selectionStart !== box.selectionEnd) return;
        const end = box.selectionStart;
        const query = mentionQueryBefore(box.value.slice(0, end));
        if (query === undefined) return;
        const start = end - query.length - 1;
        if (mentionDismissedAt === start) return;
        const people = mentionMatches(mentionPeople(peerId), query);
        if (people.length) mention = { people, active: 0, start, end };
    }

    function pickMention(person: MentionPerson): void {
        const target = mention;
        mention = undefined;
        if (!target) return;
        const inserted = `@${person.shown} `;
        draft = draft.slice(0, target.start) + inserted + draft.slice(target.end);
        const caret = target.start + inserted.length;
        tick()
            .then(() => {
                box?.focus();
                box?.setSelectionRange(caret, caret);
            })
            .catch(() => {});
    }

    function mentionKey(event: KeyboardEvent): boolean {
        if (!mention) return false;
        if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            mention = undefined;
            return false;
        }
        const count = mention.people.length;
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            mention.active = (mention.active + (event.key === "ArrowDown" ? 1 : count - 1)) % count;
            return true;
        }
        if ((event.key === "Enter" && !event.shiftKey && !event.isComposing) || event.key === "Tab") {
            event.preventDefault();
            pickMention(mention.people[mention.active]);
            return true;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            mentionDismissedAt = mention.start;
            mention = undefined;
            return true;
        }
        return false;
    }

    function onkeydown(event: KeyboardEvent): void {
        if (mentionKey(event)) return;
        if (editingId !== null && event.key === "Escape") {
            event.preventDefault();
            selectedChatMessageToEdit.set(null);
            return;
        }
        if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            send();
        }
    }
</script>

<div class="direct">
    {#if conversation && conversation.messages.length > 0}
        <ul bind:this={list} class="flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-0 m-0 pt-2">
            {#each items as item (item.message.id)}
                <li class="last:pb-3">
                    <Message message={item.message} showHeader={item.showHeader} run={item.run} />
                </li>
            {/each}
        </ul>
    {:else}
        <p class="empty">{$QL.directEmpty({ name: peerName })}</p>
    {/if}
    {#if sendError}
        <p class="send-error" role="alert">{sendError}</p>
    {/if}
    {#if editing}
        <div class="quanta-edit-strip" class:failed={editFailed} data-testid="editStrip">
            <IconPencil font-size={16} />
            <div class="quanta-edit-strip-text">
                <span>{editFailed ? $LL.chat.messageEditedError() : $QL.editingMessage()}</span>
                <span>{chatTextFromBody(get(editing.content).body).replace(/\n/g, " ")}</span>
            </div>
            <button
                type="button"
                aria-label={$LL.chat.createRoom.buttons.cancel()}
                title={$LL.chat.createRoom.buttons.cancel()}
                onclick={() => selectedChatMessageToEdit.set(null)}><IconX font-size={16} /></button
            >
        </div>
    {/if}
    <form
        onsubmit={(event) => {
            event.preventDefault();
            send();
        }}
    >
        {#if mention}
            <MentionPicker people={mention.people} active={mention.active} id={mentionListId} onpick={pickMention} />
        {/if}
        <textarea
            bind:this={box}
            rows="1"
            bind:value={draft}
            {onkeydown}
            oninput={updateMention}
            onblur={() => (mention = undefined)}
            aria-controls={mention ? mentionListId : undefined}
            aria-activedescendant={mention ? `${mentionListId}-${mention.active}` : undefined}
            maxlength="2000"
            placeholder={$QL.messageTo({ name: peerName })}
            aria-label={$QL.messageTo({ name: peerName })}
            data-testid="directMessageInput"
            {onpaste}
        ></textarea>
        <input
            bind:this={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,application/pdf"
            multiple
            hidden
            data-testid="directFileInput"
            onchange={(event) => {
                sendFiles(event.currentTarget.files);
                event.currentTarget.value = "";
            }}
        />
        <button
            type="button"
            class="attach"
            disabled={sendingFiles}
            aria-label={$QL.attachFile()}
            title={$QL.attachFile()}
            data-testid="directAttachButton"
            onclick={() => fileInput?.click()}><IconPaperclip font-size={20} /></button
        >
    </form>
</div>

<style>
    .direct {
        display: flex;
        flex: 1;
        flex-direction: column;
        min-height: 0;
    }

    .send-error {
        flex: none;
        margin: 0 16px;
        font-size: 13px;
        color: #f2a9a9;
    }

    .empty {
        flex: 1;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        margin: 0;
        padding: 0 24px 16px;
        font-size: 13px;
        color: #8b919b;
        text-align: center;
    }

    form {
        position: relative;
        flex: none;
        margin: 8px 12px 12px;
    }

    textarea {
        display: block;
        width: 100%;
        min-height: 44px;
        max-height: 144px;
        padding: 12px 48px 12px 14px;
        border: 0;
        border-radius: 14px;
        background: #2b3038;
        font: inherit;
        font-size: 14px;
        line-height: 20px;
        color: #eceef1;
        resize: none;
        field-sizing: content;
    }

    /* Inside the box's right end, on its first line: the class chat's attach, as one quiet button. */
    .attach {
        position: absolute;
        right: 4px;
        bottom: 4px;
        display: grid;
        place-items: center;
        width: 36px;
        height: 36px;
        border: 0;
        border-radius: 10px;
        background: transparent;
        color: #a7adb7;
        cursor: pointer;
    }

    .attach:hover {
        background: rgb(255 255 255 / 0.08);
        color: #eceef1;
    }

    .attach:disabled {
        opacity: 0.5;
        cursor: default;
    }

    textarea::placeholder {
        color: #a7adb7;
    }

    /* Like the class chat's box: no ring, a faint edge. */
    textarea:focus-visible {
        outline: none;
        box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.14);
    }
</style>
