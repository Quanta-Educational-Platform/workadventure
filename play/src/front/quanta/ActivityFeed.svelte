<script lang="ts">
    // quanta: what students out of the teacher's view just did (roomActivity.ts). A click goes to them.
    import { fullNamesStore } from "./fullNames";
    import { goTo } from "./goTo";
    import { QL } from "./i18n";
    import { nameTag } from "./nameTag";
    import { activityRowsStore } from "./roomActivity";

    interface Props {
        bottom: number;
    }

    let { bottom }: Props = $props();

    const SHOWN = 3;
    let shown = $derived($activityRowsStore.slice(0, SHOWN));
    let more = $derived($activityRowsStore.length - shown.length);
</script>

{#if shown.length > 0}
    <ul class="qa" style:bottom={`${bottom}px`} data-testid="quanta-activity-feed">
        {#each shown as row (row.uuid)}
            <li>
                <button
                    type="button"
                    class="qa-row"
                    title={$QL.chatGoToSender()}
                    onclick={() => goTo({ uuid: row.uuid })}
                >
                    {#if row.kind === "think"}<span aria-hidden="true">💭</span>{/if}
                    <span class="qa-name">{nameTag($fullNamesStore.get(row.uuid) ?? row.name)}</span>
                    <span class="qa-text">{row.text}</span>
                </button>
            </li>
        {/each}
        {#if more > 0}
            <li class="qa-more">{$QL.moreOnAir({ count: more })}</li>
        {/if}
    </ul>
{/if}

<style>
    .qa {
        position: fixed;
        left: 12px;
        z-index: 400;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 4px;
        max-width: min(280px, 40vw);
        margin: 0;
        padding: 0;
        list-style: none;
        pointer-events: auto;
    }

    .qa li {
        max-width: 100%;
    }

    .qa-row {
        display: flex;
        align-items: baseline;
        gap: 6px;
        max-width: 100%;
        margin: 0;
        padding: 4px 10px;
        border: 0;
        border-radius: 14px;
        background: rgb(20 22 28 / 0.82);
        color: #fff;
        font-size: 12px;
        line-height: 16px;
        text-align: left;
        cursor: pointer;
    }

    .qa-row:hover {
        background: rgb(20 22 28 / 0.95);
    }

    .qa-name {
        flex: none;
        font-weight: 600;
    }

    .qa-text {
        min-width: 0;
        overflow: hidden;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow-wrap: anywhere;
        color: rgb(255 255 255 / 0.85);
    }

    .qa-more {
        padding: 0 10px;
        color: #fff;
        font-size: 11px;
        text-shadow: 0 1px 2px rgb(0 0 0 / 0.7);
    }
</style>
