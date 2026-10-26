<script lang="ts" generics="T extends string">
    import { clickOutside } from "svelte-outside";
    import { listboxKeys, openOnArrows } from "../listboxKeys";
    import Icon from "../Icon.svelte";
    import type { IconName } from "../icons";

    interface Props {
        options: { value: T; label: string }[];
        value: T | undefined;
        label: string;
        icon?: IconName;
        placeholder?: string;
        compact?: boolean;
        testId?: string;
        onchange: (value: T) => void;
    }

    let { options, value, label, icon, placeholder = label, compact = false, testId, onchange }: Props = $props();

    let open = $state(false);
    let button: HTMLButtonElement | undefined = $state();

    function closeList(refocus: boolean): void {
        open = false;
        if (refocus) button?.focus();
    }
    let current = $derived(options.find((option) => option.value === value)?.label ?? placeholder);
</script>

<div class="qs-dropdown" class:compact use:clickOutside={() => (open = false)}>
    <button
        type="button"
        class="qs-dropdown-button"
        bind:this={button}
        use:openOnArrows={() => (open = true)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        title={current}
        data-testid={testId}
        onclick={() => (open = !open)}
    >
        {#if icon}<Icon name={icon} size={20} />{/if}
        <span>{current}</span>
        <Icon name="dropDown" size={22} />
    </button>
    {#if open}
        <ul class="qs-list" role="listbox" aria-label={label} use:listboxKeys={closeList}>
            {#each options as option (option.value)}
                <li role="option" aria-selected={option.value === value}>
                    <button
                        type="button"
                        onclick={() => {
                            closeList(true);
                            if (option.value !== value) onchange(option.value);
                        }}
                    >
                        <span class="qs-check">
                            {#if option.value === value}<Icon name="check" size={20} />{/if}
                        </span>
                        <span>{option.label}</span>
                    </button>
                </li>
            {/each}
        </ul>
    {/if}
</div>

<style>
    .qs-dropdown {
        position: relative;
        width: 100%;
    }

    .qs-dropdown.compact {
        flex: none;
        width: 240px;
    }

    .qs-dropdown-button {
        width: 100%;
        height: 48px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 12px 0 16px;
        border: 1px solid var(--qs-outline);
        border-radius: 9999px;
        background: transparent;
        color: var(--qs-text);
        font: inherit;
        font-size: 15px;
        cursor: pointer;
    }

    .qs-dropdown-button:hover {
        background: rgba(255, 255, 255, 0.06);
    }

    .qs-dropdown-button span {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        text-align: start;
    }

    .qs-dropdown-button :global(svg) {
        flex: none;
    }

    .qs-list {
        position: absolute;
        z-index: 2;
        top: calc(100% + 6px);
        left: 0;
        min-width: 100%;
        max-height: 280px;
        overflow-y: auto;
        margin: 0;
        padding: 8px 0;
        list-style: none;
        border-radius: 12px;
        background: var(--qs-raised);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
    }

    .qs-list button {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px 10px 12px;
        border: 0;
        background: transparent;
        color: var(--qs-text);
        font: inherit;
        font-size: 14px;
        text-align: start;
        white-space: nowrap;
        cursor: pointer;
    }

    .qs-list button:hover,
    .qs-list button:focus-visible {
        background: rgba(255, 255, 255, 0.08);
    }

    .qs-check {
        width: 20px;
        flex: none;
        display: flex;
    }
</style>
