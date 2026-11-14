<script lang="ts">
    // quanta: a map script's banner (WA.ui.banner) as one of the room's notices: in Quanta's rooms that is the room
    // script's "recording started / paused / resumed" (web public/wa/quanta-button.js), told apart by its id.
    import { fly } from "svelte/transition";
    import { bannerStore } from "../Stores/GameStore";
    import { warningBannerStore } from "../Stores/MenuStore";
    import Notice from "./Notice.svelte";

    let { live = "polite" }: { live?: "polite" | "assertive" | "off" } = $props();

    const RECORDING_RED = "#c0392b";
    let banner = $derived($bannerStore);
    let recording = $derived(banner?.id === "quanta-recording");
    let paused = $derived(recording && banner?.bgColor !== undefined && banner.bgColor.toLowerCase() !== RECORDING_RED);
</script>

{#if banner}
    <div class="quanta-notice-slot" transition:fly={{ y: 12, duration: 200 }}>
        <Notice
            tone={recording && !paused ? "recording" : "info"}
            icon={recording ? (paused ? "paused" : "rec") : "info"}
            text={banner.text}
            {live}
            ondismiss={banner.closable || recording
                ? () => {
                      warningBannerStore.set(false);
                      bannerStore.set(null);
                  }
                : undefined}
            testid="quanta-room-banner"
        >
            {#if banner.link}
                <a href={banner.link.url} target="_blank" rel="noreferrer">{banner.link.label}</a>
            {/if}
        </Notice>
    </div>
{/if}
