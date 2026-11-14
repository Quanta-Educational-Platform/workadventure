<script lang="ts">
    // quanta: one compact card for the room's "something is blocked" help (camera, microphone, pop-ups,
    // notifications, the call's connection): what is wrong and how to fix it, then at most two actions.
    import type { Snippet } from "svelte";
    import { fly } from "svelte/transition";
    import Icon from "./Icon.svelte";
    import type { IconName } from "./icons";

    interface Props {
        icon: IconName;
        title: string;
        body?: string;
        /** A problem the person must fix (red mark), or a state they wait out (spinner). */
        tone?: "blocked" | "pending" | "neutral";
        /** Above the dock (the room's pop-ups) or at the top of the room's window. */
        placement?: "dock" | "top";
        testId?: string;
        extra?: Snippet;
        actions: Snippet;
    }

    let { icon, title, body, tone = "blocked", placement = "dock", testId, extra, actions }: Props = $props();
</script>

<div
    class="quanta-help-card {placement}"
    class:bare={!body && !extra}
    role="dialog"
    aria-labelledby="quanta-help-card-title"
    aria-describedby={body ? "quanta-help-card-body" : undefined}
    data-testid={testId}
    transition:fly={{ y: placement === "top" ? -12 : 12, duration: 180 }}
>
    <div class="mark {tone}" aria-hidden="true">
        {#if tone === "pending"}
            <span class="spinner"></span>
        {:else}
            <Icon name={icon} size={18} />
        {/if}
    </div>
    <div class="text">
        <p class="title" id="quanta-help-card-title">{title}</p>
        {#if body}
            <p class="body" id="quanta-help-card-body">{body}</p>
        {/if}
        {#if extra}
            <div class="extra">{@render extra()}</div>
        {/if}
    </div>
    <div class="actions">{@render actions()}</div>
</div>

<style>
    .quanta-help-card {
        box-sizing: border-box;
        display: grid;
        grid-template-columns: 32px minmax(0, 1fr);
        column-gap: 12px;
        width: 380px;
        max-width: calc(100vw - 32px);
        margin: 0 auto;
        padding: 14px 14px 10px 14px;
        border-radius: 16px;
        background: #1d2027;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
        color: #eceef1;
        color-scheme: dark;
        text-align: start;
        pointer-events: auto;
    }

    /* A title alone sits level with its mark. */
    .quanta-help-card.bare {
        align-items: center;
    }

    .quanta-help-card.top {
        position: absolute;
        top: 24px;
        left: 50%;
        z-index: 901;
        translate: -50% 0;
    }

    .mark {
        display: grid;
        place-items: center;
        width: 32px;
        height: 32px;
        border-radius: 9999px;
        background: rgba(255, 255, 255, 0.08);
        color: #c9d5ea;
    }

    /* The dock draws a blocked device in red: the card names the same thing in the same colour. */
    .mark.blocked {
        background: rgba(255, 138, 128, 0.14);
        color: #ff8a80;
    }

    .spinner {
        width: 16px;
        height: 16px;
        border: 2px solid rgba(201, 213, 234, 0.3);
        border-top-color: #c9d5ea;
        border-radius: 9999px;
        animation: quanta-help-spin 0.9s linear infinite;
    }

    @keyframes quanta-help-spin {
        to {
            rotate: 1turn;
        }
    }

    .text {
        min-width: 0;
        padding-top: 1px;
    }

    .title {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
        line-height: 20px;
        color: #eceef1;
    }

    .body {
        margin: 2px 0 0;
        font-size: 13px;
        line-height: 18px;
        color: rgba(236, 238, 241, 0.72);
        overflow-wrap: anywhere;
    }

    .extra {
        margin-top: 8px;
    }

    .actions {
        grid-column: 1 / -1;
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 4px;
        margin-top: 10px;
    }

    .actions :global(button) {
        display: inline-flex;
        align-items: center;
        height: 30px;
        margin: 0;
        padding: 0 12px;
        border: 0;
        border-radius: 9999px;
        background: transparent;
        color: rgba(255, 255, 255, 0.75);
        font-size: 13px;
        font-weight: 500;
        white-space: nowrap;
        cursor: pointer;
    }

    .actions :global(button:hover),
    .actions :global(button:focus-visible) {
        background: rgba(255, 255, 255, 0.08);
        color: #eceef1;
    }

    .actions :global(button.primary) {
        background: #c9d5ea;
        color: #1d2b45;
        font-weight: 600;
    }

    .actions :global(button.primary:hover),
    .actions :global(button.primary:focus-visible) {
        background: #d8e1f0;
        color: #1d2b45;
    }

    .actions :global(button:disabled) {
        opacity: 0.55;
        cursor: default;
    }

    .extra :global(label) {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0;
        font-size: 12px;
        line-height: 16px;
        color: rgba(255, 255, 255, 0.7);
        cursor: pointer;
    }

    /* WA's design system draws every tick box white: a dark one with a light tick, like the room's switches. */
    .extra :global(input[type="checkbox"]) {
        flex: none;
        appearance: none;
        display: grid;
        place-items: center;
        width: 16px;
        height: 16px;
        margin: 0;
        border: 1.5px solid rgba(255, 255, 255, 0.4);
        border-radius: 4px;
        background: transparent;
        cursor: pointer;
    }

    .extra :global(input[type="checkbox"]:checked) {
        border-color: #c9d5ea;
        background: #c9d5ea
            url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%231d2b45' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M20 6 9 17l-5-5'/%3E%3C/svg%3E")
            center / 12px no-repeat;
    }
</style>
