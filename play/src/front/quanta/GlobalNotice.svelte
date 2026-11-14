<script lang="ts" module>
    import type { Message } from "../Stores/TypeMessageStore/MessageStore";

    /** The message's words alone, for a screen reader. */
    export function globalMessageText(message: Message): string {
        try {
            const delta = JSON.parse(message.text) as { ops?: { insert?: unknown }[] };
            return (delta.ops ?? [])
                .map((op) => (typeof op.insert === "string" ? op.insert : ""))
                .join("")
                .trim();
        } catch {
            return message.text;
        }
    }
</script>

<script lang="ts">
    // quanta: a message staff send to everyone from the room's settings (WA's global message, TextMessageStore) as one of
    // the room's notices: its text as they wrote it, a cross, and Escape for the newest one, as WA's bar had, except
    // while the person is typing or picking (a chat, a field, the emoji picker): Escape is theirs then.
    /* eslint-disable svelte/no-at-html-tags */
    import { QuillDeltaToHtmlConverter } from "quill-delta-to-html";
    import { textMessageStore } from "../Stores/TypeMessageStore/TextMessageStore";
    import Notice from "./Notice.svelte";

    let { message, escape = true }: { message: Message; escape?: boolean } = $props();

    let content = $derived.by(() => {
        try {
            const delta = JSON.parse(message.text) as { ops?: unknown };
            return new QuillDeltaToHtmlConverter((delta.ops ?? []) as never, { inlineStyles: true }).convert();
        } catch {
            return undefined;
        }
    });

    const close = () => textMessageStore.clearMessageById(message.id);
</script>

<svelte:window
    onkeydown={(event) => {
        if (event.key !== "Escape" || !escape || event.defaultPrevented) return;
        const focus = document.activeElement;
        if (
            focus?.closest(
                "input, textarea, select, [contenteditable], emoji-picker, .emoji-picker, [role=dialog], [role=listbox]",
            )
        )
            return;
        close();
    }}
/>

<div class="quanta-notice-slot">
    <Notice icon="campaign" live="off" ondismiss={close} testid="quanta-global-message">
        {#if content !== undefined}<span class="rich">{@html content}</span>{:else}{message.text}{/if}
    </Notice>
</div>

<style>
    /* As written, links and lines kept; a long one scrolls inside the card rather than growing past the room. */
    .rich {
        display: block;
        max-height: 12em;
        overflow: auto;
    }

    .rich :global(p) {
        margin: 0;
    }

    .rich :global(a) {
        color: #b9d3ff;
        text-decoration: underline;
    }
</style>
