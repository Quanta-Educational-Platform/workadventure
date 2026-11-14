<script lang="ts">
    // quanta: the strip's first tile (stage.ts). While a board is on the class's stage it is the room: the map keeps
    // running at its own size and only its picture is drawn small here (a transform on the canvas), so the game itself
    // never changes; the tile asks for the room back. With the room back on the stage it is the waiting board, which
    // asks for the board back. A button at the strip's end folds it to a row of faces.
    import { onDestroy } from "svelte";
    import { roomModerationStore } from "./moderationBridge";
    import { QL } from "./i18n";
    import Icon from "./Icon.svelte";
    import { phoneLayoutStore, roomWindowInsets } from "./roomWindow";

    import { roomLayoutStore } from "./layout";
    import {
        boardTileStore,
        callTilesStore,
        otherPictureRect,
        pinBoard,
        pinRoom,
        setStripCollapsed,
        stageStore,
        stageTileStore,
        stripCollapsedStore,
        stripStore,
    } from "./stage";

    let viewport = $state({ width: window.innerWidth, height: window.innerHeight });
    const onResize = () => (viewport = { width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    onDestroy(() => window.removeEventListener("resize", onResize));

    // The map's window (quanta-ui.css), scaled whole into the tile and centred in it: the canvas, not the room's
    // controls around it. The game's own layer of names over the canvas (Phaser's DOM layer) is hidden meanwhile rather
    // than moved with it: Phaser keeps its scale in that layer's `transform` and rewrites it only on a resize or zoom,
    // so writing or clearing it left every name unscaled (huge, far from its person) until the next one. The canvas
    // moves by the separate `translate` and `scale` properties for the same reason.
    $effect(() => {
        const game = document.getElementById("game");
        const canvas = game?.querySelector<HTMLCanvasElement>(":scope > canvas");
        if (!canvas) return;
        const names = canvas.previousElementSibling instanceof HTMLElement ? canvas.previousElementSibling : null;
        const clear = () => {
            for (const name of ["translate", "scale", "transform-origin", "clip-path", "visibility"])
                canvas.style.removeProperty(name);
            names?.style.removeProperty("visibility");
        };
        // A phone switches between board and room in the page's top bar: no picture of the room in the strip, and the
        // map stays out of sight under the board rather than showing round the strip's tiles.
        if ($phoneLayoutStore && $roomLayoutStore === "b" && $stageStore) {
            clear();
            canvas.style.visibility = "hidden";
            names?.style.setProperty("visibility", "hidden");
            return clear;
        }
        // B draws it in the strip's first tile; A and C say where (their room card, their floating window).
        const tile = $stageTileStore;
        const rect =
            $roomLayoutStore === "b"
                ? $stageStore
                    ? { x: tile.gap, y: tile.gap, width: tile.width, height: tile.height }
                    : null
                : $otherPictureRect;
        if (!rect) {
            clear();
            return;
        }
        const insets = roomWindowInsets();
        const width = Math.max(1, viewport.width - insets.left - insets.right);
        const height = Math.max(1, viewport.height - insets.top - insets.bottom);
        // Whole in B's tile; A's card and C's window are filled, the map's middle cut to their shape.
        const cover = "cover" in rect && rect.cover === true;
        const scale = (cover ? Math.max : Math.min)(rect.width / width, rect.height / height);
        const x = rect.x + (rect.width - width * scale) / 2 - insets.left * scale;
        const y = rect.y + (rect.height - height * scale) / 2 - insets.top * scale;
        // The card's box in the canvas's own (unscaled) pixels: what of it shows.
        const clip = cover
            ? `inset(${(rect.y - y) / scale}px ${viewport.width - (rect.x + rect.width - x) / scale}px ${
                  viewport.height - (rect.y + rect.height - y) / scale
              }px ${(rect.x - x) / scale}px round ${("radius" in rect ? (rect.radius ?? 0) : 0) / scale}px)`
            : undefined;
        canvas.style.transformOrigin = "0 0";
        canvas.style.translate = `${x}px ${y}px`;
        canvas.style.scale = `${scale}`;
        if (clip) canvas.style.clipPath = clip;
        else canvas.style.removeProperty("clip-path");
        names?.style.setProperty("visibility", "hidden");
        return clear;
    });

    let people = $derived($roomModerationStore?.people.length ?? 0);
    let folded = $derived($stripCollapsedStore);
</script>

{#if $stripStore}
    {#if $phoneLayoutStore}
        <!-- The page's top bar switches between board and room on a phone. -->
    {:else if $stageStore}
        <button
            type="button"
            class="quanta-strip-tile"
            class:folded
            style:left="{$stageTileStore.gap}px"
            style:top="{$stageTileStore.gap}px"
            style:width="{$stageTileStore.width}px"
            style:height="{$stageTileStore.height}px"
            aria-label={$QL.stageShowRoom()}
            data-testid="stage-room-tile"
            onclick={pinRoom}
        >
            <span class="quanta-strip-label">
                <Icon name="map" size={14} />
                {$QL.stageRoom()}{people ? ` · ${people}` : ""}
            </span>
            {#if !folded}<span class="quanta-strip-expand"><Icon name="expand" size={14} /></span>{/if}
        </button>
    {:else if $boardTileStore !== null && !folded}
        <!-- Folded, the board waits without a pill of its own: the page's header already offers the way back to it. -->
        <button
            type="button"
            class="quanta-strip-tile board"
            class:folded
            style:left="{$stageTileStore.gap}px"
            style:top="{$stageTileStore.gap}px"
            style:width="{$stageTileStore.width}px"
            style:height="{$stageTileStore.height}px"
            aria-label={$QL.stageShowBoard()}
            data-testid="stage-board-tile"
            onclick={pinBoard}
        >
            {#if !folded}<span class="quanta-strip-board-icon"><Icon name="board" size={28} /></span>{/if}
            <span class="quanta-strip-label">
                <Icon name="board" size={14} />
                <span class="quanta-strip-label-text">{$boardTileStore || $QL.stageBoard()}</span>
            </span>
            {#if !folded}<span class="quanta-strip-expand"><Icon name="expand" size={14} /></span>{/if}
        </button>
    {/if}
    <!-- A phone out of a call has nothing in the strip to fold (stage.ts reports it empty). -->
    {#if !$phoneLayoutStore || $callTilesStore > 0}
        <button
            type="button"
            class="quanta-strip-fold"
            style:top="{$stageTileStore.gap + ($stageTileStore.height - 28) / 2}px"
            aria-label={folded ? $QL.stripUnfold() : $QL.stripFold()}
            aria-pressed={folded}
            data-testid="strip-fold"
            onclick={() => setStripCollapsed(!folded)}
        >
            <span class="quanta-strip-fold-icon" class:down={folded}><Icon name="chevronUp" size={16} /></span>
        </button>
    {/if}
{/if}

<style>
    .quanta-strip-tile {
        position: fixed;
        z-index: 40;
        /* The layout around it lets clicks through to the map. */
        pointer-events: auto;
        border-radius: 12px;
        border: 0;
        padding: 0;
        background: transparent;
        cursor: pointer;
        box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.08);
    }

    .quanta-strip-tile.board {
        background: #c9d5ea;
        color: #1d2b45;
    }

    /* Folded: a pill naming the room or the board; the map's picture is not drawn behind it. */
    .quanta-strip-tile.folded {
        border-radius: 999px;
        background: #1d2027;
    }

    .quanta-strip-tile.board.folded {
        background: #c9d5ea;
    }

    .quanta-strip-tile:hover {
        box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.35);
    }

    .quanta-strip-tile:focus-visible,
    .quanta-strip-fold:focus-visible {
        outline: 2px solid #c9d5ea;
        outline-offset: 2px;
    }

    .quanta-strip-label {
        position: absolute;
        left: 6px;
        bottom: 6px;
        max-width: calc(100% - 12px);
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        border-radius: 999px;
        background: rgb(16 18 23 / 0.78);
        color: rgb(255 255 255 / 0.92);
        font-size: 12px;
        font-weight: 600;
        line-height: 18px;
        white-space: nowrap;
    }

    .quanta-strip-label-text {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .folded .quanta-strip-label {
        inset: 0;
        justify-content: center;
        max-width: none;
        background: transparent;
    }

    .board.folded .quanta-strip-label {
        color: #1d2b45;
    }

    .quanta-strip-board-icon {
        position: absolute;
        inset: 0 0 26px;
        display: grid;
        place-items: center;
        opacity: 0.75;
    }

    .quanta-strip-expand {
        position: absolute;
        top: 6px;
        right: 6px;
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        border-radius: 999px;
        background: rgb(16 18 23 / 0.78);
        color: rgb(255 255 255 / 0.92);
    }

    .quanta-strip-fold {
        position: fixed;
        z-index: 40;
        right: calc(12px + var(--quanta-chat-map, 0px));
        pointer-events: auto;
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border: 0;
        border-radius: 999px;
        background: #2b3038;
        color: #eceef1;
        cursor: pointer;
    }

    .quanta-strip-fold:hover {
        background: #353b45;
    }

    .quanta-strip-fold-icon {
        display: grid;
        transition: transform 0.15s;
    }

    .quanta-strip-fold-icon.down {
        transform: rotate(180deg);
    }
</style>
