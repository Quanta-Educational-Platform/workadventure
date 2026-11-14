<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { QUANTA_UI } from "../../Enum/EnvironmentVariable";
    import Notice from "../../quanta/Notice.svelte";
    import { toastStore } from "../../Stores/ToastStoreSingleton";
    import ToastContainer from "./ToastContainer.svelte";

    export let message: string;
    export let toastUuid = "";
    export let duration = 5000;
    export let theme: "success" | "error" | "secondary" = "error";

    // quanta: the notice has no timer of its own (ToastContainer's).
    let timer: ReturnType<typeof setTimeout> | undefined;
    onMount(() => {
        if (QUANTA_UI && toastUuid) timer = setTimeout(() => toastStore.removeToast(toastUuid), duration);
    });
    onDestroy(() => clearTimeout(timer));
</script>

<!-- quanta: the room's one notice shape (quanta/Notice.svelte). -->
{#if QUANTA_UI}
    <Notice
        tone={theme === "error" ? "problem" : "info"}
        text={message}
        ondismiss={toastUuid ? () => toastStore.removeToast(toastUuid) : undefined}
    />
{:else}
    <ToastContainer extraClasses="w-full min-w-72 max-w-sm sm:min-w-80 sm:max-w-md" {toastUuid} {duration} {theme}>
        <span>{message}</span>
    </ToastContainer>
{/if}
