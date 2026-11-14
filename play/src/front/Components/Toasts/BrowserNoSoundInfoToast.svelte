<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { QUANTA_UI } from "../../Enum/EnvironmentVariable";
    import Notice from "../../quanta/Notice.svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import { userActivationManager } from "../../Stores/UserActivationStore";
    import { audioPlaybackStore } from "../../Stores/AudioPlaybackStore";
    import Button from "../UI/Button.svelte";
    import ToastContainer from "./ToastContainer.svelte";

    let isRetrying = $state(false);

    function retryPlayback(): void {
        userActivationManager.notifyUserActivation();
        isRetrying = true;
        audioPlaybackStore
            .retryAll()
            .catch((error: unknown) => {
                console.error("Could not restart blocked audio playback", error);
                if (error instanceof AggregateError) {
                    for (const individualError of error.errors) {
                        console.error("Individual error:", individualError);
                    }
                }
            })
            .finally(() => {
                isRetrying = false;
            });
    }

    const abortController = new AbortController();

    onMount(() => {
        const events = ["keydown", "touchend", "pointerdown"];
        for (const event of events) {
            window.addEventListener(
                event,
                () => {
                    retryPlayback();
                },
                {
                    capture: true,
                    once: true,
                    signal: abortController.signal,
                },
            );
        }
    });

    onDestroy(() => {
        abortController.abort();
    });
</script>

<!-- quanta: the room's one notice shape (quanta/Notice.svelte). -->
{#if QUANTA_UI}
    <Notice
        tone="action"
        icon="volumeOff"
        text={$LL.statusModal.audioPlaybackBlocked()}
        action={$LL.statusModal.turnSoundOn()}
        actionDisabled={isRetrying}
        onaction={retryPlayback}
        testid="audio-playback-blocked-toast"
    />
{:else}
    <ToastContainer extraClasses="w-full min-w-72 max-w-sm sm:min-w-80 sm:max-w-md" theme="secondary">
        <div class="flex flex-col gap-2">
            <p class="m-0 text-sm leading-snug text-white text-center">
                {$LL.statusModal.audioPlaybackBlocked()}
            </p>
        </div>
        {#snippet buttons()}
            <Button
                type="button"
                variant="secondary"
                size="sm"
                class="flex-1"
                dataTestId="audio-playback-retry"
                disabled={isRetrying}
                onclick={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    retryPlayback();
                }}
            >
                {$LL.statusModal.turnSoundOn()}
            </Button>
        {/snippet}
    </ToastContainer>
{/if}
