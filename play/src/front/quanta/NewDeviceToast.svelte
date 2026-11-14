<script lang="ts">
    // quanta: a newly plugged-in microphone, camera or speaker offered as a toast with plain buttons, instead of
    // WA's speech bubble over the avatar with "[SPACE]" and "[ESCAPE]" in its text.
    import { QUANTA_UI } from "../Enum/EnvironmentVariable";
    import Button from "../Components/UI/Button.svelte";
    import ToastContainer from "../Components/Toasts/ToastContainer.svelte";
    import { toastStore } from "../Stores/ToastStoreSingleton";
    import Notice from "./Notice.svelte";
    import { QL } from "./i18n";

    interface Props {
        toastUuid: string;
        device: string;
        onUse: () => void;
        /** The notice's cross: away for this visit, the device not ignored for good. */
        onDismiss?: () => void;
        /** WA's own Ignore button (outside Quanta's rooms): ignored for good. */
        onIgnore?: () => void;
    }

    let { toastUuid, device, onUse, onDismiss = () => {}, onIgnore = () => {} }: Props = $props();

    function answer(event: MouseEvent, choice: () => void): void {
        event.stopPropagation();
        event.preventDefault();
        choice();
        toastStore.removeToast(toastUuid);
    }
</script>

<!-- quanta: the room's one notice shape (quanta/Notice.svelte). -->
{#if QUANTA_UI}
    <Notice
        tone="action"
        icon="settings"
        text={$QL.newDevice({ device })}
        action={$QL.useDevice()}
        onaction={() => {
            onUse();
            toastStore.removeToast(toastUuid);
        }}
        ondismiss={() => {
            onDismiss();
            toastStore.removeToast(toastUuid);
        }}
        testid="new-device-toast"
    />
{:else}
    <ToastContainer extraClasses="w-full min-w-72 max-w-sm sm:min-w-80 sm:max-w-md" theme="secondary" {toastUuid}>
        <p class="m-0 text-sm leading-snug text-white text-center">{$QL.newDevice({ device })}</p>
        {#snippet buttons()}
            <Button appearance="ghost" size="sm" class="flex-1" onclick={(event) => answer(event, onIgnore)}>
                {$QL.ignoreDevice()}
            </Button>
            <Button variant="secondary" size="sm" class="flex-1" onclick={(event) => answer(event, onUse)}>
                {$QL.useDevice()}
            </Button>
        {/snippet}
    </ToastContainer>
{/if}
