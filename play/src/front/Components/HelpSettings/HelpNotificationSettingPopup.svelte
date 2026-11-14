<script lang="ts">
    // quanta: notifications were refused for the site: where this browser allows them, in one card.
    import { helpNotificationSettingsVisibleStore } from "../../Stores/HelpSettingsStore";
    import { QL } from "../../quanta/i18n";
    import HelpCard from "../../quanta/HelpCard.svelte";
    import { blockedFixText } from "../../quanta/blockedHelp";
</script>

<HelpCard
    icon="bellOff"
    title={$QL.blockedNotifications()}
    body={blockedFixText($QL, $QL.blockedDeviceNotifications())}
    placement="top"
    testId="quanta-notifications-blocked"
>
    {#snippet actions()}
        <button type="button" class="primary" onclick={() => helpNotificationSettingsVisibleStore.set(false)}>
            {$QL.blockedGotIt()}
        </button>
    {/snippet}
</HelpCard>
