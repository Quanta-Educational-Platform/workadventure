<script lang="ts">
    // quanta: layout A's cards (rail.ts). Beside the stage: the room's card (its picture while something is presented,
    // or the waiting board), then the call's card with WA's own tiles placed in it (quanta-ui.css), then the space
    // People or Chat open in. Under the stage on an upright screen: the room's tile leading the row of call tiles.
    import { onDestroy, untrack } from "svelte";
    import { get } from "svelte/store";
    import { roomModerationStore } from "./moderationBridge";
    import { QL } from "./i18n";
    import Icon from "./Icon.svelte";
    import { railRowStore, tileNamesStore } from "./layout";
    import { phoneLayoutStore } from "./roomWindow";
    import { sidePanelLayoutStore, sidePanelOpenStore, sidePanelReservedStore } from "./sidePanel";
    import { boardTileStore, otherPictureRect, pinBoard, pinRoom } from "./stage";
    import {
        RAIL,
        railCallFoldedStore,
        railInCallStore,
        railModeStore,
        railPanelTopStore,
        railRoomCardStore,
        railRoomFoldedStore,
        retellRail,
        tellRail,
    } from "./rail";

    let viewport = $state({ width: window.innerWidth, height: window.innerHeight });
    const onResize = () => (viewport = { width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);

    // WA's tiles, measured as laid out in the card: their own height (they scroll past the card's limit) and number.
    let tiles = $state({ height: 0, count: 0 });
    let observed: HTMLElement | null = null;
    const resize = new ResizeObserver(() => measure());
    function measure(): void {
        const container = document.getElementById("cameras-container");
        if (container !== observed) {
            if (observed) resize.unobserve(observed);
            observed = container;
            if (container) resize.observe(container);
        }
        const height = container ? Math.ceil(container.scrollHeight) : 0;
        const count = container
            ? container.querySelectorAll(":scope > .camera-box:not([data-quanta-share])").length
            : 0;
        if (height !== tiles.height || count !== tiles.count) tiles = { height, count };
    }
    // Tiles come and go with the call (a new camera's box a moment after its stream): looked up again while shown.
    let poll: ReturnType<typeof setInterval> | undefined;
    $effect(() => {
        if ($railModeStore !== "column" || !$railInCallStore || $railCallFoldedStore) {
            clearInterval(poll);
            poll = undefined;
            return;
        }
        untrack(measure);
        poll = setInterval(measure, 300);
        return () => {
            clearInterval(poll);
            poll = undefined;
        };
    });

    onDestroy(() => {
        window.removeEventListener("resize", onResize);
        resize.disconnect();
        clearInterval(poll);
    });

    let people = $derived($roomModerationStore?.people.length ?? 0);
    let margin = $derived($sidePanelLayoutStore.margin);
    let card = $derived($railRoomCardStore);

    // The column: each card's box in the frame, from the top.
    let column = $derived.by(() => {
        if ($railModeStore !== "column") return null;
        const width = $sidePanelLayoutStore.width;
        const x = viewport.width - margin - width;
        let y = margin;
        let room: { x: number; y: number; width: number; height: number; folded: boolean } | null = null;
        if (card) {
            const folded = $railRoomFoldedStore;
            const height = folded ? RAIL.foldedCard : Math.round(width * RAIL.roomAspect);
            room = { x, y, width, height, folded };
            y += height + margin;
        }
        let call: { x: number; y: number; width: number; height: number; tilesTop: number; tilesMax: number } | null =
            null;
        if ($railInCallStore) {
            const folded = $railCallFoldedStore;
            // An open People or Chat under the card keeps room to read: the tiles scroll past it.
            const panelRoom = $sidePanelOpenStore
                ? viewport.height - (y + RAIL.header + RAIL.tilePad + margin) - RAIL.panelMin - margin
                : Infinity;
            const tilesMax = Math.max(96, Math.min(Math.round(viewport.height * RAIL.tilesMaxShare), panelRoom));
            const tilesHeight = folded ? 0 : Math.min(tiles.height, tilesMax);
            const height = RAIL.header + (folded || !tilesHeight ? 0 : tilesHeight + RAIL.tilePad);
            call = { x, y, width, height, tilesTop: y + RAIL.header, tilesMax };
            y += height + margin;
        }
        return { x, width, room, call, panelTop: y };
    });

    // The band: the row's height, and where it starts above the dock and the open panel.
    let band = $derived.by(() => {
        if ($railModeStore !== "band" || (!card && !$railInCallStore)) return null;
        const height = $phoneLayoutStore ? RAIL.phoneRowHeight : RAIL.rowHeight;
        const dock = $phoneLayoutStore ? 84 : 96;
        const side = $sidePanelLayoutStore;
        const panel = $sidePanelReservedStore && side.below ? side.below + side.margin : 0;
        const roomWidth = card ? Math.round((height * 16) / 9) : 0;
        return { height, bottom: dock + panel, roomWidth, left: margin };
    });

    $effect(() => {
        const root = document.documentElement;
        const mode = $railModeStore;
        if (mode) root.dataset.quantaRail = mode;
        else delete root.dataset.quantaRail;
        root.toggleAttribute("data-quanta-rail-call-folded", mode === "column" && $railCallFoldedStore);
        root.toggleAttribute("data-quanta-rail-narrow", !!column && column.width < RAIL.threeAcross);
        const set = (name: string, value: number | null) =>
            value === null ? root.style.removeProperty(name) : root.style.setProperty(name, `${value}px`);
        set("--quanta-rail-x", column ? column.x + RAIL.tilePad : null);
        set("--quanta-rail-tiles-w", column ? column.width - 2 * RAIL.tilePad : null);
        set("--quanta-rail-tiles-top", column?.call ? column.call.tilesTop : null);
        set("--quanta-rail-tiles-max", column?.call ? column.call.tilesMax : null);
        set("--quanta-rail-row-h", band ? band.height : null);
        set("--quanta-rail-row-bottom", band ? band.bottom : null);
        set("--quanta-rail-row-left", band ? band.left + (band.roomWidth ? band.roomWidth + RAIL.tileGap : 0) : null);
        railRowStore.set(band ? band.height + margin : 0);
        tileNamesStore.set(!mode ? "full" : mode === "band" && $phoneLayoutStore ? "first" : "initial");
        railPanelTopStore.set(column ? column.panelTop : null);
        // The room's picture in its card (or the row's first tile), drawn by StageRoomTile.svelte.
        if (column?.room && card === "room" && !column.room.folded)
            otherPictureRect.set({
                x: column.room.x,
                y: column.room.y,
                width: column.room.width,
                height: column.room.height,
                cover: true,
                radius: 16,
            });
        else if (band && card === "room")
            otherPictureRect.set({
                x: band.left,
                y: viewport.height - band.bottom - band.height,
                width: band.roomWidth,
                height: band.height,
                cover: true,
                radius: 12,
            });
        else if (mode) otherPictureRect.set(null);
        tellRail(mode, column ? column.panelTop : 0, band ? band.height + margin : 0);
    });

    // Leaving layout A puts everything back as B and C expect it.
    $effect(() => {
        if ($railModeStore) return;
        const root = document.documentElement;
        delete root.dataset.quantaRail;
        root.removeAttribute("data-quanta-rail-call-folded");
        root.removeAttribute("data-quanta-rail-narrow");
        railRowStore.set(0);
        railPanelTopStore.set(null);
        tileNamesStore.set("full");
    });

    // A platform that starts listening later (its frame reloaded) asks with its first side panel word.
    const onPlatformLayout = (event: MessageEvent) => {
        if (event.data?.type === "quanta_wa_side_panel" && get(railModeStore)) retellRail();
    };
    window.addEventListener("message", onPlatformLayout);
    onDestroy(() => window.removeEventListener("message", onPlatformLayout));
</script>

{#if column}
    {#if column.room}
        {@const room = column.room}
        {#if room.folded}
            <div
                class="qr-card qr-folded"
                style:left="{room.x}px"
                style:top="{room.y}px"
                style:width="{room.width}px"
                style:height="{room.height}px"
                data-testid="rail-room-folded"
            >
                <button
                    type="button"
                    class="qr-folded-main"
                    aria-label={card === "board" ? $QL.stageShowBoard() : $QL.stageShowRoom()}
                    onclick={card === "board" ? pinBoard : pinRoom}
                >
                    <Icon name={card === "board" ? "board" : "map"} size={18} />
                    <span class="qr-folded-title"
                        >{card === "board" ? $boardTileStore || $QL.stageBoard() : $QL.stageRoom()}</span
                    >
                    {#if card === "room" && people}<span class="qr-muted">{$QL.railRoomPeople({ count: people })}</span
                        >{/if}
                </button>
                <button
                    type="button"
                    class="qr-fold"
                    aria-label={$QL.railUnfoldRoom()}
                    aria-expanded="false"
                    onclick={() => railRoomFoldedStore.set(false)}
                >
                    <span class="qr-chevron down"><Icon name="chevronUp" size={16} /></span>
                </button>
            </div>
        {:else}
            <button
                type="button"
                class="qr-card qr-room"
                class:board={card === "board"}
                style:left="{room.x}px"
                style:top="{room.y}px"
                style:width="{room.width}px"
                style:height="{room.height}px"
                aria-label={card === "board" ? $QL.stageShowBoard() : $QL.stageShowRoom()}
                data-testid={card === "board" ? "rail-board-card" : "rail-room-card"}
                onclick={card === "board" ? pinBoard : pinRoom}
            >
                {#if card === "board"}<span class="qr-board-icon"><Icon name="board" size={32} /></span>{/if}
                <span class="qr-label">
                    <Icon name={card === "board" ? "board" : "map"} size={14} />
                    <span class="qr-label-text"
                        >{card === "board"
                            ? $boardTileStore || $QL.stageBoard()
                            : `${$QL.stageRoom()}${people ? ` · ${people}` : ""}`}</span
                    >
                </span>
                <span class="qr-expand"><Icon name="expand" size={14} /></span>
            </button>
            <button
                type="button"
                class="qr-fold over"
                style:left="{room.x + 8}px"
                style:top="{room.y + 8}px"
                aria-label={$QL.railFoldRoom()}
                aria-expanded="true"
                onclick={() => railRoomFoldedStore.set(true)}
            >
                <span class="qr-chevron"><Icon name="chevronUp" size={16} /></span>
            </button>
        {/if}
    {/if}
    {#if column.call}
        {@const call = column.call}
        <div
            class="qr-card qr-call"
            style:left="{call.x}px"
            style:top="{call.y}px"
            style:width="{call.width}px"
            style:height="{call.height}px"
            data-testid="rail-call-card"
        >
            <div class="qr-call-head">
                <span class="qr-call-title">{$QL.railInCall({ count: Math.max(tiles.count, 1) })}</span>
                <button
                    type="button"
                    class="qr-fold"
                    aria-label={$railCallFoldedStore ? $QL.railUnfoldCall() : $QL.railFoldCall()}
                    aria-expanded={!$railCallFoldedStore}
                    onclick={() => railCallFoldedStore.set(!$railCallFoldedStore)}
                >
                    <span class="qr-chevron" class:down={$railCallFoldedStore}><Icon name="chevronUp" size={16} /></span
                    >
                </button>
            </div>
        </div>
    {/if}
{:else if band && card}
    <button
        type="button"
        class="qr-card qr-room qr-row-room"
        class:board={card === "board"}
        style:left="{band.left}px"
        style:bottom="{band.bottom}px"
        style:width="{band.roomWidth}px"
        style:height="{band.height}px"
        aria-label={card === "board" ? $QL.stageShowBoard() : $QL.stageShowRoom()}
        data-testid={card === "board" ? "rail-board-card" : "rail-room-card"}
        onclick={card === "board" ? pinBoard : pinRoom}
    >
        {#if card === "board"}<span class="qr-board-icon"><Icon name="board" size={24} /></span>{/if}
        <span class="qr-label">
            <Icon name={card === "board" ? "board" : "map"} size={14} />
            <span class="qr-label-text">{card === "board" ? $boardTileStore || $QL.stageBoard() : $QL.stageRoom()}</span
            >
        </span>
        {#if !$phoneLayoutStore}<span class="qr-expand"><Icon name="expand" size={14} /></span>{/if}
    </button>
{/if}

<style>
    .qr-card {
        position: fixed;
        box-sizing: border-box;
        pointer-events: auto;
        border-radius: 16px;
    }

    /* The room's picture is the map itself, drawn small under the card (StageRoomTile.svelte): the card is its frame. */
    .qr-room {
        z-index: 40;
        border: 0;
        padding: 0;
        background: transparent;
        cursor: pointer;
        box-shadow: inset 0 0 0 1px rgb(255 255 255 / 0.08);
    }

    .qr-room:hover {
        box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.35);
    }

    .qr-room.board {
        background: #c9d5ea;
        color: #1d2b45;
    }

    .qr-row-room {
        border-radius: 12px;
    }

    .qr-board-icon {
        position: absolute;
        inset: 0 0 28px;
        display: grid;
        place-items: center;
        opacity: 0.75;
    }

    .qr-label {
        position: absolute;
        left: 8px;
        bottom: 8px;
        max-width: calc(100% - 16px);
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 3px 10px;
        border-radius: 999px;
        background: rgb(16 18 23 / 0.8);
        color: rgb(255 255 255 / 0.92);
        font-size: 13px;
        font-weight: 600;
        line-height: 18px;
        white-space: nowrap;
    }

    .qr-label-text {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .qr-expand {
        position: absolute;
        top: 8px;
        right: 8px;
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 999px;
        background: rgb(16 18 23 / 0.8);
        color: rgb(255 255 255 / 0.92);
    }

    /* The call's card: WA's tiles are laid over it (quanta-ui.css), under its header. */
    .qr-call {
        z-index: 1;
        background: #1d2027;
    }

    .qr-call-head {
        display: flex;
        align-items: center;
        height: 40px;
        padding: 0 6px 0 16px;
        color: #a7adb7;
        font-size: 13px;
        font-weight: 600;
    }

    .qr-call-title {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .qr-folded {
        z-index: 40;
        display: flex;
        align-items: center;
        padding: 0 6px 0 0;
        background: #1d2027;
    }

    .qr-folded-main {
        flex: 1;
        min-width: 0;
        height: 100%;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 8px 0 16px;
        border: 0;
        border-radius: 16px;
        background: transparent;
        color: #eceef1;
        font-size: 14px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
    }

    .qr-folded-main:hover {
        background: rgb(255 255 255 / 0.05);
    }

    .qr-folded-title {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .qr-muted {
        color: #a7adb7;
        font-weight: 400;
    }

    .qr-fold {
        display: grid;
        place-items: center;
        flex: none;
        width: 32px;
        height: 32px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: #c4c7c5;
        cursor: pointer;
        pointer-events: auto;
    }

    .qr-fold:hover {
        background: rgb(255 255 255 / 0.08);
    }

    /* Over the room's picture, in its corner: on the dark of a round chip, like the card's other controls. */
    .qr-fold.over {
        position: fixed;
        z-index: 41;
        width: 28px;
        height: 28px;
        background: rgb(16 18 23 / 0.8);
        color: rgb(255 255 255 / 0.92);
    }

    .qr-fold.over:hover {
        background: rgb(16 18 23 / 0.92);
    }

    .qr-chevron {
        display: grid;
        transition: transform 0.15s;
    }

    .qr-chevron.down {
        transform: rotate(180deg);
    }

    .qr-room:focus-visible,
    .qr-fold:focus-visible,
    .qr-folded-main:focus-visible {
        outline: 2px solid #c9d5ea;
        outline-offset: 2px;
    }
</style>
