<script module lang="ts">
    // Create interface for the property
    export interface ApplicationProperty {
        name: string;
        img: string;
        title: string;
        description: string;
        link: string;
        placeholder: string;
        regexUrl: string | undefined;
        targetEmbedableUrl: string | undefined;
    }
</script>

<script lang="ts">
    import { onDestroy, onMount, tick } from "svelte";
    import { get, readable } from "svelte/store";
    import { v4 as uuid } from "uuid";
    import type { EmojiClickEvent } from "emoji-picker-element/shared";
    import { defaultNativeIntegrationAppName } from "@workadventure/shared-utils";
    import {
        hasChatRoomPollCreation,
        hasProximityChatSidePanel,
        type ChatConversation,
        type ChatMessage,
    } from "../../Connection/ChatConnection";
    import { selectedChatMessageToEdit, selectedChatMessageToReply } from "../../Stores/ChatStore";
    import { roomSidePanelStore } from "../../Stores/RoomSidePanelStore";
    import { chatInputFocusStore } from "../../../Stores/ChatStore";
    import { warningMessageStore } from "../../../Stores/ErrorStore";
    import { PROXIMITY_FILE_TRANSFER_MAX_USERS, QUANTA_UI } from "../../../Enum/EnvironmentVariable";
    import { userIsAdminStore } from "../../../Stores/GameStore";
    import { isHandRaisedStore, requestedHandRaiseState } from "../../../Stores/RaiseHandStore";
    import { roomHandSpaceStore } from "../../../quanta/roomHand";
    import { isClassChat, tableChatStore } from "../../../quanta/chatAudience";
    import { QL } from "../../../quanta/i18n";
    import MentionPicker from "../../../quanta/MentionPicker.svelte";
    import {
        mentionMatches,
        mentionPeople,
        mentionQueryBefore,
        type MentionPerson,
    } from "../../../quanta/mentions";
    import { chatBodyFromInput, chatInputFromBody, isBlankChatBody } from "../../../../common/quanta/chatBody";
    import LL from "../../../../i18n/i18n-svelte";
    import { ProximityChatRoom } from "../../Connection/Proximity/ProximityChatRoom";
    import {
        PROXIMITY_FILE_TRANSFER_MAX_FILE_SIZE,
        PROXIMITY_FILE_TRANSFER_MAX_FILES,
        validateProximityFiles,
    } from "../../Connection/Proximity/ProximityFileTransferService";
    import { DEFAULT_PROXIMITY_SPACE_NAME } from "../../Connection/Proximity/ProximityChatRoomManager";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { localUserStore } from "../../../Connection/LocalUserStore";
    import { draftMessageService } from "../../Services/DraftMessageService";
    import { onVersionReload } from "../../../quanta/versionReload";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import { showFloatingUi } from "../../../Utils/svelte-floatingui-show";
    import { formatFileSize } from "../../../Utils/FileSize";
    import PollCreateDialog from "../PollCreateDialog.svelte";
    import LazyEmote from "../../../Components/EmoteMenu/LazyEmote.svelte";
    import youtubeSvg from "../../../Components/images/applications/icon_youtube.svg";
    import klaxoonSvg from "../../../Components/images/applications/icon_klaxoon.svg";
    import googleDriveSvg from "../../../Components/images/applications/icon_google_drive.svg";
    import googleDocsSvg from "../../../Components/images/applications/icon_google_docs.svg";
    import googleSheetsSvg from "../../../Components/images/applications/icon_google_sheets.svg";
    import googleSlidesSvg from "../../../Components/images/applications/icon_google_slides.svg";
    import eraserSvg from "../../../Components/images/applications/icon_eraser.svg";
    import excalidrawSvg from "../../../Components/images/applications/icon_excalidraw.svg";
    import cardsPng from "../../../Components/images/applications/icon_cards.svg";
    import tldrawJpeg from "../../../Components/images/applications/icon_tldraw.jpeg";
    import { shouldDisableMessageInput, shouldDisableSendButton } from "./MessageInputBarDisabling";
    import ApplicationFormWrapper from "./Application/ApplicationFormWrapper.svelte";
    import MessageFileInput from "./Message/MessageFileInput.svelte";
    import MessageInput from "./MessageInput.svelte";
    import {
        IconAlertTriangle,
        IconCheck,
        IconHelpCircle,
        IconList,
        IconLoader,
        IconMoodSmile,
        IconPaperclip,
        IconPencil,
        IconSend,
        IconX,
    } from "@wa-icons";
    import { modals } from "@wa-modals";

    interface Props {
        room: ChatConversation;
        disabled: boolean;
    }

    let { room: roomProp, disabled = false }: Props = $props();

    // quanta: students ask for help in the class chat, where a request scrolls away: the queue keeps their place.
    let quickFileInput: HTMLInputElement | undefined = $state();
    const quickRowClass =
        "m-0 flex min-h-10 w-full items-center gap-3 rounded-lg border-0 bg-transparent px-3 py-1.5 text-left text-white hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50";
    const ASKS_FOR_HELP = /підійд|подійд|підійт|допоможі|допомогт|підкажі|подойд|помоги|come over|help/i;
    const HAND_HINT_MS = 30000;
    let handHint = $state(false);
    let handHintTimer: ReturnType<typeof setTimeout> | undefined;
    function offerHand(text: string): void {
        if (!QUANTA_UI || !isClassChat(roomProp) || !ASKS_FOR_HELP.test(text)) return;
        if (get(userIsAdminStore) || get(isHandRaisedStore) || !get(roomHandSpaceStore)) return;
        handHint = true;
        clearTimeout(handHintTimer);
        handHintTimer = setTimeout(() => (handHint = false), HAND_HINT_MS);
    }
    function raiseHandFromChat(): void {
        const space = get(roomHandSpaceStore);
        if (space) requestedHandRaiseState.raise(space.getName());
        handHint = false;
        clearTimeout(handHintTimer);
    }
    // quanta: in the side column the box says who will read the message (quanta/chatAudience.ts).
    let placeholder = $derived(
        QUANTA_UI && isClassChat(roomProp)
            ? $QL.messageClass()
            : QUANTA_UI && roomProp === $tableChatStore?.room
              ? $QL.messageNearby()
              : $LL.chat.enter(),
    );

    // Room is keyed in the parent component, so it will be re-created when the room changes.
    const room = (() => roomProp)();

    let message = $state("");
    // quanta: spaces-only or line-break-only text (&nbsp;, <br>) is not a message.
    let messageIsBlank = $derived(isBlankChatBody(message));
    let messageInput: HTMLDivElement | undefined = $state();
    let messageBarRef: HTMLDivElement;
    let stopTypingTimeOutID: undefined | ReturnType<typeof setTimeout>;
    let files: { id: string; file: File }[] = $state([]);
    let sendingFiles = $state(false);
    let filesPreview: {
        id: string;
        size: number;
        name: string;
        type: string;
        url: string | undefined;
    }[] = $state([]);
    const TYPINT_TIMEOUT = 10000;
    const inactiveProximityState = readable(false);

    let applicationComponentOpened = $state(false);
    let fileAttachmentComponentOpened = $state(false);
    let fileAttachementEnabled = $state(false);
    let applicationProperty: ApplicationProperty | undefined = $state(undefined);
    // `room` is snapshotted into a non-reactive const above (the parent keys this component), so all the
    // values below derived purely from `room` are computed once and never recompute. They are plain consts,
    // not `$derived`. The stores they hold (e.g. canSendMessages) are still auto-subscribed with `$` at use sites.
    const isProximityChatRoom = room instanceof ProximityChatRoom;
    const isDefaultProximityRoom = room instanceof ProximityChatRoom && room.spaceName === DEFAULT_PROXIMITY_SPACE_NAME;
    const proximityChatDisabled = room instanceof ProximityChatRoom ? room.isChatDisabled : inactiveProximityState;
    const proximityRoomJoined = room instanceof ProximityChatRoom ? room.isJoined : inactiveProximityState;
    const proximityFilesAllowed = room instanceof ProximityChatRoom ? room.canSendFiles : readable(true);
    const cannotCreatePoll = readable(false);
    const canSendMessages = room.canSendMessages ?? readable(true);
    const chatMutedByTeacher = room instanceof ProximityChatRoom ? room.chatMutedByTeacher : inactiveProximityState;
    const chatNotice = room instanceof ProximityChatRoom ? room.chatNotice : readable<string | undefined>(undefined);

    function getPollCreationCapability(currentRoom: ChatConversation) {
        return hasChatRoomPollCreation(currentRoom) ? currentRoom.pollCreation : undefined;
    }

    function canOpenQuestionsPanel(currentRoom: ChatConversation): boolean {
        return hasProximityChatSidePanel(currentRoom);
    }

    const pollCreation = getPollCreationCapability(room);
    const canCreatePoll = pollCreation?.canCreate ?? cannotCreatePoll;
    let messageInputDisabled = $derived(
        shouldDisableMessageInput({
            disabled,
            isProximityChatRoom,
            isDefaultProximityRoom,
            isProximityChatDisabled: $proximityChatDisabled,
            isProximityRoomJoined: $proximityRoomJoined,
        }) || !$canSendMessages,
    );
    // Proximity files travel peer to peer, so there is nobody to send them to before the space is joined,
    // and too many recipients to upload to in a crowded one.
    let tooManyUsersForFiles = $derived(!$proximityFilesAllowed);
    // Proximity files have fixed caps: say so as soon as a file lands in the preview, not on send.
    let fileValidation = $derived(
        isProximityChatRoom
            ? validateProximityFiles(files.map(({ file }) => file))
            : { tooManyFiles: false, tooLargeFiles: [] },
    );
    let tooLargeFileIds = $derived(
        new Set(files.filter(({ file }) => fileValidation.tooLargeFiles.includes(file)).map(({ id }) => id)),
    );
    let fileErrors: { title: string; hint?: string }[] = $derived([
        // The chat can grow past the limit after the files were picked. quanta: only with files picked; otherwise a
        // class chat past the limit (the whole room) could not send text at all.
        ...(tooManyUsersForFiles && files.length > 0
            ? [{ title: $LL.chat.fileAttachment.tooManyUsers({ max: PROXIMITY_FILE_TRANSFER_MAX_USERS }) }]
            : []),
        ...(fileValidation.tooLargeFiles.length > 0
            ? [
                  {
                      title: $LL.chat.file.tooBig({ count: fileValidation.tooLargeFiles.length }),
                      hint: $LL.chat.file.tooBigHint({
                          count: fileValidation.tooLargeFiles.length,
                          max: formatFileSize(PROXIMITY_FILE_TRANSFER_MAX_FILE_SIZE),
                      }),
                  },
              ]
            : []),
        ...(fileValidation.tooManyFiles
            ? [
                  {
                      title: $LL.chat.file.tooMany(),
                      hint: $LL.chat.file.tooManyHint({ max: PROXIMITY_FILE_TRANSFER_MAX_FILES }),
                  },
              ]
            : []),
    ]);
    let canAttachFiles = $derived(
        fileAttachementEnabled &&
            $canSendMessages &&
            (!isProximityChatRoom || $proximityRoomJoined) &&
            !tooManyUsersForFiles,
    );
    const canOpenQuestions = canOpenQuestionsPanel(room);
    let replyMessageId: string | null = null;
    const draftId = `${room.id}-${localUserStore.getChatId() ?? "0"}`;

    const applicationManager = gameManager.getCurrentGameScene().applicationManager;

    const selectedChatChatMessageToReplyUnsubscriber = selectedChatMessageToReply.subscribe((chatMessage) => {
        if (chatMessage !== null) {
            messageInput?.focus();
            replyMessageId = chatMessage.id;
        }
    });

    // quanta: a message is edited here in the box, as in Telegram; what was being typed comes back afterwards.
    let editingMessage = $state<ChatMessage | null>(null);
    let editFailed = $state(false);
    let draftBeforeEdit = "";
    // A save answered late (held back by the server's limit) belongs to the edit it was made for, not to one begun since.
    let editAttempt = 0;
    let editingSnippet = $derived(editingMessage ? get(editingMessage.content).body.replace(/\n/g, " ") : "");
    const stopWatchingEdit = selectedChatMessageToEdit.subscribe((toEdit) => {
        if (!QUANTA_UI) return;
        editAttempt++;
        if (toEdit) {
            if (!editingMessage) draftBeforeEdit = message;
            editingMessage = toEdit;
            editFailed = false;
            const body = get(toEdit.content).body;
            message = toEdit.type === "proximity" ? chatInputFromBody(body) : body;
            tick()
                .then(focusAtEnd)
                .catch((error) => console.error(error));
        } else if (editingMessage) {
            editingMessage = null;
            message = draftBeforeEdit;
            draftBeforeEdit = "";
        }
    });

    function focusAtEnd() {
        if (!messageInput) return;
        messageInput.focus();
        window.getSelection()?.selectAllChildren(messageInput);
        window.getSelection()?.collapseToEnd();
    }

    async function saveEdit() {
        if (!editingMessage) return;
        const attempt = ++editAttempt;
        try {
            await editingMessage.edit(message);
            if (attempt === editAttempt) selectedChatMessageToEdit.set(null);
        } catch (error) {
            console.error(error);
            if (attempt === editAttempt) editFailed = true;
        }
    }

    // A teacher can mute someone mid-edit, and the box goes away.
    $effect(() => {
        if ($chatMutedByTeacher && editingMessage) selectedChatMessageToEdit.set(null);
    });

    // quanta: "@" in the class chat's box offers the people in the room (quanta/mentions.ts).
    const mentionsHere = QUANTA_UI && isClassChat(room);
    let mention = $state<{ people: MentionPerson[]; active: number; node: Text; start: number; end: number }>();
    let mentionDismissed: { node: Text; start: number } | undefined;
    const mentionListId = `mention-list-${uuid()}`;

    function updateMention(): void {
        mention = undefined;
        if (!mentionsHere || !messageInput) return;
        const selection = window.getSelection();
        const node = selection?.anchorNode;
        if (!selection?.isCollapsed || !(node instanceof Text) || !messageInput.contains(node)) return;
        const offset = selection.anchorOffset;
        const query = mentionQueryBefore(node.data.slice(0, offset).replace(/\u00a0/g, " "));
        if (query === undefined) return;
        const start = offset - query.length - 1;
        if (mentionDismissed?.node === node && mentionDismissed.start === start) return;
        const people = mentionMatches(mentionPeople(), query);
        if (people.length) mention = { people, active: 0, node, start, end: offset };
    }

    function pickMention(person: MentionPerson): void {
        const target = mention;
        mention = undefined;
        if (!target || !messageInput) return;
        const { node, start, end } = target;
        // Everyone reads the class chat: it carries the server's name, and a teacher's room shows the real one on reading.
        const inserted = `@${person.name}\u00a0`;
        node.replaceData(start, end - start, inserted);
        const range = document.createRange();
        range.setStart(node, start + inserted.length);
        range.collapse(true);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        messageInput.focus();
        message = messageInput.innerHTML;
    }

    /** True when the key was the open list's. */
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
        if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
            event.preventDefault();
            pickMention(mention.people[mention.active]);
            return true;
        }
        if (event.key === "Escape") {
            event.preventDefault();
            mentionDismissed = { node: mention.node, start: mention.start };
            mention = undefined;
            return true;
        }
        return false;
    }

    function sendMessageOrEscapeLine(keyDownEvent: KeyboardEvent) {
        if (mentionKey(keyDownEvent)) return;
        if (editingMessage) {
            if (keyDownEvent.key === "Escape") {
                keyDownEvent.preventDefault();
                selectedChatMessageToEdit.set(null);
            } else if (keyDownEvent.key === "Enter" && !keyDownEvent.shiftKey) {
                keyDownEvent.preventDefault();
                if (!messageIsBlank && $canSendMessages) saveEdit().catch((error) => console.error(error));
            }
            return;
        }
        // Escape hands the keyboard back to the map, so arrows and WASD move the avatar again; the draft stays.
        if (keyDownEvent.key === "Escape") {
            keyDownEvent.preventDefault();
            messageInput?.blur();
            return;
        }
        if (!$canSendMessages) {
            return;
        }
        if (stopTypingTimeOutID) clearTimeout(stopTypingTimeOutID);

        if (keyDownEvent.key === "Enter" || messageIsBlank) {
            room.stopTyping().catch((error) => console.error(error));
        } else {
            room.startTyping()
                .then(() => {
                    stopTypingTimeOutID = setTimeout(() => {
                        room.stopTyping().catch((error) => console.error(error));
                        stopTypingTimeOutID = undefined;
                    }, TYPINT_TIMEOUT);
                })
                .catch((error) => console.error(error));
        }

        if (keyDownEvent.key === "Enter" && keyDownEvent.shiftKey) {
            return;
        }
        if (keyDownEvent.key === "Enter" && !keyDownEvent.shiftKey) {
            keyDownEvent.preventDefault();
        }

        if (keyDownEvent.key === "Enter" && !messageIsBlank) {
            sendMessage().catch((error) => console.error(error));
        }
    }

    async function sendMessage() {
        // The files are only removed from the preview once uploaded: a second Enter or click during the
        // upload would send them again.
        if (!$canSendMessages || sendingFiles || fileErrors.length > 0) {
            return;
        }
        if (editingMessage) {
            await saveEdit();
            return;
        }
        if (applicationProperty && applicationProperty.link.length !== 0) {
            room?.sendMessage(applicationProperty.link);
        }
        // close application part
        applicationProperty = undefined;
        applicationComponentOpened = false;

        // send files
        if (files && files.length > 0) {
            const idsToSend = files.map((f) => f.id);
            const fileList: FileList = files.reduce((fileListAcc, currentFile) => {
                fileListAcc.items.add(currentFile.file);
                return fileListAcc;
            }, new DataTransfer()).files;

            sendingFiles = true;
            try {
                await room.sendFiles(fileList);
                files = files.filter((f) => !idsToSend.includes(f.id));
                filesPreview = filesPreview.filter((p) => !idsToSend.includes(p.id));
            } catch (error) {
                console.error(error);
                warningMessageStore.addWarningMessage($LL.chat.failedToSendAttachments(), { closable: true });
            } finally {
                // A second send cannot start while this guarded upload is in progress.
                // eslint-disable-next-line require-atomic-updates
                sendingFiles = false;
            }
        }

        // send message
        const messageToSend = chatBodyFromInput(message);
        if (!isBlankChatBody(messageToSend)) {
            room?.sendMessage(messageToSend);
            offerHand(messageToSend);
            analyticsClient.trackAdminEvent("chat.message_sent", {
                chatContext: room instanceof ProximityChatRoom ? "proximity" : "room",
            });
            if (messageInput) {
                messageInput.innerText = "";
            }
            message = "";
            if (stopTypingTimeOutID) {
                clearTimeout(stopTypingTimeOutID);
            }
        }
    }

    function unselectChatMessageToReply() {
        selectedChatMessageToReply.set(null);
        replyMessageId = null;
    }

    function onInputHandler() {
        updateMention();
        if (messageIsBlank) {
            if (stopTypingTimeOutID) clearTimeout(stopTypingTimeOutID);
            room.stopTyping().catch((error) => console.error(error));
        }
    }

    onMount(async () => {
        fileAttachementEnabled = gameManager.getCurrentGameScene().room.isChatUploadEnabled;
        const draft = await draftMessageService.loadDraft(draftId);
        if (draft) {
            message = draft.message ?? "";
            if (draft.replyingToMessageId) {
                const loadReplyMessage = await room.getMessageById?.(draft.replyingToMessageId);
                selectedChatMessageToReply.set(loadReplyMessage ?? null);
            }
        }
    });

    // quanta: a reload for a new build (quanta/versionReload.ts) runs no onDestroy; the draft is kept first.
    const stopKeepingDraftOnReload = onVersionReload(() =>
        draftMessageService.saveDraftAndWait({
            id: draftId,
            roomId: room.id,
            userId: localUserStore.getChatId(),
            message: editingMessage ? draftBeforeEdit : message,
            replyingToMessageId: replyMessageId ?? null,
        }),
    );

    onDestroy(() => {
        stopKeepingDraftOnReload();
        draftMessageService.saveDraft({
            id: draftId,
            roomId: room.id,
            userId: localUserStore.getChatId(),
            message: editingMessage ? draftBeforeEdit : message,
            replyingToMessageId: replyMessageId ?? null,
        });
        if (setTimeOutProperty) clearTimeout(setTimeOutProperty);
        if (stopTypingTimeOutID) {
            clearTimeout(stopTypingTimeOutID);
            stopTypingTimeOutID = undefined;
        }
        room.stopTyping().catch((error) => console.error(error));
        closeEmojiPicker?.();
        closeEmojiPicker = undefined;
        selectedChatChatMessageToReplyUnsubscriber();
        stopWatchingEdit();
        editAttempt++;
        if (editingMessage) selectedChatMessageToEdit.set(null);
    });

    let closeEmojiPicker: (() => void) | undefined = undefined;

    function openCloseEmojiPicker() {
        if (closeEmojiPicker) {
            closeEmojiPicker();
            closeEmojiPicker = undefined;
        } else {
            closeEmojiPicker = showFloatingUi(
                messageBarRef,
                LazyEmote,
                {
                    onEmojiClick: (event: EmojiClickEvent) => {
                        message += event.detail.unicode ?? "";
                    },
                    onClose: () => {
                        closeEmojiPicker?.();
                        closeEmojiPicker = undefined;
                    },
                },
                {
                    placement: "top-end",
                },
                12,
                !QUANTA_UI,
            );
        }
    }

    export function handleFiles(filesToAdd: FileList) {
        if (tooManyUsersForFiles) {
            warningMessageStore.addWarningMessage(
                $LL.chat.fileAttachment.tooManyUsers({ max: PROXIMITY_FILE_TRANSFER_MAX_USERS }),
                { closable: true },
            );
            return;
        }
        if (!canAttachFiles) {
            return;
        }
        const newFiles = [...filesToAdd].map((file) => ({ id: uuid(), file }));
        files = [...files, ...newFiles];
        addToPreviews(newFiles);
    }

    function addToPreviews(files: { id: string; file: File }[]) {
        filesPreview = [
            ...filesPreview,
            ...files.map(({ id, file }) => ({
                id,
                name: file.name,
                type: file.type,
                size: file.size,
                url: undefined,
            })),
        ];

        for (const { id, file } of files) {
            if (!file.type.includes("image")) {
                continue;
            }
            const reader = new FileReader();
            reader.onloadend = () => {
                const url = typeof reader.result === "string" ? reader.result : undefined;
                filesPreview = filesPreview.map((p) => (p.id === id ? { ...p, url } : p));
            };
            reader.readAsDataURL(file);
        }
    }

    function deleteFile(id: string) {
        files = files.filter((file) => file.id !== id);
        filesPreview = filesPreview.filter((filePreview) => filePreview.id !== id);
    }

    function focusin(event: FocusEvent) {
        event.stopImmediatePropagation();
        event.preventDefault();
        chatInputFocusStore.set(true);
    }
    function focusout(event: FocusEvent) {
        event.stopImmediatePropagation();
        event.preventDefault();
        chatInputFocusStore.set(false);
    }

    function openFileAttachmentComponent() {
        fileAttachmentComponentOpened = true;
        applicationComponentOpened = false;
        applicationProperty = undefined;
    }
    function closeFileAttachmentComponent() {
        fileAttachmentComponentOpened = false;
        applicationComponentOpened = false;
        applicationProperty = undefined;
    }

    function openPollCreationModal() {
        if (!pollCreation || !$canCreatePoll) {
            return;
        }

        applicationComponentOpened = false;
        applicationProperty = undefined;
        fileAttachmentComponentOpened = false;
        modals.open(PollCreateDialog, { pollCreation });
    }

    function openQuestionsPanel() {
        if (!canOpenQuestions) {
            return;
        }

        applicationComponentOpened = false;
        applicationProperty = undefined;
        fileAttachmentComponentOpened = false;
        roomSidePanelStore.setActiveSection("questions");
    }

    // This function open the application part to propose to the user to add a new application or close application part
    function toggleApplicationComponent() {
        applicationComponentOpened = !applicationComponentOpened;
        applicationProperty = undefined;
    }
    // This function open form to send a link to the user
    let setTimeOutProperty: ReturnType<typeof setTimeout>;
    function openLinkForm(appName: string) {
        applicationProperty = undefined;
        // Use setTimeout to force the component to be updated
        if (setTimeOutProperty) clearTimeout(setTimeOutProperty);
        setTimeOutProperty = setTimeout(() => {
            applicationProperty = getPropertyFromType(appName);
        }, 0);
    }

    function getPropertyFromType(subtype: string) {
        let placeholder: string;
        let title: string;
        let description: string;
        let img: string;
        let name: string;
        let regexUrl: string | undefined;
        let targetEmbedableUrl: string | undefined;
        switch (subtype) {
            case "youtube": {
                name = defaultNativeIntegrationAppName.YOUTUBE;
                placeholder = "https://www.youtube.com/watch?v=Y9ubBWf5w20";
                title = $LL.chat.form.application.youtube.title();
                description = $LL.chat.form.application.youtube.description();
                img = youtubeSvg;
                break;
            }
            case "klaxoon": {
                name = defaultNativeIntegrationAppName.KLAXOON;
                placeholder = "https://app.klaxoon.com/";
                title = $LL.chat.form.application.klaxoon.title();
                description = $LL.chat.form.application.klaxoon.description();
                img = klaxoonSvg;
                break;
            }
            case "googleDrive": {
                name = defaultNativeIntegrationAppName.GOOGLE_DRIVE;
                placeholder = "https://drive.google.com/file/d/1DjNjZVbVeQO9EvgONLzCtl6wG-kxSr9Z/preview";
                title = $LL.chat.form.application.googleDrive.title();
                description = $LL.chat.form.application.googleDrive.description();
                img = googleDriveSvg;
                break;
            }
            case "googleDocs": {
                name = defaultNativeIntegrationAppName.GOOGLE_DOCS;
                placeholder = "https://docs.google.com/document/d/1iFHmKL4HJ6WzvQI-6FlyeuCy1gzX8bWQ83dNlcTzigk/edit";
                title = $LL.chat.form.application.googleDocs.title();
                description = $LL.chat.form.application.googleDocs.description();
                img = googleDocsSvg;
                break;
            }
            case "googleSheets": {
                name = defaultNativeIntegrationAppName.GOOGLE_SHEETS;
                placeholder =
                    "https://docs.google.com/spreadsheets/d/1SBIn3IBG30eeq944OhT4VI_tSg-b1CbB0TV0ejK70RA/edit";
                title = $LL.chat.form.application.googleSheets.title();
                description = $LL.chat.form.application.googleSheets.description();
                img = googleSheetsSvg;
                break;
            }
            case "googleSlides": {
                name = defaultNativeIntegrationAppName.GOOGLE_SLIDES;
                placeholder =
                    "https://docs.google.com/presentation/d/1fU4fOnRiDIvOoVXbksrF2Eb0L8BYavs7YSsBmR_We3g/edit";
                title = $LL.chat.form.application.googleSlides.title();
                description = $LL.chat.form.application.googleSlides.description();
                img = googleSlidesSvg;
                break;
            }
            case "eraser": {
                name = defaultNativeIntegrationAppName.ERASER;
                placeholder = "https://app.eraser.io/workspace/ExSd8Z4wPsaqMMgTN4VU";
                title = $LL.chat.form.application.eraser.title();
                description = $LL.chat.form.application.eraser.description();
                img = eraserSvg;
                break;
            }
            case "excalidraw": {
                name = defaultNativeIntegrationAppName.EXCALIDRAW;
                placeholder = "https://excalidraw.workadventu.re/";
                title = $LL.chat.form.application.excalidraw.title();
                description = $LL.chat.form.application.excalidraw.description();
                img = excalidrawSvg;
                break;
            }
            case "cards": {
                name = defaultNativeIntegrationAppName.CARDS;
                placeholder = "https://member.workadventu.re?tenant=<your cards tenant>&learning=<Your cards learning>";
                title = $LL.chat.form.application.cards.title();
                description = $LL.chat.form.application.cards.description();
                img = cardsPng;
                break;
            }
            case "tldraw": {
                name = defaultNativeIntegrationAppName.TLDRAW;
                placeholder = "https://tldraw.com/";
                title = $LL.chat.form.application.tldraw.title();
                description = $LL.chat.form.application.tldraw.description();
                img = tldrawJpeg;
                break;
            }
            default: {
                const app = applicationManager.applications.find((app) => app.name === subtype);
                if (app == undefined) throw new Error(`Application ${subtype} not found`);

                name = app.name;
                placeholder = app.description ?? "";
                title = app.name;
                description = app.description ?? "";
                img = app.image ?? "";
                regexUrl = app.regexUrl;
                targetEmbedableUrl = app.targetUrl;
                break;
            }
        }
        return {
            name,
            placeholder,
            title,
            description,
            img,
            link: "",
            regexUrl,
            targetEmbedableUrl,
        };
    }

    function onUpdatApplicationProperty(nextApplicationProperty: ApplicationProperty) {
        applicationProperty = nextApplicationProperty;
    }

    let applicationPropertyInProcessing = $state(false);
    function onProcessingApplicationProperty() {
        applicationPropertyInProcessing = true;
    }

    function onProcessedApplicationProperty() {
        applicationPropertyInProcessing = false;
    }

    let quotedMessageContent = $derived($selectedChatMessageToReply?.content);

    const applicationButtonClass =
        "application-picker-item p-2 m-0 flex flex-col w-36 min-h-32 items-center justify-start hover:bg-white/10 rounded-2xl gap-2 disabled:opacity-50 text-center";
    const applicationTitleClass = "text-sm p-0 m-0 w-full leading-tight whitespace-normal break-words";
    const applicationDescriptionClass =
        "text-xs p-0 m-0 min-h-12 w-full leading-tight whitespace-normal break-words text-gray-400";
</script>

{#if files.length > 0}
    <div class="w-full min-w-0 p-1">
        <div class="rounded-lg bg-contrast/80">
            <div class="flex flex-row flex-nowrap gap-2 w-full min-w-[200px] overflow-x-auto no-scroll-bar p-2">
                {#each filesPreview as preview (preview.id)}
                    <div
                        class="relative shrink-0 content-center {preview.type.includes('image')
                            ? 'w-20'
                            : 'w-28'} h-20 rounded-md backdrop-opacity-10 p-0.5 {tooLargeFileIds.has(preview.id)
                            ? 'bg-danger'
                            : 'bg-white'}"
                        data-testid="filePreview"
                    >
                        <button
                            class="border-2 border-white border-solid absolute flex items-center justify-center rounded-full bg-secondary hover:bg-secondary-600 p-0.5 -start-2 -top-2"
                            onclick={() => deleteFile(preview.id)}
                        >
                            <IconX font-size="12" />
                        </button>
                        {#if preview.type.includes("image") && preview.url !== undefined}
                            <img
                                draggable="false"
                                class="w-full h-full object-cover rounded-[10px]"
                                src={preview.url}
                                alt={preview.name}
                            />
                        {:else}
                            <div
                                title={preview.name}
                                class="flex flex-col items-start overflow-hidden text-ellipsis justify-between p-0.5 bg-contrast/90 h-full w-full text-xs rounded-[10px]"
                            >
                                <span class="line-clamp-2 indent-3 text-xs">
                                    {preview.name}
                                </span>
                                <div class="flex items-center gap-1 rounded-[6px] bg-white/10 p-0.5 text-xxs m-0.5">
                                    {#if preview.type.includes("image") && preview.url === undefined}
                                        <IconLoader class="animate-spin shrink-0" font-size={12} />
                                    {/if}
                                    <span>{formatFileSize(preview.size)}</span>
                                </div>
                            </div>
                        {/if}
                    </div>
                {/each}
            </div>
            {#each fileErrors as fileError (fileError.title)}
                <div
                    class="mx-2 mb-2 flex items-start gap-2 rounded-lg border border-solid border-danger bg-danger/15 px-2.5 py-1.5 text-sm text-white"
                    role="alert"
                    data-testid="fileError"
                >
                    <IconAlertTriangle class="mt-0.5 shrink-0 text-danger-200" font-size={16} />
                    <div class="leading-snug">
                        <div class="font-bold">{fileError.title}</div>
                        {#if fileError.hint}
                            <div class="text-white/85">{fileError.hint}</div>
                        {/if}
                    </div>
                </div>
            {/each}
        </div>
    </div>
{/if}
{#if applicationComponentOpened && QUANTA_UI}
    <!-- quanta: what a class actually uses, as a short list; a file goes straight to the system's picker. -->
    <div class="flex w-full flex-col gap-0.5 p-2" data-testid="quantaChatAttachMenu">
        <input
            bind:this={quickFileInput}
            type="file"
            multiple
            hidden
            onchange={(event) => {
                const picked = event.currentTarget.files;
                if (picked && picked.length > 0) handleFiles(picked);
                event.currentTarget.value = "";
                applicationComponentOpened = false;
            }}
        />
        <button
            type="button"
            data-testid="fileAttachmentButton"
            class={quickRowClass}
            disabled={!canAttachFiles}
            onclick={() => quickFileInput?.click()}
        >
            <IconPaperclip font-size={20} class="shrink-0" />
            <span class="min-w-0">
                <span class="block text-sm">{$QL.chatAttachFile()}</span>
                <span class="block text-xs text-white/60">
                    {#if !fileAttachementEnabled}
                        {$LL.chat.fileAttachment.featureComingSoon()}
                    {:else if tooManyUsersForFiles}
                        {$LL.chat.fileAttachment.tooManyUsers({ max: PROXIMITY_FILE_TRANSFER_MAX_USERS })}
                    {:else if isClassChat(roomProp)}
                        {$QL.chatFileInRoom()}
                    {:else if isProximityChatRoom}
                        {$LL.chat.fileAttachment.proximityDescription()}
                    {/if}
                </span>
            </span>
        </button>
        {#if pollCreation && $canCreatePoll}
            <button type="button" data-testid="createPollButton" class={quickRowClass} onclick={openPollCreationModal}>
                <IconList font-size={20} class="shrink-0" />
                <span class="text-sm">{$LL.chat.poll.title()}</span>
            </button>
        {/if}
    </div>
{:else if applicationComponentOpened}
    <div class="w-full bg-contrast/50 rounded-t-2xl">
        <div class="application-picker flex flex-wrap w-full justify-between items-center p-2 gap-2">
            <button
                data-testid="youtubeApplicationButton"
                class={applicationButtonClass}
                onclick={() => openLinkForm("youtube")}
                class:bg-secondary-800={applicationProperty?.name === "youtube"}
                disabled={!applicationManager.youtubeToolActivated}
            >
                <img draggable="false" class="w-8" src={youtubeSvg} alt={$LL.chat.a11y.applicationIcon()} />
                <h2 class={applicationTitleClass}>{$LL.chat.form.application.youtube.title()}</h2>
                <p class={applicationDescriptionClass}>
                    {applicationManager.youtubeToolActivated
                        ? $LL.chat.form.application.youtube.description()
                        : $LL.mapEditor.properties.youtube.disabled()}
                </p>
            </button>

            <button
                data-testid="klaxoonApplicationButton"
                class={applicationButtonClass}
                onclick={() => openLinkForm("klaxoon")}
                class:bg-secondary-800={applicationProperty?.name === "klaxoon"}
                disabled={!applicationManager.klaxoonToolActivated}
            >
                <img draggable="false" class="w-8" src={klaxoonSvg} alt={$LL.chat.a11y.applicationIcon()} />
                <h2 class={applicationTitleClass}>{$LL.chat.form.application.klaxoon.title()}</h2>
                <p class={applicationDescriptionClass}>
                    {applicationManager.klaxoonToolActivated
                        ? $LL.chat.form.application.klaxoon.description()
                        : $LL.mapEditor.properties.klaxoon.disabled()}
                </p>
            </button>

            <button
                data-testid="googleSheetsApplicationButton"
                class={applicationButtonClass}
                onclick={() => openLinkForm("googleSheets")}
                class:bg-secondary-800={applicationProperty?.name === "googleSheets"}
                disabled={!applicationManager.googleSheetsToolActivated}
            >
                <img draggable="false" class="w-8" src={googleSheetsSvg} alt={$LL.chat.a11y.applicationIcon()} />
                <h2 class={applicationTitleClass}>{$LL.chat.form.application.googleSheets.title()}</h2>
                <p class={applicationDescriptionClass}>
                    {applicationManager.googleSheetsToolActivated
                        ? $LL.chat.form.application.googleSheets.description()
                        : $LL.mapEditor.properties.googleSheets.disabled()}
                </p>
            </button>

            <button
                data-testid="googleDocsApplicationButton"
                class={applicationButtonClass}
                onclick={() => openLinkForm("googleDocs")}
                class:bg-secondary-800={applicationProperty?.name === "googleDocs"}
                disabled={!applicationManager.googleDocsToolActivated}
            >
                <img draggable="false" class="w-8" src={googleDocsSvg} alt={$LL.chat.a11y.applicationIcon()} />
                <h2 class={applicationTitleClass}>{$LL.chat.form.application.googleDocs.title()}</h2>
                <p class={applicationDescriptionClass}>
                    {applicationManager.googleDocsToolActivated
                        ? $LL.chat.form.application.googleDocs.description()
                        : $LL.mapEditor.properties.googleDocs.disabled()}
                </p>
            </button>

            <button
                data-testid="googleSlidesApplicationButton"
                class={applicationButtonClass}
                onclick={() => openLinkForm("googleSlides")}
                class:bg-secondary-800={applicationProperty?.name === "googleSlides"}
                disabled={!applicationManager.googleSlidesToolActivated}
            >
                <img draggable="false" class="w-8" src={googleSlidesSvg} alt={$LL.chat.a11y.applicationIcon()} />
                <h2 class={applicationTitleClass}>{$LL.chat.form.application.googleSlides.title()}</h2>
                <p class={applicationDescriptionClass}>
                    {applicationManager.googleSlidesToolActivated
                        ? $LL.chat.form.application.googleSlides.description()
                        : $LL.mapEditor.properties.googleSlides.disabled()}
                </p>
            </button>

            <button
                data-testid="googleDriveApplicationButton"
                class={applicationButtonClass}
                onclick={() => openLinkForm("googleDrive")}
                class:bg-secondary-800={applicationProperty?.name === "googleDrive"}
                disabled={!applicationManager.googleDriveToolActivated}
            >
                <img draggable="false" class="w-8" src={googleDriveSvg} alt={$LL.chat.a11y.applicationIcon()} />
                <h2 class={applicationTitleClass}>{$LL.chat.form.application.googleDrive.title()}</h2>
                <p class={applicationDescriptionClass}>
                    {applicationManager.googleDriveToolActivated
                        ? $LL.chat.form.application.googleDrive.description()
                        : $LL.mapEditor.properties.googleDrive.disabled()}
                </p>
            </button>

            <button
                data-testid="eraserApplicationButton"
                class={applicationButtonClass}
                onclick={() => openLinkForm("eraser")}
                class:bg-secondary-800={applicationProperty?.name === "eraser"}
                disabled={!applicationManager.eraserToolActivated}
            >
                <img draggable="false" class="w-8" src={eraserSvg} alt={$LL.chat.a11y.applicationIcon()} />
                <h2 class={applicationTitleClass}>{$LL.chat.form.application.eraser.title()}</h2>
                <p class={applicationDescriptionClass}>
                    {applicationManager.eraserToolActivated
                        ? $LL.chat.form.application.eraser.description()
                        : $LL.mapEditor.properties.eraser.disabled()}
                </p>
            </button>

            <button
                data-testid="excalidrawApplicationButton"
                class={applicationButtonClass}
                onclick={() => openLinkForm("excalidraw")}
                class:bg-secondary-800={applicationProperty?.name === "excalidraw"}
                disabled={!applicationManager.excalidrawToolActivated}
            >
                <img draggable="false" class="w-8" src={excalidrawSvg} alt={$LL.chat.a11y.applicationIcon()} />
                <h2 class={applicationTitleClass}>{$LL.chat.form.application.excalidraw.title()}</h2>
                <p class={applicationDescriptionClass}>
                    {applicationManager.excalidrawToolActivated
                        ? $LL.chat.form.application.excalidraw.description()
                        : $LL.mapEditor.properties.excalidraw.disabled()}
                </p>
            </button>

            <button
                data-testid="cardsApplicationButton"
                class={applicationButtonClass}
                onclick={() => openLinkForm("cards")}
                class:bg-secondary-800={applicationProperty?.name === "cards"}
                disabled={!applicationManager.cardsToolActivated}
            >
                <img draggable="false" class="w-8" src={cardsPng} alt={$LL.chat.a11y.applicationIcon()} />
                <h2 class={applicationTitleClass}>{$LL.chat.form.application.cards.title()}</h2>
                <p class={applicationDescriptionClass}>
                    {applicationManager.cardsToolActivated
                        ? $LL.chat.form.application.cards.description()
                        : $LL.mapEditor.properties.cards.disabled()}
                </p>
            </button>

            <button
                data-testid="tldrawApplicationButton"
                class={applicationButtonClass}
                onclick={() => openLinkForm("tldraw")}
                class:bg-secondary-800={applicationProperty?.name === "tldraw"}
                disabled={!applicationManager.tldrawToolActivated}
            >
                <img draggable="false" class="w-8" src={tldrawJpeg} alt={$LL.chat.a11y.applicationIcon()} />
                <h2 class={applicationTitleClass}>{$LL.chat.form.application.tldraw.title()}</h2>
                <p class={applicationDescriptionClass}>
                    {applicationManager.tldrawToolActivated
                        ? $LL.chat.form.application.tldraw.description()
                        : $LL.mapEditor.properties.tldraw.disabled()}
                </p>
            </button>
        </div>

        <div class="application-picker flex flex-wrap w-full justify-between items-center p-2 gap-2">
            {#each applicationManager.applications as app, index (`my-own-app-${index}`)}
                <button
                    data-testid="{app.name}ApplicationButton"
                    class={applicationButtonClass}
                    class:bg-secondary-800={applicationProperty?.name === app.name}
                    onclick={() => openLinkForm(app.name)}
                >
                    <img draggable="false" class="w-8" src={app.image} alt={$LL.chat.a11y.applicationIcon()} />
                    <h2 class={applicationTitleClass}>{app.name}</h2>
                    <p class={applicationDescriptionClass}>{app.description}</p>
                </button>
            {/each}
        </div>

        <div class="application-picker flex flex-wrap w-full justify-between items-center p-2 gap-2">
            <button
                data-testid="fileAttachmentButton"
                class={applicationButtonClass}
                onclick={() => openFileAttachmentComponent()}
                class:bg-secondary-800={fileAttachmentComponentOpened}
                disabled={!canAttachFiles}
            >
                <IconPaperclip font-size={32} />
                <h2 class={applicationTitleClass}>
                    {isProximityChatRoom ? $LL.chat.fileAttachment.proximityTitle() : $LL.chat.fileAttachment.title()}
                </h2>
                <p class={applicationDescriptionClass}>
                    {#if !fileAttachementEnabled}
                        {$LL.chat.fileAttachment.featureComingSoon()}
                    {:else if tooManyUsersForFiles}
                        {$LL.chat.fileAttachment.tooManyUsers({ max: PROXIMITY_FILE_TRANSFER_MAX_USERS })}
                    {:else if isProximityChatRoom}
                        {$LL.chat.fileAttachment.proximityDescription()}
                    {:else}
                        {$LL.chat.fileAttachment.description()}
                    {/if}
                </p>
            </button>

            <button
                data-testid="createPollButton"
                class={applicationButtonClass}
                onclick={openPollCreationModal}
                disabled={!pollCreation || !$canCreatePoll}
            >
                <IconList font-size={32} />
                <h2 class={applicationTitleClass}>{$LL.chat.poll.title()}</h2>
                <p class={applicationDescriptionClass}>
                    {pollCreation && $canCreatePoll ? $LL.chat.poll.create.description() : $LL.chat.disabled()}
                </p>
            </button>

            <button
                data-testid="openQuestionsPanelButton"
                class={applicationButtonClass}
                onclick={openQuestionsPanel}
                disabled={!canOpenQuestions}
            >
                <IconHelpCircle font-size={32} />
                <h2 class={applicationTitleClass}>{$LL.chat.question.title()}</h2>
                <p class={applicationDescriptionClass}>
                    {canOpenQuestions ? $LL.chat.question.description() : $LL.chat.question.proximityOnly()}
                </p>
            </button>
        </div>
    </div>
{/if}
{#if handHint && !$isHandRaisedStore}
    <div
        class="flex w-full flex-none items-center gap-2 px-4 pb-1 text-xs text-white/80"
        role="status"
        data-testid="chatHandHint"
    >
        <span class="min-w-0 flex-1">{$QL.chatHandHint()}</span>
        <button type="button" class="btn btn-sm btn-secondary shrink-0" onclick={raiseHandFromChat}
            >{$QL.chatHandButton()}</button
        >
    </div>
{/if}
{#if $chatNotice}
    <p class="m-0 w-full flex-none px-4 pb-1 text-xs text-white/70" role="status" data-testid="chatNotice">
        {$chatNotice}
    </p>
{/if}
{#if applicationProperty}
    <div
        class="flex w-full flex-none items-center border border-solid border-b-0 border-x-0 border-t-1 border-white/10 bg-contrast/50"
    >
        <ApplicationFormWrapper
            property={applicationProperty}
            update={onUpdatApplicationProperty}
            processing={onProcessingApplicationProperty}
            processed={onProcessedApplicationProperty}
        />
    </div>
{/if}
{#if fileAttachmentComponentOpened}
    <MessageFileInput
        filesSelected={(files) => {
            handleFiles(files);
            closeFileAttachmentComponent();
        }}
        fileUploaded={() => closeFileAttachmentComponent()}
    />
{/if}
{#if editingMessage}
    <div class="quanta-edit-strip" class:failed={editFailed} data-testid="editStrip">
        <IconPencil font-size={16} />
        <div class="quanta-edit-strip-text">
            <span>{editFailed ? $LL.chat.messageEditedError() : $QL.editingMessage()}</span>
            <span>{editingSnippet}</span>
        </div>
        <button
            type="button"
            aria-label={$LL.chat.createRoom.buttons.cancel()}
            title={$LL.chat.createRoom.buttons.cancel()}
            data-testid="cancelMessageEditionButton"
            onclick={() => selectedChatMessageToEdit.set(null)}><IconX font-size={16} /></button
        >
    </div>
{/if}
<div
    class="flex w-full flex-none items-center border border-solid border-b-0 border-x-0 border-t-1 border-white/10 bg-contrast/50 relative"
    bind:this={messageBarRef}
>
    {#if $selectedChatMessageToReply !== null}
        <div class="flex p-2 items-start absolute top-0 -translate-y-full w-full">
            <div class="flex flex-row gap-2 items-center justify-between bg-contrast rounded-lg w-full backdrop-blur">
                <div class="flex flex-col p-2 rounded-lg w-full">
                    <span class="flex flex-row justify-between">
                        <span class="text-sm text-gray-400">
                            {$LL.chat.replyTo()}
                        </span>
                        <button class="p-2 m-0" onclick={unselectChatMessageToReply}>
                            <!--<IconCircleX />-->
                            <IconX font-size={18} />
                        </button>
                    </span>
                    <div class="flex row w-full border-l border-l-white/10 ml-1 border-solid border-0">
                        <p
                            class=" text-xs text-white/30 rounded-md p-2 m-0 truncate w-full text-ellipsis"
                            style:overflow-wrap="anywhere"
                        >
                            {$quotedMessageContent?.body}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    {/if}
    {#if mention}
        <MentionPicker
            people={mention.people}
            active={mention.active}
            id={mentionListId}
            onpick={pickMention}
            insertsName
        />
    {/if}
    {#if $chatMutedByTeacher}
        <!-- quanta: a muted person sees why there is nowhere to type, not a box that swallows what they write. -->
        <p class="m-0 flex-grow px-4 py-3 text-sm text-white/60" role="status" data-testid="chatMutedNotice">
            {$QL.chatMuted()}
        </p>
    {:else}
        <MessageInput
            onkeydown={sendMessageOrEscapeLine}
            oninput={onInputHandler}
            pasteFiles={handleFiles}
            {focusin}
            focusout={(event) => {
                mention = undefined;
                focusout(event);
            }}
            bind:message
            bind:messageInput
            disabled={messageInputDisabled}
            inputClass="message-input flex-grow !m-0 px-4 py-2.5 max-h-36 overflow-auto h-full rounded-lg block text-sm text-white placeholder:text-white/50 placeholder:text-sm border border-white/10 !bg-white/5 resize-none outline-none shadow-none focus:ring-0 focus:border-white/20"
            dataText={placeholder}
            dataTestid="messageInput"
        />
        <button
            style:display={editingMessage ? "none" : undefined}
            data-testid="addApplicationButton"
            class="p-0 m-0 h-11 w-11 flex items-center justify-center hover:bg-white/10 rounded-md shrink-0"
            class:bg-secondary-800={applicationComponentOpened}
            onclick={toggleApplicationComponent}
        >
            <IconX
                font-size={18}
                class={applicationComponentOpened ? "rotate-0" : "rotate-45"}
                style="transition: all .2s ease-out;"
            />
        </button>
        <button
            class="p-0 m-0 h-11 w-11 flex items-center justify-center hover:bg-white/10 rounded-md shrink-0"
            onclick={openCloseEmojiPicker}
        >
            <IconMoodSmile font-size={18} />
        </button>
        {@const nothingToSend =
            messageIsBlank && files.length === 0 && !(applicationProperty && applicationProperty.link.length !== 0)}
        <!-- quanta: the button keeps its place, dim while there is nothing to send (quanta-ui.css). -->
        {#if QUANTA_UI || !nothingToSend}
            <button
                data-testid="sendMessageButton"
                class="disabled:opacity-30 disabled:!cursor-not-allowed disabled:text-white py-0 px-3 m-0 bg-secondary h-full rounded-md"
                aria-label={editingMessage ? $QL.editMessage() : QUANTA_UI ? $QL.sendMessage() : undefined}
                disabled={nothingToSend ||
                    sendingFiles ||
                    shouldDisableSendButton({
                        applicationPropertyInProcessing,
                        isMessageInputDisabled: messageInputDisabled,
                    }) ||
                    fileErrors.length > 0}
                onclick={() => sendMessage().catch((error) => console.error(error))}
            >
                {#if editingMessage}
                    <IconCheck />
                {:else}
                    <IconSend />
                {/if}
            </button>
        {/if}
    {/if}
</div>

<style>
    .no-scroll-bar {
        max-width: calc(100% + 15px);
    }
    .no-scroll-bar::-webkit-scrollbar {
        display: none;
    }
    .no-scroll-bar {
        -ms-overflow-style: none;
        scrollbar-width: none;
    }
</style>
