<script lang="ts">
    import { QUANTA_UI } from "../../Enum/EnvironmentVariable";
    import Notice from "../../quanta/Notice.svelte";
    import LL from "../../../i18n/i18n-svelte";
    import ToastContainer from "./ToastContainer.svelte";
    import { IconLoader, IconNetworkOff } from "@wa-icons";

    export let toastUuid = "";
</script>

<!-- quanta: the room's one notice shape (quanta/Notice.svelte). -->
{#if QUANTA_UI}
    <Notice tone="problem" icon="busy" testid="websocket-reconnecting-toast"
        ><b>{$LL.warning.connectionLostTitle()}</b> {$LL.messageScreen.connecting()}</Notice
    >
{:else}
    <ToastContainer theme="secondary" extraClasses="w-full min-w-72 max-w-sm sm:min-w-80 sm:max-w-md" {toastUuid}>
        <div class="flex items-center gap-3 text-left" data-testid="websocket-reconnecting-toast">
            <div class="relative flex h-8 w-8 shrink-0 items-center justify-center">
                <IconNetworkOff class="text-white/80" font-size="1.35rem" />
                <IconLoader class="absolute -right-1 -bottom-1 animate-spin text-secondary" font-size="1rem" />
            </div>
            <div class="flex min-w-0 flex-col">
                <p class="m-0 text-sm font-semibold leading-snug text-white">{$LL.warning.connectionLostTitle()}</p>
                <p class="m-0 text-xs leading-snug text-white/80">{$LL.messageScreen.connecting()}</p>
            </div>
        </div>
    </ToastContainer>
{/if}
