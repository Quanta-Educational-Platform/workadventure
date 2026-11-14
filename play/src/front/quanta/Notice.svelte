<script lang="ts">
    // quanta: the room's one notice shape (quanta-ui.css .qn), for WA's toasts and notifications and our own. Colour
    // says what kind it is, on the icon only: info (grey), your move (blue), something is wrong (amber), recording
    // (red). At most one action, plus dismiss. Text wraps; it is never cut.
    import type { Snippet } from "svelte";
    import { IconLoader } from "@wa-icons";
    import Icon from "./Icon.svelte";
    import type { IconName } from "./icons";
    import type { NoticeTone } from "./noticeLook";
    import { QL } from "./i18n";

    interface Props {
        tone?: NoticeTone;
        /** An icon, "busy" for a spinner (reconnecting), "rec" or "paused" for the recording dot. */
        icon?: IconName | "busy" | "rec" | "paused";
        /** Who it is from, in a small line over the text (a teacher's poke, a chat message's sender). */
        lead?: string;
        text?: string;
        children?: Snippet;
        /** After the text, before the action: a live level meter. */
        trailing?: Snippet;
        action?: string;
        actionIcon?: IconName;
        actionDisabled?: boolean;
        onaction?: () => void;
        ondismiss?: () => void;
        /** How a screen reader hears it arrive; "off" where the room's notice stack reads it out (NoticeStack.svelte). */
        live?: "polite" | "assertive" | "off";
        testid?: string;
    }

    let {
        tone = "info",
        icon = "info",
        lead = undefined,
        text = undefined,
        children = undefined,
        trailing = undefined,
        action = undefined,
        actionIcon = undefined,
        actionDisabled = false,
        onaction = undefined,
        ondismiss = undefined,
        live = "polite",
        testid = undefined,
    }: Props = $props();

    // A card whose one line doesn't fit (with or without a button) stacks in a narrow room (the container query below): measured on its words in
    // one line, never on the form it is in, so the two forms can't flip each other.
    let card: HTMLDivElement | undefined = $state();
    let stacked = $state(false);

    $effect(() => {
        const node = card;
        if (!node) return;
        // The width the card may take: its query container's (the notice stack, the on-air strip), as the CSS sees it.
        let box: HTMLElement | null = node.parentElement;
        while (box && getComputedStyle(box).containerType === "normal") box = box.parentElement;
        const fit = () => {
            if (!box) return;
            const style = getComputedStyle(box);
            const room = box.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
            const was = node.classList.contains("stacked");
            node.classList.remove("stacked");
            node.classList.add("measuring");
            const oneLine = node.offsetWidth;
            node.classList.remove("measuring");
            if (was) node.classList.add("stacked");
            stacked = room > 0 && oneLine > Math.min(room, 760);
        };
        const observer = new ResizeObserver(fit);
        if (box) observer.observe(box);
        observer.observe(node);
        void document.fonts?.ready.then(fit);
        return () => observer.disconnect();
    });
</script>

<div
    bind:this={card}
    class="qn tone-{tone}"
    class:stacked
    role={live === "assertive" ? "alert" : live === "polite" ? "status" : undefined}
    data-testid={testid}
>
    <span class="qn-icon" aria-hidden="true">
        {#if icon === "busy"}
            <IconLoader class="qn-spin" font-size="1.125rem" />
        {:else if icon === "rec"}
            <span class="qn-dot"></span>
        {:else if icon === "paused"}
            <span class="qn-pause"><i></i><i></i></span>
        {:else}
            <Icon name={icon} size={18} />
        {/if}
    </span>
    <!-- Text and action share a line; in a narrow room (the stack's container query) the action goes under the text. -->
    <div class="qn-body">
        <div class="qn-text">
            {#if lead}<span class="qn-lead">{lead}</span>{/if}{#if text}{text}{/if}{@render children?.()}
        </div>
        {#if trailing}<span class="qn-trailing">{@render trailing()}</span>{/if}
        {#if action && onaction}
            <button type="button" class="qn-action" disabled={actionDisabled} onclick={onaction}>
                {#if actionIcon}<Icon name={actionIcon} size={16} />{/if}
                {action}
            </button>
        {/if}
    </div>
    {#if ondismiss}
        <button type="button" class="qn-close" aria-label={$QL.closeHint()} title={$QL.closeHint()} onclick={ondismiss}>
            <Icon name="close" size={16} />
        </button>
    {/if}
</div>

<style>
    .qn {
        box-sizing: border-box;
        display: flex;
        align-items: center;
        gap: 10px;
        width: max-content;
        /* Long text wraps inside the card, which never leaves it room to spare before the button. */
        max-width: min(100%, 760px);
        min-height: 44px;
        padding: 6px 16px 6px 14px;
        border: 1px solid rgb(255 255 255 / 0.07);
        border-radius: 14px;
        background: rgb(29 32 39 / 0.97);
        box-shadow:
            0 1px 2px rgb(0 0 0 / 0.3),
            0 8px 24px rgb(0 0 0 / 0.28);
        color: #e3e6ea;
        font-family: "Fira Sans", system-ui, sans-serif;
        font-size: 14px;
        line-height: 20px;
        pointer-events: auto;
    }

    /* A card ending in a round button or the cross sits as close to its edge as to the top and bottom; text needs the
       same room as the icon has on the left. */
    .qn:has(> .qn-close),
    .qn:has(.qn-body > .qn-action:last-child) {
        padding-right: 6px;
    }

    .qn-icon {
        flex: none;
        display: grid;
        place-items: center;
        width: 18px;
        height: 20px;
        color: #9aa3b0;
    }

    .qn.tone-action .qn-icon {
        color: #8ab4f8;
    }

    .qn.tone-problem .qn-icon {
        color: #f2b84b;
    }

    .qn-body {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        align-items: center;
        column-gap: 12px;
        row-gap: 6px;
        padding: 5px 0;
    }

    .qn-trailing {
        flex: none;
        display: flex;
    }

    .qn-text {
        flex: 1 1 auto;
        min-width: 0;
        margin: 0;
        overflow-wrap: break-word;
        hyphens: manual;
    }

    /* As a chat message toast names its sender: over the text, as a phone shows one. */
    .qn-lead {
        display: block;
        margin-bottom: 1px;
        font-size: 13px;
        line-height: 18px;
        font-weight: 600;
        color: #f4f5f7;
    }

    .qn-text :global(b) {
        font-weight: 600;
        color: #fff;
    }

    .qn-action {
        flex: none;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 32px;
        padding: 0 14px;
        border: 0;
        /* Concentric with the card: its 14px corner less the 6px it stands in from the edge. */
        border-radius: 8px;
        background: #c9d5ea;
        color: #1d2b45;
        font: inherit;
        font-size: 13.5px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
    }

    .qn-action:has(:global(svg)) {
        padding-left: 10px;
    }

    .qn-action:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .qn-close {
        flex: none;
        align-self: center;
        display: grid;
        place-items: center;
        width: 30px;
        height: 30px;
        border: 0;
        border-radius: 8px;
        background: transparent;
        color: #8b919b;
        cursor: pointer;
    }


    .qn.measuring {
        position: absolute;
        max-width: none;
        visibility: hidden;
    }

    .qn.measuring .qn-text {
        white-space: nowrap;
    }

    /* A button and the cross side by side read as a pair: the card's gap less the cross's own inset. */
    .qn-body:has(> .qn-action:last-child) + .qn-close {
        margin-left: -6px;
    }

    /* A narrow room (the stack's container query): the text gets the width, the icon and cross stay on its first line,
       and the button takes the corner under the cross, as a phone's snackbar does. */
    @container (max-width: 400px) {
        .qn.stacked {
            display: grid;
            grid-template-columns: 18px minmax(0, 1fr) auto;
            align-items: start;
            column-gap: 10px;
            row-gap: 2px;
            padding-right: 6px;
        }

        .qn.stacked .qn-body {
            display: contents;
        }

        .qn.stacked .qn-icon {
            grid-area: 1 / 1;
            margin-top: 5px;
        }

        .qn.stacked .qn-text {
            grid-area: 1 / 2;
            padding: 5px 0;
        }

        .qn.stacked .qn-close {
            grid-area: 1 / 3;
            align-self: start;
            margin: 0;
        }

        .qn.stacked .qn-trailing {
            grid-area: 2 / 2;
            align-self: center;
        }

        .qn.stacked .qn-action {
            grid-area: 2 / 2 / 3 / 4;
            justify-self: end;
        }
    }

    @media (hover: hover) {
        .qn-action:hover:not(:disabled) {
            filter: brightness(1.07);
        }

        button.qn-close:hover {
            background: rgb(255 255 255 / 0.08);
            color: #eceef1;
        }
    }

    .qn-action:focus-visible,
    .qn-close:focus-visible {
        outline: 2px solid #c9d5ea;
        outline-offset: 2px;
    }

    .qn-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #ff5a5f;
        box-shadow: 0 0 0 3px rgb(255 90 95 / 0.22);
    }

    .qn-pause {
        display: flex;
        gap: 3px;
    }

    .qn-pause i {
        width: 3px;
        height: 10px;
        border-radius: 1px;
        background: #9aa3b0;
    }

    /* The loader's rays sit low in its box: lifted to the text's middle, as the other icons are. */
    .qn-icon :global(.qn-spin) {
        display: block;
        margin-top: -1.5px;
        color: #eceef1;
        animation: qn-spin 1s linear infinite;
    }

    @keyframes qn-spin {
        to {
            transform: rotate(360deg);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .qn-icon :global(.qn-spin) {
            animation-duration: 2.4s;
        }
    }
</style>
