<script lang="ts">
    // quanta: the chat column's header, the platform's people list's own (VirtualRoom.tsx, RoomPeoplePanel): People and
    // Chat as underline tabs where the platform shows its list in the same column, otherwise the chat's title.
    import { chatVisibilityStore } from "../Stores/ChatStore";
    import { LL } from "../../i18n/i18n-svelte";
    import { selectedRoomStore } from "../Chat/Stores/SelectRoomStore";
    import { QL } from "./i18n";
    import { nameTag } from "./nameTag";
    import { showPeople } from "./sidePanel";
    import { classChatRoom, isClassChat, namesList, tableChatStore } from "./chatAudience";
    import { activeDirectStore, closeDirect, directConversationsStore, openDirect } from "./directMessages";
    import { fullNamesStore, shownName } from "./fullNames";
    import { mentionMarksStore } from "./mentions";
    import RoomRecordingIndicator from "./RoomRecordingIndicator.svelte";
    import { sidePanelLayoutStore } from "./sidePanel";
    import { IconX } from "@wa-icons";

    let { tabs }: { tabs: boolean } = $props();

    // What the head leaves the recording indicator beside its tabs and close button: its words, or its dot.
    let headWidth = $state(0);
    let tabsBox: HTMLDivElement | undefined = $state();
    let heading: HTMLHeadingElement | undefined = $state();
    let recordingSpace = $state(Infinity);
    // The tabs' (or the heading's) own words, measured again as the head resizes, the language changes and the room's
    // fonts arrive (a fallback font measures differently).
    function measure(): void {
        const words = tabsBox
            ? [...tabsBox.children].reduce((sum, tab) => sum + tab.getBoundingClientRect().width, 0) +
              20 * Math.max(0, tabsBox.children.length - 1)
            : (heading?.scrollWidth ?? 0);
        // The head's padding (16 + 8), the close button (40) and the gaps either side (8 + 8).
        recordingSpace = headWidth - words - 24 - 40 - 16;
    }
    $effect(() => {
        void headWidth;
        void $QL;
        void tabs;
        measure();
        const fonts = document.fonts;
        fonts?.addEventListener("loadingdone", measure);
        void fonts?.ready.then(measure);
        return () => fonts?.removeEventListener("loadingdone", measure);
    });

    // Which chat is on screen (the class's, the table's or a private conversation) and who reads it.
    let direct = $derived($directConversationsStore.find((entry) => entry.peerId === $activeDirectStore));
    let atTable = $derived(!direct && $selectedRoomStore !== undefined && $selectedRoomStore === $tableChatStore?.room);

    // Opening the chat in a bubble is most often to write to those in it; a DM being opened keeps its place.
    let wasOpen = false;
    $effect(() => {
        const open = $chatVisibilityStore;
        if (open && !wasOpen && $tableChatStore && !$activeDirectStore) showTable();
        wasOpen = open;
    });

    function showClass(): void {
        closeDirect();
        const room = classChatRoom();
        if (room) selectedRoomStore.set(room);
    }

    function showTable(): void {
        const table = $tableChatStore;
        if (!table) return;
        closeDirect();
        selectedRoomStore.set(table.room);
        table.room.hasUnreadMessages.set(false);
    }
</script>

<div class="quanta-chat-head" class:tabs bind:clientWidth={headWidth}>
    {#if tabs}
        <div class="quanta-chat-tabs" role="tablist" bind:this={tabsBox}>
            <button type="button" role="tab" aria-selected="false" onclick={showPeople}>{$QL.people()}</button>
            <button type="button" role="tab" aria-selected="true">{$QL.chat()}</button>
        </div>
    {:else}
        <h2 bind:this={heading}>{$QL.chat()}</h2>
    {/if}
    <!-- A chat over the whole room takes the dock, and the room's own recording indicator with it: it shows here. -->
    {#if $sidePanelLayoutStore.cover}<RoomRecordingIndicator size="head" space={recordingSpace} />{/if}
    <button
        type="button"
        class="quanta-chat-close"
        aria-label={$LL.chat.closeChat()}
        title={$LL.chat.closeChat()}
        data-testid="closeChatButton"
        onclick={() => chatVisibilityStore.set(false)}
    >
        <!-- Beside the People tab, People's own close (RoomPeoplePanel's IconButton, md): a 15px X. -->
        <IconX font-size={tabs ? 12.5 : 20} />
    </button>
</div>
{#if $tableChatStore || $directConversationsStore.length > 0}
    <div class="quanta-chat-switch" role="tablist">
        <button type="button" role="tab" aria-selected={!atTable && !direct} onclick={showClass}
            >{$QL.classChat()}{#if $mentionMarksStore.has("class")}<span
                    class="mentioned"
                    aria-label={$QL.mentionedYou()}>@</span
                >{/if}</button
        >
        {#if $tableChatStore}
            <button type="button" role="tab" aria-selected={atTable} onclick={showTable}>
                {namesList($tableChatStore.names.map(nameTag))}
                {#if !atTable && $tableChatStore.unread}<span class="unread" aria-hidden="true"></span>{/if}
            </button>
        {/if}
        {#each $directConversationsStore as conversation (conversation.peerId)}
            <button
                type="button"
                role="tab"
                aria-selected={direct?.peerId === conversation.peerId}
                onclick={() => openDirect(conversation.peerId, conversation.name)}
            >
                {shownName($fullNamesStore, conversation.peerId, conversation.name)}
                {#if direct?.peerId !== conversation.peerId && $mentionMarksStore.has(conversation.peerId)}<span
                        class="mentioned"
                        aria-label={$QL.mentionedYou()}>@</span
                    >{:else if direct?.peerId !== conversation.peerId && conversation.unread}<span
                        class="unread"
                        aria-hidden="true"
                    ></span>{/if}
            </button>
        {/each}
    </div>
{/if}
{#if direct}
    <p class="quanta-chat-audience">
        {$QL.onlyYouAnd({ names: shownName($fullNamesStore, direct.peerId, direct.name) })}
    </p>
{:else if atTable && $tableChatStore}
    <p class="quanta-chat-audience">{$QL.onlyYouAnd({ names: namesList($tableChatStore.names) })}</p>
{:else if isClassChat($selectedRoomStore)}
    <p class="quanta-chat-audience">{$QL.everyoneSees()}</p>
{/if}

<style>
    .quanta-chat-head {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: none;
        padding: 12px 8px 4px 16px;
    }

    .quanta-chat-head.tabs {
        align-items: flex-end;
        padding: 4px 8px 0 16px;
        border-bottom: 1px solid rgb(255 255 255 / 0.08);
    }

    h2 {
        flex: 1;
        min-width: 0;
        margin: 0;
        font-size: 18px;
        font-weight: 400;
        line-height: 28px;
        color: rgb(255 255 255 / 0.9);
        overflow-wrap: anywhere;
    }

    .quanta-chat-tabs {
        display: flex;
        flex: 1;
        min-width: 0;
        gap: 20px;
    }

    .quanta-chat-tabs button {
        margin-bottom: -1px;
        padding: 12px 0 10px;
        border: 0;
        border-bottom: 2px solid transparent;
        background: none;
        font-size: 14px;
        font-weight: 500;
        line-height: 20px;
        color: rgb(255 255 255 / 0.55);
        cursor: pointer;
        transition: color 150ms;
    }

    .quanta-chat-tabs button:hover {
        color: rgb(255 255 255 / 0.9);
    }

    .quanta-chat-tabs button[aria-selected="true"] {
        border-bottom-color: rgb(255 255 255 / 0.9);
        color: rgb(255 255 255 / 0.9);
        cursor: default;
    }

    .quanta-chat-tabs button:focus-visible,
    .quanta-chat-close:focus-visible {
        outline: 2px solid #c9d5ea;
        outline-offset: 2px;
        border-radius: 4px;
    }

    .quanta-chat-close {
        display: flex;
        flex: none;
        align-items: center;
        justify-content: center;
        width: 40px;
        height: 40px;
        border: 0;
        border-radius: 9999px;
        background: none;
        color: rgb(255 255 255 / 0.7);
        cursor: pointer;
    }

    /* People's close button (the platform's ghost IconButton), so the X stays put switching tabs. */
    .tabs .quanta-chat-close {
        width: 32px;
        height: 32px;
        margin-bottom: 6px;
        color: oklch(0.551 0.027 264.364);
        transition:
            color 200ms,
            background-color 200ms;
    }

    .quanta-chat-switch {
        display: flex;
        flex: none;
        flex-wrap: wrap;
        gap: 6px;
        padding: 10px 12px 0;
    }

    .quanta-chat-switch button {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 28px;
        padding: 0 12px;
        border: 0;
        border-radius: 9999px;
        background: #2b3038;
        font-size: 13px;
        font-weight: 500;
        color: #a7adb7;
        cursor: pointer;
        max-width: 100%;
        overflow-wrap: anywhere;
    }

    .quanta-chat-switch button[aria-selected="true"] {
        background: #c9d5ea;
        color: #1d2b45;
        cursor: default;
    }

    .quanta-chat-switch button:focus-visible {
        outline: 2px solid #c9d5ea;
        outline-offset: 2px;
    }

    .unread {
        width: 6px;
        height: 6px;
        border-radius: 9999px;
        background: #f2c14e;
    }

    .mentioned {
        font-size: 12px;
        font-weight: 700;
        line-height: 1;
        color: #f2c14e;
    }

    .quanta-chat-audience {
        flex: none;
        margin: 0;
        padding: 8px 16px 0;
        font-size: 12px;
        line-height: 16px;
        color: #8b919b;
    }

    .quanta-chat-close:hover {
        background: rgb(255 255 255 / 0.08);
        color: rgb(255 255 255 / 0.9);
    }

    .tabs .quanta-chat-close:hover {
        color: oklch(0.373 0.034 259.733);
    }
</style>
