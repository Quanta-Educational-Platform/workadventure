<script lang="ts">
    // quanta: the browser stopped a window the room tried to open: where to allow it, in one card.
    import { helpSettingsPopupBlockedStore } from "../../Stores/HelpSettingsPopupBlockedStore";
    import { QL } from "../../quanta/i18n";
    import HelpCard from "../../quanta/HelpCard.svelte";
    import { blockedPopupsText } from "../../quanta/blockedHelp";
</script>

<HelpCard
    icon="externalLink"
    title={$QL.blockedPopups()}
    body={blockedPopupsText($QL)}
    placement="top"
    testId="quanta-popups-blocked"
>
    {#snippet actions()}
        <button type="button" class="primary" onclick={() => helpSettingsPopupBlockedStore.set(false)}>
            {$QL.blockedGotIt()}
        </button>
    {/snippet}
</HelpCard>
