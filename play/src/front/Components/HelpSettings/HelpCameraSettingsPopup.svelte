<script lang="ts">
    // quanta: what is blocked, where this browser allows it, and a way to ask again or go on without it.
    import { onDestroy } from "svelte";
    import { QL } from "../../quanta/i18n";
    import HelpCard from "../../quanta/HelpCard.svelte";
    import { blockedRequestedStore, giveUpBlocked, requestBlockedAgain } from "../../quanta/blockedDevices";
    import { blockedFixText } from "../../quanta/blockedHelp";
    import { mediaPermissionDeniedStore } from "../../Stores/MediaStatusStore";

    // The devices the person wants; WA's own denied state when the help was opened from elsewhere.
    let blocked = $derived(
        $blockedRequestedStore.camera || $blockedRequestedStore.microphone
            ? $blockedRequestedStore
            : $mediaPermissionDeniedStore,
    );
    let both = $derived(blocked.camera && blocked.microphone);

    let title = $derived(
        both ? $QL.blockedCameraMicrophone() : blocked.camera ? $QL.blockedCamera() : $QL.blockedMicrophone(),
    );
    let device = $derived(
        both
            ? $QL.blockedDeviceCameraMicrophone()
            : blocked.camera
              ? $QL.blockedDeviceCamera()
              : $QL.blockedDeviceMicrophone(),
    );

    let stillBlocked = $state(false);
    let stillTimer: ReturnType<typeof setTimeout> | undefined;

    function tryAgain(): void {
        requestBlockedAgain();
        // Chrome and Firefox refuse at once while the setting says no: say so instead of seeming to do nothing.
        clearTimeout(stillTimer);
        stillTimer = setTimeout(() => {
            stillBlocked = true;
            stillTimer = setTimeout(() => (stillBlocked = false), 2500);
        }, 900);
    }

    onDestroy(() => clearTimeout(stillTimer));
</script>

<HelpCard
    icon={blocked.camera ? "videocamOff" : "micOff"}
    {title}
    body={blockedFixText($QL, device)}
    testId="quanta-media-blocked"
>
    {#snippet actions()}
        <button type="button" onclick={giveUpBlocked}>{$QL.blockedNotNow()}</button>
        <button type="button" class="primary" disabled={stillBlocked} onclick={tryAgain}>
            {stillBlocked ? $QL.blockedStill() : $QL.blockedTryAgain()}
        </button>
    {/snippet}
</HelpCard>
