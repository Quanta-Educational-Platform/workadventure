<script lang="ts">
    import { fly } from "svelte/transition";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { LL } from "../../../i18n/i18n-svelte";
    import Button from "../UI/Button.svelte";
    import { QUANTA_UI } from "../../Enum/EnvironmentVariable";
    import { mapCredits, quantaAssetCredits } from "../../quanta/mapCredits";
    import { QL } from "../../quanta/i18n";

    let expandedMapCopyright = $state(false);
    let expandedTilesetCopyright = $state(false);
    let expandedAudioCopyright = $state(false);

    const credits = $derived(
        mapCredits(gameManager.getCurrentGameScene().mapFile, QUANTA_UI ? quantaAssetCredits($QL) : []),
    );
    const mapName = $derived(credits.name);
    const mapLink = $derived(credits.link);
    const mapDescription = $derived(credits.description);
    const mapCopyright = $derived(credits.mapCopyright ?? $LL.menu.about.copyrights.map.empty());
    const tilesetCopyright = $derived(credits.tilesets);
    const audioCopyright = $derived(credits.audio);
</script>

<div class="about-room-main text-center py-8" transition:fly={{ x: -700, duration: 250 }}>
    <h2 class="h4 light">{$LL.menu.about.mapInfo()}</h2>
    <section class="container-overflow p-0">
        <h3 class="h5 text-white/50">{mapName}</h3>
        <p class="whitespace-pre-line italic text-white/50">{mapDescription}</p>
        {#if mapLink}
            <Button href={mapLink} variant="secondary" size="sm" class="uppercase inline-block" target="_blank"
                >{$LL.menu.about.mapLink()}</Button
            >
        {/if}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="mt-4 text-lg font-bold flex items-center py-4 px-8 border-y border-x-0 border-solid border-white/20 {expandedMapCopyright
                ? 'bg-secondary'
                : 'bg-contrast/50 hover:bg-contrast'}"
            onclick={() => (expandedMapCopyright = !expandedMapCopyright)}
        >
            <div class="grow text-left">{$LL.menu.about.copyrights.map.title()}</div>
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class={expandedMapCopyright ? "rotate-180" : ""}
                width="24"
                height="24"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="#ffffff"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                <path d="M6 9l6 6l6 -6" />
            </svg>
        </div>
        <p class="whitespace-pre-line" hidden={!expandedMapCopyright}>{mapCopyright}</p>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="text-lg font-bold flex items-center py-4 px-8 border-y-0 border-x-0 border-b border-solid border-white/20 {expandedTilesetCopyright
                ? 'bg-secondary'
                : 'bg-contrast/50 hover:bg-contrast'}"
            onclick={() => (expandedTilesetCopyright = !expandedTilesetCopyright)}
        >
            <div class="grow text-left">{$LL.menu.about.copyrights.tileset.title()}</div>
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class={expandedTilesetCopyright ? "rotate-180" : ""}
                width="24"
                height="24"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="#ffffff"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                <path d="M6 9l6 6l6 -6" />
            </svg>
        </div>
        <section hidden={!expandedTilesetCopyright}>
            {#each tilesetCopyright as copyright (copyright)}
                <p class="whitespace-pre-line">{copyright}</p>
            {:else}
                <p>{$LL.menu.about.copyrights.tileset.empty()}</p>
            {/each}
        </section>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="text-lg font-bold flex items-center py-4 px-8 border-y-0 border-x-0 border-b border-solid border-white/20 {expandedAudioCopyright
                ? 'bg-secondary'
                : 'bg-contrast/50 hover:bg-contrast'}"
            onclick={() => (expandedAudioCopyright = !expandedAudioCopyright)}
        >
            <div class="grow text-left">{$LL.menu.about.copyrights.audio.title()}</div>
            <svg
                xmlns="http://www.w3.org/2000/svg"
                class={expandedAudioCopyright ? "rotate-180" : ""}
                width="24"
                height="24"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="#ffffff"
                fill="none"
                stroke-linecap="round"
                stroke-linejoin="round"
            >
                <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                <path d="M6 9l6 6l6 -6" />
            </svg>
        </div>
        <section hidden={!expandedAudioCopyright}>
            {#each audioCopyright as copyright (copyright)}
                <p class="whitespace-pre-line">{copyright}</p>
            {:else}
                <p>{$LL.menu.about.copyrights.audio.empty()}</p>
            {/each}
        </section>
    </section>
</div>
