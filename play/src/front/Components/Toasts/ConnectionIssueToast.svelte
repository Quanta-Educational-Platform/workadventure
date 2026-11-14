<script lang="ts">
    import { QUANTA_UI } from "../../Enum/EnvironmentVariable";
    import Notice from "../../quanta/Notice.svelte";
    import LL from "../../../i18n/i18n-svelte";
    import ToastContainer from "./ToastContainer.svelte";
    import { IconNetworkOff } from "@wa-icons";

    interface Props {
        toastUuid?: string;
    }

    let { toastUuid = "" }: Props = $props();
</script>

<!-- quanta: the room's one notice shape (quanta/Notice.svelte). -->
{#if QUANTA_UI}
    <Notice tone="problem" icon="wifiOff" text={$LL.error.connectionRetry.unableConnect()} live="assertive" />
{:else}
    <ToastContainer theme="error" extraClasses="" {toastUuid}>
        <div class="px-1 flex items-center gap-2">
            <IconNetworkOff color="rgb(234, 110, 83)" />
            {$LL.error.connectionRetry.unableConnect()}
        </div>
    </ToastContainer>
{/if}
