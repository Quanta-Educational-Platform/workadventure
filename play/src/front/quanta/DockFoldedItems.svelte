<script lang="ts">
    // quanta: the dock's buttons that didn't fit its row, first in ⋮. Reactions as their row of emojis, one tap each.
    import { displayEmote, emoteDataStore, isEmoteIndex } from "../Stores/EmoteStore";
    import { openedMenuStore } from "../Stores/MenuStore";
    import ActionBarButton from "../Components/ActionBar/ActionBarButton.svelte";
    import { dockFoldedStore } from "./dockFold";
    import { pageMenuStore, runPageMenuItem } from "./pageMenu";
    import Icon from "./Icon.svelte";
    import { QL } from "./i18n";

    function react(key: number): void {
        if (isEmoteIndex(key)) displayEmote(key);
        openedMenuStore.close("profileMenu");
    }
</script>

{#each $dockFoldedStore as item (item.key)}
    {#if item.key === "reactions"}
        <div class="qf-reactions" role="group" aria-label={$QL.reactions()} data-testid="quanta-folded-reactions">
            {#each [...$emoteDataStore.keys()] as key (key)}
                <button
                    type="button"
                    aria-label={$emoteDataStore.get(key)?.name}
                    title={$emoteDataStore.get(key)?.name}
                    onclick={() => react(key)}>{$emoteDataStore.get(key)?.emoji}</button
                >
            {/each}
        </div>
    {:else}
        <ActionBarButton
            label={item.label}
            state={item.disabled ? "disabled" : item.pressed ? "active" : "normal"}
            dataTestId={`quanta-folded-${item.key}`}
            onclick={() => {
                if (item.disabled) return;
                openedMenuStore.close("profileMenu");
                item.run();
            }}
        >
            <Icon name={item.icon} size={20} />
        </ActionBarButton>
    {/if}
{/each}
{#if $pageMenuStore.length > 0}
    {#if $dockFoldedStore.length > 0}<div class="qf-rule" aria-hidden="true"></div>{/if}
    {#each $pageMenuStore as item (item.id)}
        <div class="qf-page" class:danger={item.danger}>
            <ActionBarButton
                label={item.label}
                state={item.pressed ? "active" : "normal"}
                dataTestId={`quanta-page-${item.id}`}
                onclick={() => {
                    openedMenuStore.close("profileMenu");
                    runPageMenuItem(item.id);
                }}
            >
                <Icon name={item.icon} size={20} />
            </ActionBarButton>
            {#if item.detail}<span class="qf-detail">{item.detail}</span>{/if}
        </div>
    {/each}
{/if}
<div class="qf-rule" aria-hidden="true"></div>

<style>
    .qf-reactions {
        box-sizing: border-box;
        width: 100%;
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 2px;
        padding: 2px 0 4px;
    }

    /* Each emoji in the middle of its cell: a button's own padding would push it off-centre. */
    .qf-reactions button {
        display: grid;
        place-items: center;
        min-width: 0;
        height: 36px;
        padding: 0;
        border: 0;
        border-radius: 8px;
        background: transparent;
        font-size: 20px;
        line-height: 1;
        cursor: pointer;
    }

    .qf-reactions button:hover,
    .qf-reactions button:focus-visible {
        background: rgb(255 255 255 / 0.1);
        outline: none;
    }

    /* A recording's length at the row's end; stopping one reads as the action it is. */
    .qf-page {
        position: relative;
    }

    .qf-detail {
        position: absolute;
        top: 50%;
        right: 12px;
        translate: 0 -50%;
        font-size: 12px;
        font-variant-numeric: tabular-nums;
        color: rgb(255 255 255 / 0.6);
        pointer-events: none;
    }

    .qf-page.danger :global(button) {
        color: #ffb4ab;
    }

    .qf-rule {
        height: 1px;
        margin: 4px 6px;
        background: rgb(255 255 255 / 0.12);
    }
</style>
