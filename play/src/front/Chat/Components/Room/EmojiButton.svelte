<script lang="ts">
    import type { EmojiClickEvent } from "emoji-picker-element/shared";
    import { showFloatingUi } from "../../../Utils/svelte-floatingui-show";
    import LazyEmote from "../../../Components/EmoteMenu/LazyEmote.svelte";
    import { QUANTA_UI } from "../../../Enum/EnvironmentVariable";
    import { QL } from "../../../quanta/i18n";
    import { emoteDataStore } from "../../../Stores/EmoteStore";
    import { REACTION_MARKERS } from "../../../../common/quanta/RoomSession";
    import { IconMoodSmile } from "@wa-icons";

    interface Props {
        messageRef?: HTMLDivElement;
        onchange?: (emoji: string) => void;
        /** quanta: the emojis this person has already reacted with, marked in the row. */
        mine?: readonly string[];
        /** quanta: the quick row opened or closed, so the message can place it clear of itself. */
        onopenchange?: (open: boolean) => void;
    }

    let { messageRef, onchange, mine = [], onopenchange }: Props = $props();

    // quanta: the six the dock's reactions offer (this person's, as edited there), so a class reacts the same way
    // everywhere; only ones the room's server takes (RoomSession.react), without the teacher's markers, topped up from
    // the defaults. Six at 28 px still fit a 200 px chat on one line.
    const DEFAULT_REACTIONS = ["👍", "❤️", "😂", "👏", "😍", "🙏"];
    const reactable = (emoji: string) =>
        emoji.length <= 16 && /^\p{Extended_Pictographic}/u.test(emoji) && !REACTION_MARKERS.includes(emoji);
    let QUICK_REACTIONS = $derived(
        [
            ...[...$emoteDataStore.entries()].sort(([a], [b]) => a - b).map(([, entry]) => entry.emoji),
            ...DEFAULT_REACTIONS,
        ]
            .filter((emoji, index, all) => emoji && reactable(emoji) && all.indexOf(emoji) === index)
            .slice(0, 6),
    );
    let quickOpen = $state(false);
    let root: HTMLSpanElement | undefined = $state();
    // quanta: a click elsewhere closes the row; listened for only while it is open, not by every message in the chat.
    $effect(() => {
        if (!quickOpen) return;
        const outside = (event: PointerEvent) => {
            if (!(event.target instanceof Node && root?.contains(event.target))) quickOpen = false;
        };
        document.addEventListener("pointerdown", outside, true);
        return () => document.removeEventListener("pointerdown", outside, true);
    });
    $effect(() => onopenchange?.(quickOpen));

    let trigger: HTMLButtonElement;

    let closeEmojiPicker: (() => void) | undefined = undefined;

    function togglePicker() {
        if (QUANTA_UI) {
            quickOpen = !quickOpen;
        } else if (closeEmojiPicker) {
            closeEmojiPicker();
            closeEmojiPicker = undefined;
        } else if (messageRef) {
            closeEmojiPicker = showFloatingUi(
                messageRef,
                LazyEmote,
                {
                    onEmojiClick: (event: EmojiClickEvent) => {
                        onchange?.(event.detail.unicode ?? "");
                        closeEmojiPicker?.();
                        closeEmojiPicker = undefined;
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
                true,
            );
        }
    }

    function pickQuick(emoji: string) {
        quickOpen = false;
        onchange?.(emoji);
    }
</script>

<svelte:window
    onkeydown={(event) => {
        if (quickOpen && event.key === "Escape") quickOpen = false;
    }}
/>

<span class="contents" bind:this={root}>
    <button
        data-testid="openEmojiPickerButton"
        class="p-0 m-0 text-white/50 hover:text-white transition-all flex"
        aria-label={QUANTA_UI ? $QL.reactToMessage() : undefined}
        title={QUANTA_UI ? $QL.reactToMessage() : undefined}
        aria-expanded={QUANTA_UI ? quickOpen : undefined}
        bind:this={trigger}
        onclick={togglePicker}
    >
        <IconMoodSmile font-size={16} />
    </button>
    {#if quickOpen}
        <div class="quanta-react-row" role="group" aria-label={$QL.reactToMessage()} data-testid="quickReactions">
            {#each QUICK_REACTIONS as emoji (emoji)}
                <button type="button" aria-pressed={mine.includes(emoji)} onclick={() => pickQuick(emoji)}
                    >{emoji}</button
                >
            {/each}
        </div>
    {/if}
</span>
