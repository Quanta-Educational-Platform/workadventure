<script lang="ts">
    import { readable } from "svelte/store";
    import { LL } from "../../../i18n/i18n-svelte";
    import type { SpaceUserExtended } from "../../Space/SpaceInterface";
    import Woka from "../Woka/Woka.svelte";
    import Button from "../UI/Button.svelte";
    import { QUANTA_UI } from "../../Enum/EnvironmentVariable";
    import { QL } from "../../quanta/i18n";
    import HelpCard from "../../quanta/HelpCard.svelte";
    import PopUpContainer from "./PopUpContainer.svelte";

    interface Props {
        sender: SpaceUserExtended | undefined;
        message: string;
        kind?: "microphone" | "camera";
        acceptRequest: () => void;
        refuseRequest: () => void;
    }

    let { sender, message, kind = "microphone", acceptRequest, refuseRequest }: Props = $props();

    let pictureStore = $derived(sender ? sender.pictureStore : readable<string | undefined>(undefined));
</script>

{#if QUANTA_UI}
    <!-- quanta: who asks and for which device, on the room's compact card. -->
    <HelpCard
        icon={kind === "camera" ? "videocamOff" : "micOff"}
        tone="neutral"
        title={kind === "camera"
            ? sender
                ? $QL.muteAskCameraFrom({ name: sender.name })
                : $QL.muteAskCamera()
            : sender
              ? $QL.muteAskMicrophoneFrom({ name: sender.name })
              : $QL.muteAskMicrophone()}
        testId="quanta-mute-request"
    >
        {#snippet actions()}
            <button type="button" class="refuse-request" onclick={refuseRequest}>{$QL.muteKeepOn()}</button>
            <button type="button" class="primary accept-request" onclick={acceptRequest}>{$QL.muteTurnOff()}</button>
        {/snippet}
    </HelpCard>
{:else}
<PopUpContainer reduceOnSmallScreen={true}>
    <div class="interact-menu blue-dialog-box outline-light text-center w-72 pointer-events-auto m-auto">
        <div class="flex flex-row justify-center items-center">
            {#if sender}
                <div class="flex-0">
                    <Woka src={$pictureStore ?? ""} />
                    <div class="text-sm bold">{sender.name}</div>
                </div>
            {/if}
            <div class="flex-1">
                {message}
            </div>
        </div>
    </div>
    {#snippet buttons()}
        <Button
            class="btn-outline w-1/2 max-w-80 responsive-message refuse-request"
            onclick={(event) => {
                event.preventDefault();
                refuseRequest();
            }}
        >
            {$LL.follow.interactMenu.no()}
        </Button>
        <Button variant="secondary" class="w-1/2 max-w-80 responsive-message accept-request" onclick={acceptRequest}>
            {$LL.follow.interactMenu.yes()}
        </Button>
    {/snippet}
</PopUpContainer>
{/if}
