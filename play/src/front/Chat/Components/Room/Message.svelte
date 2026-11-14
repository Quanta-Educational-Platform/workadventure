<script lang="ts">
    import { tick } from "svelte";
    import { derived, get, readable } from "svelte/store";
    import type { Readable } from "svelte/store";
    import type {
        ChatMessage,
        ChatMessageType,
        ChatRoomMember,
        ChatThreadSummary,
        RoomChatReaction,
    } from "../../Connection/ChatConnection";
    import type { WorkAdventureComponent } from "../../../../types/component";
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import { fullNamesStore } from "../../../quanta/fullNames";
    import AvatarBox from "../../../Components/UI/Avatar.svelte";
    import Avatar from "../Avatar.svelte";

    import { resolveChatUserColor } from "../../Connection/Matrix/services/WaMatrixProfileService";
    import { getMatrixClientForChatTint } from "../../Utils";
    import { selectedChatMessageToEdit, selectedChatMessageToReply } from "../../Stores/ChatStore";
    import { selectedRoomStore } from "../../Stores/SelectRoomStore";
    import { isThreadPanelEnabledStore, selectedThreadStore } from "../../Stores/SelectedThreadStore";
    import { roomSidePanelStore } from "../../Stores/RoomSidePanelStore";
    import { REACTION_MARKERS } from "../../../../common/quanta/RoomSession";
    import { QUANTA_UI } from "../../../Enum/EnvironmentVariable";
    import { QL } from "../../../quanta/i18n";
    import { nameTag } from "../../../quanta/nameTag";
    import { goTo } from "../../../quanta/goTo";
    import { userIsAdminStore } from "../../../Stores/GameStore";
    import EmojiButton from "./EmojiButton.svelte";
    import MessageOptions from "./MessageOptions.svelte";
    import MessageImage from "./Message/MessageImage.svelte";
    import MessageText from "./Message/MessageText.svelte";
    import MessageFile from "./Message/MessageFile.svelte";
    import MessageAudioFile from "./Message/MessageAudioFile.svelte";
    import MessageVideoFile from "./Message/MessageVideoFile.svelte";
    import MessageAttachmentRecipients from "./Message/MessageAttachmentRecipients.svelte";
    import MessageEdition from "./MessageEdition.svelte";
    import MessageReactions from "./MessageReactions.svelte";
    import MessageIncoming from "./Message/MessageIncoming.svelte";
    import MessageOutcoming from "./Message/MessageOutcoming.svelte";
    import Message from "./Message.svelte";
    import ThreadSummary from "./ThreadSummary.svelte";
    import {
        IconCheck,
        IconCopy,
        IconDots,
        IconPencil,
        IconPin,
        IconPinnedOff,
        IconTrash,
        IconWalk,
    } from "@wa-icons";

    interface Props {
        message: ChatMessage;
        replyDepth?: number;
        showHeader?: boolean;
        /** Matrix rooms: member avatars follow Matrix profile (same pipeline as DM row / room list). */
        membersForMessageAvatars?: Readable<readonly ChatRoomMember[]>;
        /** Root message reply preview; hide inside an open thread timeline (main room only). */
        showThreadSummary?: boolean;
        /** quanta: the messages its sender sent in a row, this one among them (RoomTimeline). */
        run?: ChatMessage[];
    }

    let {
        message,
        replyDepth = 0,
        showHeader = true,
        membersForMessageAvatars = undefined,
        showThreadSummary = true,
        run = undefined,
    }: Props = $props();

    let messageRef: HTMLDivElement | undefined = $state();

    let {
        id,
        sender,
        isMyMessage,
        date,
        content,
        quotedMessage,
        isQuotedMessage,
        type,
        isDeleted,
        canDelete,
        canEdit,
        canReact,
        isModified,
        reactions,
    } = $derived(message);

    let messageFromSystem = $derived(type === "incoming" || type === "outcoming");

    // quanta: a teacher's marks name who dealt with something; the rest are a count, with the names on hover.
    const REACTION_NAMES_SHOWN = 3;
    const REACTION_TOOLTIP_NAMES = 20;
    let roomReactions = $derived(message.roomReactions);
    function reactionNames(people: readonly { uuid: string; name: string }[]): string[] {
        return people.map((person) => nameTag($fullNamesStore.get(person.uuid) ?? person.name));
    }
    function react(emoji: string): void {
        message.addReaction(emoji).catch((error) => console.error(error));
    }

    // Students ask for help in the chat: a teacher goes to them from the message, and marks who dealt with it.
    const [ON_THE_WAY, DONE] = REACTION_MARKERS;
    let helpActions = $derived(
        $userIsAdminStore && !isMyMessage && !!message.sender?.uuid && message.type === "proximity" && !!roomReactions,
    );
    let markedDone = $derived(!!$roomReactions?.some((reaction) => reaction.emoji === DONE));
    let emojiReactions = $derived(($roomReactions ?? []).filter((reaction) => !REACTION_MARKERS.includes(reaction.emoji)));
    // Dealt with supersedes on the way.
    function currentMark(reactions: readonly RoomChatReaction[] | undefined): RoomChatReaction | undefined {
        return (
            reactions?.find((reaction) => reaction.emoji === DONE) ??
            reactions?.find((reaction) => reaction.emoji === ON_THE_WAY)
        );
    }
    let ownMark = $derived(currentMark($roomReactions));
    // The next message in the run says the same: the line goes under it instead.
    let statusMark = $derived.by(() => {
        const next = currentMark($nextReactions);
        const same =
            !!ownMark &&
            !!next &&
            next.emoji === ownMark.emoji &&
            next.people.map((p) => p.uuid).join() === ownMark.people.map((p) => p.uuid).join();
        return same ? undefined : ownMark;
    });
    // A request is what someone wrote in a row: a teacher's mark covers all of it, and shows once, under the last.
    function hasMark(target: ChatMessage, emoji: string): boolean {
        return !!target.roomReactions && get(target.roomReactions).some((r) => r.emoji === emoji && r.mine);
    }
    function mark(emoji: string, on = !hasMark(message, emoji)): void {
        const targets = run && run.includes(message) ? run : [message];
        for (const target of targets) {
            if (!target.roomReactions || hasMark(target, emoji) === on) continue;
            target.addReaction(emoji).catch((error) => console.error(error));
        }
    }
    let nextInRun = $derived(run ? run[run.indexOf(message) + 1] : undefined);
    const noReactions = readable<RoomChatReaction[]>([]);
    let nextReactions = $derived(nextInRun?.roomReactions ?? noReactions);
    function goToSender(): void {
        if (message.sender?.uuid) goTo({ uuid: message.sender.uuid });
        mark(ON_THE_WAY, true);
    }

    // quanta: someone else's message (staff moderating) is deleted only once confirmed; our own goes at once.
    // quanta: a message's text to the clipboard as read (line breaks and entities as text): selecting it is fiddly on
    // a phone.
    let copied = $state(false);
    function copyMessage(): void {
        const html = get(message.content).body.replace(/<br\s*\/?>/gi, "\n");
        const text = new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";
        navigator.clipboard
            .writeText(text)
            .then(() => {
                copied = true;
                setTimeout(() => (copied = false), 1500);
            })
            .catch((error: unknown) => console.error(error));
    }

    // quanta: staff pin a class message at the top of the chat (quanta/pinnedMessages.ts).
    const cannotPin = readable(false);
    let canPin = $derived("canPin" in message ? (message.canPin as Readable<boolean>) : cannotPin);
    let isPinned = $derived("isPinned" in message ? (message.isPinned as Readable<boolean>) : cannotPin);
    function togglePin(): void {
        if ("onPin" in message && typeof message.onPin === "function") message.onPin(!get(isPinned));
    }

    // quanta: the actions float just above the bubble where that space is free; in a narrow column it often holds the
    // message before or this one's name and time. Then beside the bubble, on its free side. Where neither has room the
    // bar folds into one "more" button beside the bubble (the row keeps a gutter for it), and opens below the message,
    // or above it where the list ends: never over the message it belongs to. The quick reaction row opens the same way
    // unless it fits where the bar is. Measured from the bubble, not the column, whose top is the name and time when the
    // message has them.
    let actionsRef: HTMLDivElement | undefined = $state();
    let actionsAt: { top: number; right: number } | undefined = $state();
    let actionsFolded = $state(false);
    let actionsMenuOpen = $state(false);
    let reactRowOpen = $state(false);
    const ACTIONS_GAP_PX = 2;
    const ACTIONS_INSET_PX = 4;
    function actionsGeometry() {
        const column = actionsRef?.parentElement;
        const bubble = column?.querySelector(":scope > .message");
        const item = messageRef?.closest("li");
        if (!actionsRef || !column || !bubble || !messageRef || !item) return undefined;
        let scroller = item.parentElement;
        while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
        return {
            bubble: bubble.getBoundingClientRect(),
            column: column.getBoundingClientRect(),
            item: item.getBoundingClientRect(),
            message: messageRef.getBoundingClientRect(),
            header: [...messageRef.querySelectorAll("div.h-fit > span")]
                .map((element) => element.getBoundingClientRect())
                .filter((rect) => rect.width > 0),
            scroller: scroller?.getBoundingClientRect(),
            // The message before, and this one's name and time.
            above: [
                ...(item.previousElementSibling?.querySelectorAll(".message, .quanta-chat-reactions, .quanta-chat-status") ??
                    []),
                ...messageRef.querySelectorAll("div.h-fit > span"),
            ].map((element) => element.getBoundingClientRect()),
        };
    }
    type Geometry = NonNullable<ReturnType<typeof actionsGeometry>>;
    /** A box at `top`, its right edge at `right` (page coordinates), clear of the message before and inside the list. */
    function clearAbove(g: Geometry, top: number, right: number, width: number, height: number): boolean {
        const hits = (rect: DOMRect) =>
            rect.width > 0 &&
            rect.bottom > top &&
            rect.top < top + height &&
            rect.right > right - width &&
            rect.left < right;
        return (
            !g.above.some(hits) &&
            !(g.scroller && top < g.scroller.top) &&
            right - width >= g.item.left &&
            right <= g.item.right
        );
    }
    async function placeActions(): Promise<void> {
        if (actionsMenuOpen || reactRowOpen) return;
        actionsFolded = false;
        await tick();
        const g = actionsGeometry();
        if (!g || !actionsRef) return;
        const width = actionsRef.offsetWidth;
        const height = actionsRef.offsetHeight;
        const fromTop = (y: number) => y - g.column.top;
        const top = g.bubble.top - height - ACTIONS_GAP_PX;
        // Above the bubble at its end, else above it beside this message's name and time (own: time on the right).
        const headerLeft = Math.min(...g.header.map((rect) => rect.left));
        const headerRight = Math.max(...g.header.map((rect) => rect.right));
        const besideHeader = isMyMessage ? headerLeft - 2 * ACTIONS_INSET_PX : headerRight + 2 * ACTIONS_INSET_PX + width;
        if (clearAbove(g, top, g.bubble.right, width, height))
            actionsAt = { top: fromTop(top), right: g.column.right - g.bubble.right };
        else if (g.header.length > 0 && clearAbove(g, top, besideHeader, width, height))
            actionsAt = { top: fromTop(top), right: g.column.right - besideHeader };
        else if (isMyMessage && g.bubble.left - g.item.left >= width + 2 * ACTIONS_INSET_PX)
            actionsAt = { top: fromTop(g.bubble.top), right: g.column.right - g.bubble.left + ACTIONS_INSET_PX };
        else if (!isMyMessage && g.item.right - g.bubble.right >= width + 2 * ACTIONS_INSET_PX)
            actionsAt = {
                top: fromTop(g.bubble.top),
                right: g.column.right - g.bubble.right - width - ACTIONS_INSET_PX,
            };
        else {
            actionsFolded = true;
            await tick();
            const folded = actionsRef.offsetWidth;
            // In the row's gutter beside the bubble, inside the list.
            const right = isMyMessage
                ? Math.max(g.bubble.left - ACTIONS_GAP_PX, g.item.left + folded)
                : Math.min(g.bubble.right + ACTIONS_GAP_PX + folded, g.item.right);
            actionsAt = { top: fromTop(g.bubble.bottom - actionsRef.offsetHeight), right: g.column.right - right };
        }
    }
    /** An open menu (the folded bar, the quick reactions): below the whole message, else above it. */
    async function placeMenu(): Promise<void> {
        await tick();
        const g = actionsGeometry();
        if (!g || !actionsRef) return;
        const row = actionsRef.querySelector<HTMLElement>(".quanta-react-row");
        const width = Math.max(actionsRef.offsetWidth, row?.offsetWidth ?? 0);
        const height = Math.max(actionsRef.offsetHeight, row?.offsetHeight ?? 0);
        // The reaction row from a bar already in the clear stays there when it fits too.
        if (row && !actionsFolded && actionsAt) {
            const barRect = actionsRef.getBoundingClientRect();
            if (barRect.bottom <= g.bubble.top && clearAbove(g, barRect.top, barRect.right, width, height)) return;
        }
        const bottom = g.scroller?.bottom ?? Infinity;
        const top = g.scroller?.top ?? -Infinity;
        let right = Math.min(g.bubble.right, g.item.right - ACTIONS_INSET_PX);
        right = Math.max(right, g.item.left + ACTIONS_INSET_PX + width);
        // Below the message, else above it: inside the list, and never over anyone's name and time; failing both,
        // the one inside the list.
        const names = [...(messageRef?.closest("ul")?.querySelectorAll("#message div.h-fit > span") ?? [])]
            .map((element) => element.getBoundingClientRect())
            .filter((rect) => rect.width > 0);
        const coversName = (y: number) =>
            names.some((rect) => rect.bottom > y && rect.top < y + height && rect.right > right - width && rect.left < right);
        const candidates = [g.message.bottom + ACTIONS_GAP_PX, g.message.top - height - ACTIONS_GAP_PX].filter(
            (y) => y >= top && y + height <= bottom,
        );
        const y =
            candidates.find((candidate) => !coversName(candidate)) ?? candidates[0] ?? Math.max(top, bottom - height);
        actionsAt = { top: y - g.column.top, right: g.column.right - right };
    }
    function placeActionsNow(): void {
        placeActions().catch((error: unknown) => console.error(error));
    }
    function toggleActionsMenu(): void {
        actionsMenuOpen = !actionsMenuOpen;
        if (actionsMenuOpen) placeMenu().catch((error: unknown) => console.error(error));
        else placeActions().catch((error: unknown) => console.error(error));
    }
    function closeActionsMenu(): void {
        if (!actionsMenuOpen) return;
        actionsMenuOpen = false;
        placeActions().catch((error: unknown) => console.error(error));
    }
    // A click elsewhere closes the open menu; listened for only while it is open, not by every message in the chat.
    $effect(() => {
        if (!actionsMenuOpen) return;
        const outside = (event: PointerEvent) => {
            if (actionsRef && event.target instanceof Node && !actionsRef.contains(event.target)) closeActionsMenu();
        };
        document.addEventListener("pointerdown", outside, true);
        return () => document.removeEventListener("pointerdown", outside, true);
    });
    function onReactRow(open: boolean): void {
        if (open === reactRowOpen) return;
        reactRowOpen = open;
        if (open) placeMenu().catch((error: unknown) => console.error(error));
        else if (actionsMenuOpen) actionsMenuOpen = false;
    }
    function onActionsClick(event: MouseEvent): void {
        // A folded bar closes once an action is taken; the reaction button opens its row in the menu's place.
        const button = (event.target as Element | null)?.closest("button");
        if (!actionsMenuOpen || !button || button.classList.contains("quanta-chat-more")) return;
        if (button.dataset.testid === "openEmojiPickerButton") return;
        closeActionsMenu();
    }

    let confirmingDelete = $state(false);
    function deleteMessage(): void {
        if (isMyMessage) message.remove();
        else confirmingDelete = true;
    }
    function focusOnMount(node: HTMLElement): void {
        node.focus();
    }

    const messageType: { [key in ChatMessageType]: WorkAdventureComponent } = {
        image: MessageImage,
        text: MessageText,
        file: MessageFile,
        audio: MessageAudioFile,
        video: MessageVideoFile,
        incoming: MessageIncoming,
        outcoming: MessageOutcoming,
        proximity: MessageText,
    };

    let reactionsWithUsers = $derived(
        derived(
            [reactions, ...Array.from(reactions.values()).map((reaction) => reaction.users)],
            ([$reactions, ...$users]) => {
                return Array.from($reactions.values()).filter((reaction) => reaction.users.size > 0);
            },
        ),
    );
    const emptyThreadSummary = readable<ChatThreadSummary | null>(null);

    let messageSenderAvatarColor = $derived(
        resolveChatUserColor(message.sender?.chatId ?? "", message.sender?.color, getMatrixClientForChatTint()),
    );

    let roomMembersList = $derived(membersForMessageAvatars ? $membersForMessageAvatars : undefined);
    let memberForSender = $derived(
        roomMembersList && message.sender?.chatId
            ? roomMembersList.find((m) => m.id === message.sender!.chatId)
            : undefined,
    );
    let messageAvatarPictureStore = $derived(memberForSender?.pictureStore ?? message.sender?.pictureStore);
    let senderName = $derived($fullNamesStore.get(message.sender?.uuid ?? "") ?? message.sender?.username);
    let waParensStore = $derived(memberForSender?.waDisplayNameIfDifferent);
    let waDisplayNameParens = $derived($waParensStore ? $waParensStore : undefined);
    let threadSummary = $derived(message.threadSummary ?? emptyThreadSummary);
    let hasThreadSummary = $derived(
        showThreadSummary && replyDepth === 0 && !isQuotedMessage && !!$threadSummary && $threadSummary.replyCount > 0,
    );

    async function openThread() {
        const thread = await message.openThread?.();
        if (!thread) {
            return;
        }

        selectedChatMessageToReply.set(null);

        if ($isThreadPanelEnabledStore) {
            selectedRoomStore.set(thread.parentRoom);
            roomSidePanelStore.open("threads");
            selectedThreadStore.set(thread);
            return;
        }

        selectedThreadStore.clear();
        selectedRoomStore.set(thread);
    }
</script>

<div
    id="message"
    tabindex="-1"
    class={`${isMyMessage && "self-end flex-row-reverse relative"} ${
        messageFromSystem && "justify-center"
    } select-text block-user-action messageContainer items-center`}
    bind:this={messageRef}
    onpointerenter={QUANTA_UI ? placeActionsNow : undefined}
    onfocusin={QUANTA_UI ? placeActionsNow : undefined}
>
    <div
        style={replyDepth === 0 ? "max-width: calc( 100% - 50px );" : "padding-left: 0"}
        class="flex gap-2 justify-start overflow-visible relative {replyDepth === 0
            ? 'max-w-[calc(100% - 100px)]'
            : ''} {!$isDeleted ? 'group-hover/message:pb-4' : ''} {isMyMessage
            ? 'justify-end grid-container-inverted pr-4'
            : 'justify-start pl-3'}"
    >
        {#if (!isMyMessage || isQuotedMessage) && sender !== undefined && replyDepth === 0 && showHeader}
            <AvatarBox class="overflow-hidden mt-4 shrink-0">
                <Avatar
                    compact
                    pictureStore={messageAvatarPictureStore}
                    fallbackName={senderName}
                    color={messageSenderAvatarColor}
                />
            </AvatarBox>
        {/if}

        <!-- Without a header, the avatar is left out: keep its column so the bubble lines up with the one above.
             Our own messages never show an avatar, so they have no column to keep. -->
        <div
            class="flex flex-col justify-end max-w-full {replyDepth === 0 &&
            !showHeader &&
            (!isMyMessage || isQuotedMessage)
                ? 'ml-12'
                : ''}"
        >
            {#if replyDepth <= 0 && showHeader}
                <div
                    class="w-full h-fit text-xs px-2 flex justify-between items-end gap-2 overflow-x-hidden"
                    class:flex-row-reverse={isMyMessage}
                    hidden={isQuotedMessage || messageFromSystem}
                >
                    <span
                        hidden={messageFromSystem}
                        class="text-nowrap text-sm font-bold {!isMyMessage ? 'text-white' : 'text-white/75'}"
                        >{isMyMessage ? $LL.chat.you() : senderName}{#if waDisplayNameParens}<span
                                class="text-xs font-normal opacity-75 ml-0.5">({waDisplayNameParens})</span
                            >{/if}</span
                    >
                    <span class={`text-xs font-condensed text-nowrap opacity-75 ${isMyMessage ? "mr-1" : "ml-1"}`}
                        >{date?.toLocaleTimeString($locale, {
                            hour: "2-digit",
                            minute: "2-digit",
                        })}</span
                    >
                </div>
            {/if}
            <div
                class:quanta-message-done={markedDone}
                class:quanta-message-editing={QUANTA_UI && $selectedChatMessageToEdit?.id === id}
                class="message rounded-md
                    {$isDeleted && !isMyMessage && !messageFromSystem && replyDepth === 0 ? 'bg-white/10' : ''}
                    {$isDeleted && isMyMessage && !messageFromSystem && replyDepth === 0 ? 'bg-white/10' : ''}
                    {!isMyMessage && !messageFromSystem && !$isDeleted && replyDepth === 0
                    ? 'bg-contrast/90 rounded-bl-none'
                    : ''}
                    {isMyMessage && !messageFromSystem && !$isDeleted && replyDepth === 0
                    ? 'bg-secondary/90 rounded-br-none'
                    : ''}
                    {$reactionsWithUsers.length > 0 && !$isDeleted && replyDepth === 0 ? 'mb-4 p-0.5' : ''}
                    {!isQuotedMessage ? 'my' : ''}"
            >
                {#if $isDeleted}
                    <p class="py-2 px-2 m-0 text-xs flex items-center italic gap-2 opacity-50">
                        <IconTrash font-size={12} />
                        {$LL.chat.messageDeleted()}
                    </p>
                {:else if !QUANTA_UI && $selectedChatMessageToEdit !== null && $selectedChatMessageToEdit.id === id}
                    <MessageEdition message={$selectedChatMessageToEdit} />
                {:else}
                    {#if replyDepth > 0}
                        <div class="px-2 pt-1 text-xxs font-bold">
                            {isMyMessage ? $LL.chat.you() : senderName}{#if waDisplayNameParens}<span
                                    class="text-xxs font-normal opacity-75 ml-0.5">({waDisplayNameParens})</span
                                >{/if}
                        </div>
                    {/if}

                    {@const MessageComponent = messageType[type]}
                    <MessageComponent {content} {message} />
                    {#if message.attachment?.delivery}
                        <MessageAttachmentRecipients recipients={message.attachment.delivery} />
                    {/if}

                    {#if $reactionsWithUsers.length > 0}
                        <MessageReactions
                            classes={isMyMessage ? "bg-secondary/30 right-2" : "bg-contrast/30"}
                            reactions={$reactionsWithUsers}
                        />
                    {/if}
                    {#if $isModified}
                        <div class="quanta-chat-edited text-white/50 text-xxs p-0 m-0 px-2 pb-1 text-right">
                            ({QUANTA_UI ? $QL.messageEdited() : $LL.chat.messageEdited()})
                        </div>
                    {/if}
                {/if}

                {#if quotedMessage && replyDepth < 1 && !$isDeleted}
                    <div class="p-1 opacity-80">
                        <div class="response bg-white/10 rounded">
                            <Message replyDepth={replyDepth + 1} message={quotedMessage} {membersForMessageAvatars} />
                        </div>
                    </div>
                {/if}
            </div>
            {#if !isQuotedMessage && !$isDeleted && message.type !== "proximity" && message.type !== "incoming" && message.type !== "outcoming" && ($selectedChatMessageToEdit === null || $selectedChatMessageToEdit.id !== id)}
                <div
                    class="options -top-2 absolute z-50 rounded p-1 {!isMyMessage
                        ? 'right-2 bg-contrast/80'
                        : 'right-6 bg-contrast/80'}"
                >
                    <MessageOptions {message} {messageRef} onOpenThread={openThread} />
                </div>
            {/if}

            {#if emojiReactions.length > 0 && !$isDeleted && !isQuotedMessage}
                <div class="quanta-chat-reactions" data-testid="roomReactions">
                    {#each emojiReactions as reaction (reaction.emoji)}
                        {@const names = reactionNames(reaction.people)}
                        <button
                            type="button"
                            class="quanta-chat-reaction"
                            class:mine={reaction.mine}
                            disabled={!$canReact}
                            aria-pressed={reaction.mine}
                            title={names.slice(0, REACTION_TOOLTIP_NAMES).join(", ") +
                                (names.length > REACTION_TOOLTIP_NAMES
                                    ? ` +${names.length - REACTION_TOOLTIP_NAMES}`
                                    : "")}
                            onclick={() => react(reaction.emoji)}
                        >
                            <span>{reaction.emoji}</span>
                            <span>{names.length}</span>
                        </button>
                    {/each}
                </div>
            {/if}

            {#if statusMark && !$isDeleted && !isQuotedMessage}
                {@const names = reactionNames(statusMark.people)}
                {@const shown =
                    names.slice(0, REACTION_NAMES_SHOWN).join(", ") +
                    (names.length > REACTION_NAMES_SHOWN ? `\u00a0+${names.length - REACTION_NAMES_SHOWN}` : "")}
                {@const done = statusMark.emoji === DONE}
                <!-- quanta: a teacher's mark is the request's state, one quiet line, not a reaction. -->
                <button
                    type="button"
                    class="quanta-chat-status"
                    class:done
                    data-testid="roomRequestStatus"
                    disabled={!$canReact || (!$userIsAdminStore && !statusMark.mine)}
                    aria-pressed={statusMark.mine}
                    aria-label={done
                        ? $QL.chatDealtWith({ names: names.join(", ") })
                        : $QL.chatOnTheWay({ names: names.join(", ") })}
                    title={done
                        ? $QL.chatDealtWith({ names: names.join(", ") })
                        : $QL.chatOnTheWay({ names: names.join(", ") })}
                    onclick={() => statusMark && mark(statusMark.emoji)}
                >
                    {#if done}<IconCheck font-size={13} />{:else}<IconWalk font-size={13} />{/if}
                    <span>{shown}</span>
                </button>
            {/if}

            {#if confirmingDelete && $canDelete && !$isDeleted && !isQuotedMessage}
                <div
                    class="quanta-chat-delete-confirm"
                    role="group"
                    aria-label={$QL.deleteMessageConfirm()}
                    data-testid="deleteMessageConfirm"
                    onkeydown={(event) => {
                        if (event.key !== "Escape") return;
                        event.stopPropagation();
                        confirmingDelete = false;
                    }}
                >
                    <p>{$QL.deleteMessageConfirm()}</p>
                    <div>
                        <button
                            data-testid="cancelDeleteMessageButton"
                            {@attach focusOnMount}
                            onclick={() => (confirmingDelete = false)}>{$QL.personCancel()}</button
                        >
                        <button
                            class="danger"
                            data-testid="confirmDeleteMessageButton"
                            onclick={() => {
                                confirmingDelete = false;
                                message.remove();
                            }}>{$QL.deleteMessage()}</button
                        >
                    </div>
                </div>
            {:else if message.type === "proximity" && !$isDeleted && !isQuotedMessage && ($selectedChatMessageToEdit === null || $selectedChatMessageToEdit.id !== id)}
                <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
                <div
                    class="quanta-chat-actions"
                    class:folded={actionsFolded && !actionsMenuOpen}
                    class:open={actionsMenuOpen || reactRowOpen}
                    style:top={actionsAt && `${actionsAt.top}px`}
                    style:right={actionsAt && `${actionsAt.right}px`}
                    bind:this={actionsRef}
                    onclick={onActionsClick}
                    onkeydown={(event) => {
                        if (event.key !== "Escape" || !actionsMenuOpen) return;
                        event.stopPropagation();
                        closeActionsMenu();
                    }}
                >
                    <button
                        class="quanta-chat-more"
                        aria-label={$QL.moreOptions()}
                        title={$QL.moreOptions()}
                        aria-expanded={actionsMenuOpen}
                        data-testid="messageActionsButton"
                        onclick={toggleActionsMenu}><IconDots font-size={16} /></button
                    >
                    <button
                        class="quanta-chat-copy"
                        aria-label={copied ? $QL.messageCopied() : $QL.copyMessage()}
                        title={copied ? $QL.messageCopied() : $QL.copyMessage()}
                        data-testid="copyMessageButton"
                        onclick={copyMessage}
                        >{#if copied}<IconCheck font-size={16} />{:else}<IconCopy font-size={16} />{/if}</button
                    >
                    {#if helpActions}
                        <button
                            class="quanta-chat-go"
                            aria-label={$QL.chatGoToSender()}
                            title={$QL.chatGoToSender()}
                            data-testid="goToSenderButton"
                            onclick={goToSender}><IconWalk font-size={16} /></button
                        >
                        <button
                            class="quanta-chat-done"
                            aria-label={$QL.chatMarkDone()}
                            title={$QL.chatMarkDone()}
                            aria-pressed={markedDone}
                            data-testid="markDoneButton"
                            onclick={() => mark(DONE)}><IconCheck font-size={16} /></button
                        >
                    {/if}
                    {#if $canReact && message.roomReactions}
                        <span class="quanta-chat-react" data-testid="reactToMessageButton">
                            <EmojiButton
                                onchange={react}
                                onopenchange={onReactRow}
                                {messageRef}
                                mine={$roomReactions
                                    ?.filter((reaction) => reaction.mine)
                                    .map((reaction) => reaction.emoji)}
                            />
                        </span>
                    {/if}
                    {#if $canPin}
                        <button
                            class="quanta-chat-pin"
                            aria-label={$isPinned ? $QL.unpinMessage() : $QL.pinMessage()}
                            title={$isPinned ? $QL.unpinMessage() : $QL.pinMessage()}
                            aria-pressed={$isPinned}
                            data-testid="pinMessageButton"
                            onclick={togglePin}
                            >{#if $isPinned}<IconPinnedOff font-size={16} />{:else}<IconPin font-size={16} />{/if}</button
                        >
                    {/if}
                    {#if $canEdit}
                        <button
                            class="quanta-chat-edit"
                            aria-label={$QL.editMessage()}
                            title={$QL.editMessage()}
                            data-testid="editMessageButton"
                            onclick={() => selectedChatMessageToEdit.set(message)}><IconPencil font-size={16} /></button
                        >
                    {/if}
                    {#if $canDelete}
                        <button
                            class="quanta-chat-delete"
                            aria-label={$LL.chat.delete()}
                            title={$LL.chat.delete()}
                            data-testid="deleteMessageButton"
                            onclick={deleteMessage}><IconTrash font-size={16} /></button
                        >
                    {/if}
                </div>
            {/if}

            {#if hasThreadSummary && $threadSummary}
                <ThreadSummary summary={$threadSummary} {openThread} />
            {/if}
        </div>
    </div>
</div>

<style>
    #message {
        display: flex;
        align-items: flex-start;
        position: relative;
    }

    #message:hover .options {
        display: flex;
        flex-direction: row;
        gap: 2px;
        transition-delay: 0.15s;
        opacity: 1;
    }

    .options {
        transition: all 0.2s ease-in-out;
        opacity: 0;
    }

    .message {
        min-width: 180px;
        overflow-wrap: anywhere;
        position: relative;
        transition: all 0.2s ease-in-out 0s;
    }

    .message.my:hover {
        transition-delay: 0.5s;
    }
    .avatar {
        display: flex;
        background: none;
    }
</style>
