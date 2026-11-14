<script lang="ts">
    // quanta: the class chat's pinned messages (pinnedMessages.ts), one at a time under the chat's head for everyone, as
    // a messenger shows a pin: a quote of the message, its sender over its first line. A click brings the message into
    // view and moves on to the next pin, newest first; the bar at the start marks which of several this is. Staff unpin
    // from here too.
    import { roomSidePanelStore } from "../Chat/Stores/RoomSidePanelStore";
    import { chatTextFromBody } from "../../common/quanta/chatBody";
    import { toastStore } from "../Stores/ToastStoreSingleton";
    import TextToast from "../Components/Toasts/TextToast.svelte";
    import { pinnedMessagesStore } from "./pinnedMessages";
    import { fullNamesStore, shownName } from "./fullNames";
    import { QL } from "./i18n";
    import { markMentions } from "./mentions";
    import { roomModerationStore } from "./moderationBridge";
    import { IconPin, IconX } from "@wa-icons";

    let { roomId }: { roomId: string } = $props();

    let index = $state(0);
    let pins = $derived($pinnedMessagesStore.pins);
    let at = $derived(Math.min(index, pins.length - 1));
    let shown = $derived(pins[at]);
    // The sender in full, as this viewer's room names them (a teacher's real name for staff): the row has room for it,
    // and the label says the same name.
    let sender = $derived(shown ? shownName($fullNamesStore, shown.sender, shown.name) : "");
    let text = $derived(shown ? chatTextFromBody(shown.body).replace(/\s+/g, " ").trim() : "");
    // The preview's mentions and links read as they do in the bubble: its mentions marked as the bubble marks them
    // (mentions.ts), from the ids the room's server kept. It is one line, so nothing in it is a link itself.
    let preview = $derived.by(() => {
        if (!shown) return "";
        const escaped = text.replace(
            /[&<>"]/g,
            (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
        );
        const linked = escaped.replace(/https?:\/\/[^\s<]+/g, (url) => `<span class="link">${url}</span>`);
        return markMentions(linked, shown.mentions ?? [], $roomModerationStore?.self, $fullNamesStore);
    });

    // On to the next pin only once this one is in view: one the chat no longer holds stays, and says so.
    function open(): void {
        if (!shown) return;
        const from = at;
        roomSidePanelStore.focusTimelineEvent(roomId, shown.id, (found) => {
            if (found) index = pins.length > 1 ? (from + 1) % pins.length : 0;
            else
                toastStore.addToast(
                    TextToast,
                    { message: $QL.pinnedGone(), toastUuid: "quanta-pin-gone" },
                    "quanta-pin-gone",
                );
        });
    }
</script>

{#if shown}
    <div class="quanta-pinned" data-testid="pinnedStrip">
        <button
            type="button"
            class="open"
            onclick={open}
            title={text}
            aria-label={`${pins.length > 1 ? $QL.pinnedOf({ index: at + 1, count: pins.length }) : $QL.pinnedMessage()}, ${sender}: ${text}`}
        >
            <span class="bars" aria-hidden="true">
                {#each pins as pin, i (pin.id)}<span class:on={i === at}></span>{/each}
            </span>
            <span class="lines">
                <span class="head">
                    <IconPin font-size={12} class="pin" aria-hidden="true" />
                    <span class="who">{sender}</span>
                </span>
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- escaped, then marked as the bubble marks it -->
                <span class="text">{@html preview}</span>
            </span>
        </button>
        {#if $pinnedMessagesStore.canPin}
            <button
                type="button"
                class="unpin"
                aria-label={$QL.unpinMessage()}
                title={$QL.unpinMessage()}
                data-testid="unpinButton"
                onclick={() => $pinnedMessagesStore.unpin(shown.id)}><IconX font-size={16} /></button
            >
        {/if}
    </div>
{/if}

<style>
    /* Under the chat's head, on the chat's own ground: a hairline below it, no band of its own. */
    .quanta-pinned {
        display: flex;
        align-items: center;
        flex: none;
        min-width: 0;
        margin: 6px 0 0;
        padding: 0 4px 6px 8px;
        border-bottom: 1px solid rgb(255 255 255 / 0.08);
    }

    .open {
        display: flex;
        align-items: stretch;
        gap: 10px;
        flex: 1;
        min-width: 0;
        padding: 6px 8px;
        border: 0;
        border-radius: 10px;
        background: none;
        color: inherit;
        text-align: start;
        cursor: pointer;
    }

    .open:focus-visible,
    .unpin:focus-visible {
        outline: 2px solid #c9d5ea;
        outline-offset: -2px;
    }

    /* One segment per pin, the shown one lit: where this one is among several. */
    .bars {
        flex: none;
        display: flex;
        flex-direction: column;
        gap: 2px;
        width: 3px;
    }

    .bars span {
        flex: 1;
        border-radius: 2px;
        background: rgb(255 255 255 / 0.18);
    }

    .bars span.on {
        background: #c9d5ea;
    }

    .lines {
        display: flex;
        flex-direction: column;
        min-width: 0;
    }

    .head {
        display: flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
        font-size: 13px;
        line-height: 18px;
    }

    .head :global(.pin) {
        flex: none;
        color: #8b919b;
    }

    .who {
        overflow: hidden;
        font-weight: 600;
        color: #eceef1;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    /* A one-line preview: the whole message is a click away, in the chat. */
    .text {
        overflow: hidden;
        font-size: 14px;
        line-height: 20px;
        color: #c6cad1;
        white-space: nowrap;
        text-overflow: ellipsis;
    }

    .text :global(.quanta-mention) {
        font-weight: 600;
        color: #f2c14e;
    }

    .text :global(.link) {
        color: #b9d3ff;
        text-decoration: underline;
        text-decoration-thickness: 1px;
        text-underline-offset: 2px;
    }

    .unpin {
        flex: none;
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: 9999px;
        background: none;
        color: #8b919b;
        cursor: pointer;
    }

    @media (hover: hover) {
        .open:hover {
            background: rgb(255 255 255 / 0.05);
        }

        .unpin:hover {
            background: rgb(255 255 255 / 0.08);
            color: #eceef1;
        }
    }
</style>
