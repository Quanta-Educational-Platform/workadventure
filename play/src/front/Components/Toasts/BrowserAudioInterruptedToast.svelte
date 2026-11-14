<script lang="ts">
    import { QUANTA_UI } from "../../Enum/EnvironmentVariable";
    import Notice from "../../quanta/Notice.svelte";
    import { LL } from "../../../i18n/i18n-svelte";
    import ToastContainer from "./ToastContainer.svelte";
</script>

<!-- quanta: the room's one notice shape (quanta/Notice.svelte). -->
{#if QUANTA_UI}
    <Notice tone="problem" icon="volumeOff" text={$LL.statusModal.audioPlaybackInterrupted()} />
{:else}
    <ToastContainer extraClasses="w-full min-w-72 max-w-sm sm:min-w-80 sm:max-w-md" theme="secondary">
        <div class="flex flex-col gap-2">
            <p class="m-0 text-sm leading-snug text-white text-center">
                {$LL.statusModal.audioPlaybackInterrupted()}
            </p>
        </div>
    </ToastContainer>
{/if}
