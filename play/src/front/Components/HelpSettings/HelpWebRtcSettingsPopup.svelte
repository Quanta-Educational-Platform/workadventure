<script lang="ts">
    // quanta: the call's relay can't be reached: what to try, in one card at the top of the room.
    import { onMount } from "svelte";
    import { helpWebRtcSettingsVisibleStore } from "../../Stores/HelpSettingsStore";
    import { LL } from "../../../i18n/i18n-svelte";
    import { QL } from "../../quanta/i18n";
    import HelpCard from "../../quanta/HelpCard.svelte";
    import { warningMessageStore } from "../../Stores/ErrorStore";
    import { localUserStore } from "../../Connection/LocalUserStore";

    let notAskAgain = $state(false);

    function close() {
        helpWebRtcSettingsVisibleStore.set("hidden");
    }

    onMount(() => {
        if (localUserStore.getNotAskAgainHelpWebRtcSettingsPopup()) {
            // Close this popup but show warning message
            warningMessageStore.addWarningMessage($LL.camera.webrtc.content());
            close();
        }
    });
</script>

<HelpCard
    icon="wifiOff"
    tone={$helpWebRtcSettingsVisibleStore === "error" ? "blocked" : "pending"}
    title={$helpWebRtcSettingsVisibleStore === "error" ? $QL.callRelayError() : $QL.callRelayPending()}
    body={$QL.callRelayFix()}
    placement="top"
    testId="quanta-call-relay"
>
    {#snippet extra()}
        <label>
            <input
                type="checkbox"
                bind:checked={notAskAgain}
                onchange={() => localUserStore.setNotAskAgainHelpWebRtcSettingsPopup(notAskAgain)}
            />
            {$QL.callRelayDontWarn()}
        </label>
    {/snippet}
    {#snippet actions()}
        <button type="button" onclick={close}>{$QL.blockedNotNow()}</button>
        <button type="button" class="primary" onclick={() => window.location.reload()}>{$QL.callRelayReload()}</button>
    {/snippet}
</HelpCard>
