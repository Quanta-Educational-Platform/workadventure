<script lang="ts">
    // quanta: a menu page that is a website (profile, contact, a room script's page), filling the settings dialog's
    // content area. Registered with the scripting API when the page may use it, as WA's own menu does.
    import { onDestroy, onMount } from "svelte";
    import { iframeListener } from "../../Api/IframeListener";

    interface Props {
        src: string;
        title: string;
        allowApi: boolean;
        allow: string | undefined;
    }

    let { src, title, allowApi, allow }: Props = $props();

    let frame: HTMLIFrameElement | undefined = $state();
    let registered: HTMLIFrameElement | undefined;

    onMount(() => {
        if (allowApi && frame) {
            iframeListener.registerIframe(frame);
            registered = frame;
        }
    });

    onDestroy(() => {
        if (registered) iframeListener.unregisterIframe(registered);
    });
</script>

<iframe bind:this={frame} {src} {title} {allow} allowfullscreen data-testid="quanta-settings-frame"></iframe>

<style>
    iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        border-radius: 12px;
    }
</style>
