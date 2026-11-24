<script lang="ts">
    // quanta: "+N" beside the message holding the one row under a board (lane.ts); pressed, the rest open above it.
    import { laneOpen, laneStore } from "./lane";
    import { QL } from "./i18n";

    let { key }: { key: string } = $props();
</script>

{#if $laneStore.active && $laneStore.winner === key && $laneStore.others > 0}
    <button
        type="button"
        class="quanta-lane-more"
        aria-expanded={$laneStore.open}
        aria-label={$laneStore.open ? $QL.fewerNotices() : $QL.moreNotices({ n: $laneStore.others })}
        onclick={() => laneOpen.update((open) => !open)}
        data-testid="quanta-notices-more"
    >
        {$laneStore.open ? $QL.fewerNotices() : `+${$laneStore.others}`}
    </button>
{/if}
