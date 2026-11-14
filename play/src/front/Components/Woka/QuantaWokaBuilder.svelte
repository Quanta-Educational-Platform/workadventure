<script lang="ts">
    // quanta: the builder for Quanta's own wokas (v3), the same parts and Randomize as Quanta's Settings page.
    import { IconShuffle } from "@wa-icons";
    import { LL } from "../../../i18n/i18n-svelte";
    import {
        randomLook,
        v3TextureId,
        WOKA_V3_PARTS,
        wokaV3Layer,
        type WokaV3Look,
        type WokaV3Part,
        type WokaV3Pick,
    } from "../../quanta/wokaV3";
    import WokaImage from "./WokaImage.svelte";
    import WokaPreview from "./WokaPreview.svelte";
    import type { WokaData } from "./WokaTypes";

    interface Props {
        look: WokaV3Look;
        wokaData: WokaData;
        getTextureUrl: (url: string) => string;
        onchange: (look: WokaV3Look) => void;
    }

    let { look, wokaData, getTextureUrl, onchange }: Props = $props();

    /** The face first, the clothes after. */
    const TABS: WokaV3Part[] = ["hair", "eyes", "skin", "top", "bottoms", "shoes", "glasses"];
    /** Each part's tiles show the part itself, close up, on the student's own woka. */
    const CROP: Record<WokaV3Part, { x: number; y: number; w: number; h: number }> = {
        skin: { x: 4, y: 0, w: 24, h: 20 },
        hair: { x: 2, y: 0, w: 28, h: 24 },
        eyes: { x: 9, y: 11, w: 14, h: 7 },
        glasses: { x: 7, y: 9, w: 18, h: 9 },
        top: { x: 6, y: 17, w: 20, h: 11 },
        bottoms: { x: 8, y: 22, w: 16, h: 10 },
        shoes: { x: 9, y: 26, w: 14, h: 6 },
    };
    const SCALE: Record<WokaV3Part, number> = { skin: 2, hair: 2, eyes: 4, glasses: 3, top: 3, bottoms: 3, shoes: 4 };

    let part: WokaV3Part = $state("hair");
    const layer = $derived(wokaV3Layer(part));
    const pick = $derived(look[part]);

    function textures(shown: WokaV3Look): Record<string, string> {
        const out: Record<string, string> = {};
        for (const p of WOKA_V3_PARTS) {
            const chosen = shown[p];
            if (chosen) out[wokaV3Layer(p).key] = v3TextureId(p, chosen);
        }
        return out;
    }

    function tile(next: WokaV3Pick | null): Record<string, string> {
        const shown: WokaV3Look = { ...look, [part]: next };
        // Close-ups leave out what would crowd the part: hair and glasses around the eyes.
        if (part === "eyes" || part === "glasses") shown.hair = null;
        if (part === "eyes") shown.glasses = null;
        return textures(shown);
    }

    function choose(next: WokaV3Pick | null) {
        onchange({ ...look, [part]: next });
    }

    function label(group: "parts" | "names" | "eyeColours" | "hairColours" | "clothColours", id: string): string {
        const strings = $LL.woka.customWoka[group] as unknown as Record<string, (() => string) | undefined>;
        return strings[id]?.() ?? id;
    }

    function colourLabel(id: string, index: number): string {
        if (part === "skin") return $LL.woka.customWoka.skinTone({ n: index + 1 });
        return label(part === "eyes" ? "eyeColours" : part === "hair" ? "hairColours" : "clothColours", id);
    }
</script>

<div class="flex-1 flex flex-col sm:flex-row items-start gap-4 sm:gap-6 min-h-0 p-4 sm:p-6">
    <div class="flex flex-row sm:flex-col items-center gap-3 w-full sm:w-fit">
        <WokaPreview selectedTextures={textures(look)} {wokaData} {getTextureUrl} />
        <button
            type="button"
            class="quanta-woka-randomize flex flex-row items-center justify-center gap-2 px-4 py-2 rounded bg-white/10 hover:bg-white/20 text-white w-full"
            onclick={() => onchange(randomLook())}
        >
            <IconShuffle font-size="18" class="text-white" />
            <span>{$LL.woka.customWoka.randomize()}</span>
        </button>
    </div>

    <div class="flex flex-col flex-1 h-full min-h-0 min-w-0 w-full">
        <div role="tablist" class="flex flex-row w-full overflow-x-auto mb-3 shrink-0">
            {#each TABS as p (p)}
                <button
                    type="button"
                    role="tab"
                    aria-selected={part === p}
                    class="flex-1 px-3 py-2 whitespace-nowrap border-b-2 {part === p
                        ? 'text-white border-white'
                        : 'text-white/50 border-white/10 hover:text-white/80'}"
                    style="border-bottom-style: solid;"
                    onclick={() => (part = p)}
                >
                    {label("parts", p)}
                </button>
            {/each}
        </div>

        <!-- The ring round the chosen colour reaches 4px past its swatch: the scroller keeps that much room on every side
             (taken back by its margins), or it cut the ring off at its left and top edges. -->
        <div class="flex-1 min-h-0 overflow-y-auto -mx-1 -mt-1 pl-1 pt-1 pr-2">
            {#if part !== "skin"}
                <div role="radiogroup" class="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-2 mb-4">
                    {#if layer.optional}
                        <button
                            type="button"
                            role="radio"
                            aria-checked={!pick}
                            title={$LL.woka.customWoka.noGlasses()}
                            aria-label={$LL.woka.customWoka.noGlasses()}
                            class="quanta-woka-tile flex h-[68px] items-center justify-center overflow-hidden border border-solid {!pick
                                ? 'bg-white/50 border-white'
                                : 'bg-white/10 hover:bg-white/20 border-transparent'}"
                            onclick={() => choose(null)}
                        >
                            <WokaImage
                                selectedTextures={tile(null)}
                                {wokaData}
                                {getTextureUrl}
                                crop={CROP[part]}
                                scale={SCALE[part]}
                            />
                        </button>
                    {/if}
                    {#each layer.styles as style (style.id)}
                        {@const next = { style: style.id, colour: pick?.colour ?? layer.colours[0].id }}
                        <button
                            type="button"
                            role="radio"
                            aria-checked={pick?.style === style.id}
                            title={label("names", style.id)}
                            aria-label={label("names", style.id)}
                            class="quanta-woka-tile flex h-[68px] items-center justify-center overflow-hidden border border-solid {pick?.style ===
                            style.id
                                ? 'bg-white/50 border-white'
                                : 'bg-white/10 hover:bg-white/20 border-transparent'}"
                            onclick={() => choose(next)}
                        >
                            <WokaImage
                                selectedTextures={tile(next)}
                                {wokaData}
                                {getTextureUrl}
                                crop={CROP[part]}
                                scale={SCALE[part]}
                            />
                        </button>
                    {/each}
                </div>
            {/if}
            <div role="radiogroup" class="flex flex-row flex-wrap gap-2 pb-2">
                {#each layer.colours as colour, i (colour.id)}
                    <button
                        type="button"
                        role="radio"
                        aria-checked={pick?.colour === colour.id}
                        title={colourLabel(colour.id, i)}
                        aria-label={colourLabel(colour.id, i)}
                        class="quanta-woka-swatch size-8 border border-solid border-white/30"
                        class:quanta-woka-swatch-on={pick?.colour === colour.id}
                        style="background-color: {colour.swatch};"
                        onclick={() => choose({ style: pick?.style ?? layer.styles[0].id, colour: colour.id })}
                    ></button>
                {/each}
            </div>
        </div>
    </div>
</div>

<style>
    .quanta-woka-tile {
        border-radius: 8px;
    }
    .quanta-woka-swatch {
        border-radius: 9999px;
    }
    .quanta-woka-swatch:hover {
        box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.35);
    }
    .quanta-woka-swatch-on,
    .quanta-woka-swatch-on:hover {
        box-shadow:
            0 0 0 2px #1b1f2a,
            0 0 0 4px #ffffff;
    }
</style>
