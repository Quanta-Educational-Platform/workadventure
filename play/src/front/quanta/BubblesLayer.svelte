<script lang="ts">
    // quanta: layout C's floating pieces (bubbles.ts). WA's own tiles are the bubbles (placed and shaped in
    // quanta-ui.css, only those on camera or talking shown); this draws the names under them, the face pile of everyone
    // else in the call, and the room's window while something is presented. Dragging any of them moves them to the
    // nearest corner of the stage, kept for next time; touches on them never reach the map, so dragging doesn't walk.
    import { onDestroy, untrack } from "svelte";
    import { derived, readable, type Readable } from "svelte/store";
    import { LL } from "../../i18n/i18n-svelte";
    import { oneLineStreamableCollectionStore } from "../Stores/OneLineStreamableCollectionStore";
    import type { VideoBox } from "../Space/VideoBox";
    import { roomModerationStore } from "./moderationBridge";
    import { QL } from "./i18n";
    import Icon from "./Icon.svelte";
    import { boxStateStore, picturesOf, type BoxState } from "./boxState";
    import { fullNamesStore, shownName } from "./fullNames";
    import { touchScreenManager } from "../Touch/TouchScreenManager";
    import { phoneLayoutStore, roomWindowInsets } from "./roomWindow";
    import {
        boardOnStageStore,
        boardTileStore,
        noticesAboveStore,
        otherPictureRect,
        pinBoard,
        pinRoom,
        stageStore,
    } from "./stage";
    import {
        bubbleSize,
        bubblesCornerStore,
        bubblesOnStore,
        bubblesParkedStore,
        nearestCorner,
        parkHeight,
        retellFloats,
        roomWindowCornerStore,
        roomWindowOnStore,
        tellFloats,
        type FloatShape,
    } from "./bubbles";

    let viewport = $state({ width: window.innerWidth, height: window.innerHeight });
    // The stage's insets move with the chat's column or band (sidePanel.ts says so with this event).
    let insets = $state(roomWindowInsets());
    const onResize = () => {
        viewport = { width: window.innerWidth, height: window.innerHeight };
        insets = roomWindowInsets();
    };
    const onReserve = () => (insets = roomWindowInsets());
    window.addEventListener("resize", onResize);
    window.addEventListener("quanta-chat-reserve", onReserve);

    const NAME_HEIGHT = 22;
    const NAME_GAP = 4;
    const BUBBLE_GAP = 10;
    // Under the board's own header and above its page bar, when the board is the stage.
    const BOARD_TOP = 60;
    const BOARD_BOTTOM = 72;

    let phone = $derived($phoneLayoutStore);
    let size = $derived(bubbleSize(viewport.width, viewport.height, phone));
    let pad = $derived(phone ? 8 : 12);
    let parked = $derived($bubblesParkedStore);
    let park = $derived(parkHeight(phone));
    // Parked, the bubbles are as tall as the band leaves them.
    let parkSize = $derived(park - 20);
    let boardOn = $derived($boardOnStageStore);
    // A phone's or tablet's joystick rests in the map's lower-left corner (MobileJoystick.ts: 104px, 14px in from the
    // map's window): while the map is the stage, what floats in that corner stands above it.
    const JOYSTICK_TOP = 14 + 104 + 8;
    let joystickLift = $derived(
        touchScreenManager.primaryTouchDevice && !$stageStore && !parked ? Math.max(0, JOYSTICK_TOP - pad) : 0,
    );

    // The call's people: those on camera or talking are bubbles (WA's tiles), the rest the face pile.
    let boxes = $derived($oneLineStreamableCollectionStore);
    let statesStore: Readable<BoxState[]> = $derived(
        // A copy each time: derived() hands back the same array, which a rune would take as unchanged.
        boxes.length ? derived(boxes.map(boxStateStore), (states) => [...states]) : readable([]),
    );
    let states = $derived($statesStore);
    let bubbleBoxes = $derived(
        boxes.filter((_, i) => {
            const state = states[i];
            return !!state && !state.share && (state.video || state.talking);
        }),
    );
    let pileBoxes = $derived(
        boxes.filter((_, i) => {
            const state = states[i];
            return !state || (!state.share && !state.video && !state.talking);
        }),
    );
    let talkingIds = $derived(new Set(boxes.filter((_, i) => states[i]?.talking).map((box) => box.uniqueId)));
    let localInPile = $derived(pileBoxes.some((box) => box.uniqueId === "-1"));
    // The pile names you first, then how many more: "You +2", or "+2" past the faces shown. The pictures are those of
    // the faces shown (you first), not of the call's first three.
    let pileFaceBoxes = $derived(
        [...pileBoxes].sort((a, b) => (a.uniqueId === "-1" ? -1 : b.uniqueId === "-1" ? 1 : 0)).slice(0, 3),
    );
    let pilePicturesStore: Readable<(string | undefined)[]> = $derived(picturesOf(pileFaceBoxes));
    let pilePictures = $derived($pilePicturesStore);
    let pileFaces = $derived(pileFaceBoxes.map((box, i) => ({ box, picture: pilePictures[i] })));
    let pileLabel = $derived(
        localInPile
            ? `${$LL.camera.my.nameTag()}${pileBoxes.length > 1 ? ` +${pileBoxes.length - 1}` : ""}`
            : pileBoxes.length === 1
              ? personName(pileBoxes[0])
              : pileBoxes.length > 3
                ? `+${pileBoxes.length - 3}`
                : "",
    );
    let people = $derived($roomModerationStore?.people.length ?? 0);

    function personName(box: VideoBox): string {
        const user = box.spaceUser;
        const name = shownName($fullNamesStore, user?.uuid, user?.name ?? "");
        if (box.uniqueId === "-1") return name;
        // As a call names people on its tiles: the first name and the last one's initial.
        const words = name.trim().split(/\s+/);
        return words.length > 1 ? `${words[0]} ${words[words.length - 1].charAt(0)}.` : name;
    }

    function initials(box: VideoBox): string {
        const words = (box.spaceUser?.name ?? "").trim().split(/\s+/).filter(Boolean);
        return words
            .slice(0, 2)
            .map((word) => word.charAt(0).toUpperCase())
            .join("");
    }

    // The stage the floating pieces keep to, with the board's header and page bar left clear when it is the stage. The
    // board stops above the notices over the dock (the platform is told how far up they reach), and so do they.
    let stage = $derived.by(() => {
        const top = insets.top + pad + (boardOn ? BOARD_TOP : 0);
        const foot = boardOn ? Math.max(insets.bottom, $noticesAboveStore ? $noticesAboveStore + 8 : 0) : insets.bottom;
        const bottom = foot + pad + (boardOn ? BOARD_BOTTOM : 0);
        return {
            x: insets.left + pad,
            y: top,
            width: Math.max(0, viewport.width - insets.left - insets.right - 2 * pad),
            height: Math.max(0, viewport.height - top - bottom),
        };
    });

    // Dragging: which piece, and how far it has moved.
    let shift = $state<{ kind: "bubbles" | "room"; x: number; y: number } | null>(null);

    // The room's window (a pill on a phone, or parked under a share).
    let roomPill = $derived(phone || parked);
    let roomBox = $derived.by(() => {
        if (!$roomWindowOnStore) return null;
        if (parked) {
            const height = 36;
            return {
                x: insets.left + pad,
                y: viewport.height - insets.bottom - (park + height) / 2,
                width: 0,
                height,
            };
        }
        const width = phone ? 0 : size === 88 ? 168 : 248;
        const height = phone ? 36 : size === 88 ? 104 : 152;
        // Never in the bubbles' corner (corners kept from before can meet): the window takes the one across from it.
        const kept = $roomWindowCornerStore;
        const corner = kept === $bubblesCornerStore ? `${kept.startsWith("t") ? "b" : "t"}${kept.charAt(1)}` : kept;
        const x = corner.endsWith("l") ? stage.x : stage.x + stage.width - width;
        const y = corner.startsWith("t")
            ? stage.y
            : stage.y + stage.height - height - (corner === "bl" ? joystickLift : 0);
        return { x, y, width, height };
    });
    let roomShift = $derived(shift?.kind === "room" ? shift : { x: 0, y: 0 });

    $effect(() => {
        if (!$bubblesOnStore) return;
        if (roomBox && !roomPill && $boardTileStore === null)
            otherPictureRect.set({
                x: roomBox.x + roomShift.x,
                y: roomBox.y + roomShift.y,
                width: roomBox.width,
                height: roomBox.height,
                cover: true,
                radius: 14,
            });
        else otherPictureRect.set(null);
    });

    // Where WA's tiles (the bubbles) sit: at their corner of the stage, or parked at the band's right end.
    let group = $derived.by(() => {
        if (parked) {
            return {
                top: null,
                left: null,
                right: insets.right + pad,
                bottom: insets.bottom + (park - parkSize) / 2,
                size: parkSize,
                corner: "br",
            };
        }
        const corner = $bubblesCornerStore;
        const right = corner.endsWith("r");
        const top = corner.startsWith("t");
        return {
            top: top ? stage.y : null,
            bottom: top
                ? null
                : viewport.height - stage.y - stage.height + NAME_HEIGHT + NAME_GAP + (right ? 0 : joystickLift),
            left: right ? null : stage.x,
            right: right ? viewport.width - stage.x - stage.width : null,
            size,
            corner,
        };
    });
    let groupShift = $derived(shift?.kind === "bubbles" ? shift : { x: 0, y: 0 });

    $effect(() => {
        const root = document.documentElement;
        if (!$bubblesOnStore) {
            delete root.dataset.quantaBubbles;
            delete root.dataset.quantaBubblesCorner;
            for (const name of [
                "--qb-top",
                "--qb-right",
                "--qb-bottom",
                "--qb-left",
                "--qb-size",
                "--qb-max-h",
                "--quanta-park-h",
            ])
                root.style.removeProperty(name);
            return;
        }
        root.dataset.quantaBubbles = parked ? "park" : "float";
        root.dataset.quantaBubblesCorner = group.corner;
        const px = (value: number | null) => (value === null ? "auto" : `${Math.round(value)}px`);
        root.style.setProperty("--qb-top", px(group.top));
        root.style.setProperty("--qb-right", px(group.right));
        root.style.setProperty("--qb-bottom", px(group.bottom));
        root.style.setProperty("--qb-left", px(group.left));
        root.style.setProperty("--qb-size", `${group.size}px`);
        // More bubbles than the stage is tall wrap into another column, inwards.
        root.style.setProperty("--qb-max-h", `${Math.max(group.size, stage.height - 48)}px`);
        root.style.setProperty("--quanta-park-h", parked ? `${park}px` : "0px");
    });
    $effect(() => {
        const root = document.documentElement;
        root.style.setProperty("--qb-shift-x", `${groupShift.x}px`);
        root.style.setProperty("--qb-shift-y", `${groupShift.y}px`);
    });

    // The bubbles as laid out (WA's tiles), measured: their names go under them, the pile after them.
    let measured = $state<{ id: string; x: number; y: number; width: number; height: number }[]>([]);
    let groupRect = $state<{ x: number; y: number; width: number; height: number } | null>(null);
    function measure(): void {
        const found: typeof measured = [];
        for (const element of document.querySelectorAll<HTMLElement>(
            "#cameras-container > .camera-box[data-quanta-box]",
        )) {
            const id = element.dataset.quantaBox ?? "";
            if (!bubbleBoxes.some((box) => box.uniqueId === id)) continue;
            const rect = element.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            // Without the drag's shift: names and the pile take it from the same CSS variables.
            found.push({
                id,
                x: rect.x - groupShift.x,
                y: rect.y - groupShift.y,
                width: rect.width,
                height: rect.height,
            });
        }
        const same =
            found.length === measured.length &&
            found.every(
                (item, i) =>
                    item.id === measured[i].id &&
                    Math.abs(item.x - measured[i].x) < 0.5 &&
                    Math.abs(item.y - measured[i].y) < 0.5 &&
                    Math.abs(item.width - measured[i].width) < 0.5,
            );
        if (!same) measured = found;
        report();
        if (!found.length) groupRect = null;
        else {
            const left = Math.min(...found.map((item) => item.x));
            const top = Math.min(...found.map((item) => item.y));
            const right = Math.max(...found.map((item) => item.x + item.width));
            const bottom = Math.max(...found.map((item) => item.y + item.height));
            const next = { x: left, y: top, width: right - left, height: bottom - top };
            if (
                !groupRect ||
                Math.abs(groupRect.x - next.x) + Math.abs(groupRect.y - next.y) >= 0.5 ||
                Math.abs(groupRect.width - next.width) + Math.abs(groupRect.height - next.height) >= 0.5
            )
                groupRect = next;
        }
    }
    let poll: ReturnType<typeof setInterval> | undefined;
    // Measured again whenever the bubbles or their place change.
    let measureKey = $derived(
        `${bubbleBoxes.map((box) => box.uniqueId).join(",")}|${group.corner}|${group.top}|${group.right}|${group.bottom}|${group.left}|${group.size}`,
    );
    $effect(() => {
        if (!$bubblesOnStore) {
            measured = [];
            groupRect = null;
            return;
        }
        if (!measureKey) return;
        untrack(measure);
        // And again once the new bubble is drawn (WA marks its tile a frame or two later).
        let frame = requestAnimationFrame(() => (frame = requestAnimationFrame(measure)));
        poll = setInterval(measure, 200);
        return () => {
            cancelAnimationFrame(frame);
            clearInterval(poll);
        };
    });

    // The pile: after the bubbles, away from their corner; parked, beside the room's pill on the band's left.
    let pileWidth = $state(0);
    let pileHeight = $state(0);
    let pile = $derived.by(() => {
        if (!pileBoxes.length) return null;
        if (parked) {
            const roomRight = roomBox ? roomBox.x + roomPillWidth + 8 : insets.left + pad;
            return { left: roomRight, top: viewport.height - insets.bottom - (park + pileHeight) / 2 };
        }
        const corner = group.corner;
        const right = corner.endsWith("r");
        const top = corner.startsWith("t");
        const anchorX = right ? stage.x + stage.width : stage.x;
        let y: number;
        // A bubble just added (someone started talking) is not drawn yet when it is first measured: the pile takes its
        // place by the bubble's size until it is, rather than standing in the corner the bubble is about to fill.
        const rect =
            groupRect ??
            (bubbleBoxes.length
                ? {
                      y: top
                          ? stage.y
                          : stage.y + stage.height - NAME_HEIGHT - NAME_GAP - (right ? 0 : joystickLift) - group.size,
                      height: group.size,
                  }
                : null);
        if (rect)
            y = top ? rect.y + rect.height + NAME_GAP + NAME_HEIGHT + BUBBLE_GAP : rect.y - BUBBLE_GAP - pileHeight;
        else y = top ? stage.y : stage.y + stage.height - pileHeight - (right ? 0 : joystickLift);
        return { left: right ? anchorX - pileWidth : anchorX, top: y };
    });

    let roomPillWidth = $state(0);

    // A name wider than its bubble stays inside the stage where the bubble stands at its edge.
    let nameWidths = $state<Record<string, number>>({});
    function nameLeft(centre: number, id: string): number {
        const half = (nameWidths[id] ?? 0) / 2;
        if (!half) return centre;
        return Math.min(Math.max(centre, stage.x + half), stage.x + stage.width - half);
    }

    // Shapes over the stage, for the board's holes, as drawn: each bubble and its name, the pile, the room's window.
    function floats(): FloatShape[] {
        const shapes: FloatShape[] = [];
        const add = (element: Element, radius: (rect: DOMRect) => number, grow = 0) => {
            const rect = element.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            shapes.push({
                x: rect.x - grow,
                y: rect.y - grow,
                w: rect.width + 2 * grow,
                h: rect.height + 2 * grow,
                r: radius(rect) + grow,
            });
        };
        for (const element of document.querySelectorAll("#cameras-container > .camera-box[data-quanta-box]"))
            add(element, (rect) => (element.matches("[data-quanta-share]") ? 14 : rect.width / 2), 3);
        for (const element of document.querySelectorAll(".qb-name, .qb-pile")) add(element, (rect) => rect.height / 2);
        for (const element of document.querySelectorAll(".qb-room"))
            add(element, (rect) => (element.classList.contains("pill") ? rect.height / 2 : 14));
        return shapes;
    }
    function report(): void {
        tellFloats($bubblesOnStore ? floats() : []);
    }
    $effect(() => {
        if (!$bubblesOnStore) tellFloats([]);
    });

    // Dragging the bubbles (any bubble, name or the pile) or the room's window to another corner.
    let drag: {
        kind: "bubbles" | "room";
        pointerId: number;
        startX: number;
        startY: number;
        target: Element;
        moved: boolean;
    } | null = null;
    const DRAG_THRESHOLD = 6;

    function dragKind(target: EventTarget | null): "bubbles" | "room" | null {
        if (!(target instanceof Element)) return null;
        if (target.closest(".qb-room")) return "room";
        if (target.closest(".qb-pile, .qb-name")) return "bubbles";
        const box = target.closest<HTMLElement>("#cameras-container > .camera-box");
        if (box && box.matches("[data-quanta-video], [data-quanta-talking]")) return "bubbles";
        return null;
    }

    function onPointerDown(event: PointerEvent): void {
        if (!$bubblesOnStore || parked || event.button > 0 || drag) return;
        const kind = dragKind(event.target);
        if (!kind || (kind === "room" && roomPill && !phone)) return;
        drag = {
            kind,
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            target: event.target as Element,
            moved: false,
        };
    }

    function onPointerMove(event: PointerEvent): void {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const x = event.clientX - drag.startX;
        const y = event.clientY - drag.startY;
        if (!drag.moved) {
            if (Math.hypot(x, y) < DRAG_THRESHOLD) return;
            drag.moved = true;
            try {
                drag.target.setPointerCapture(event.pointerId);
            } catch {
                // The pointer is already gone.
            }
        }
        event.preventDefault();
        shift = { kind: drag.kind, x, y };
        cancelAnimationFrame(dragFrame);
        dragFrame = requestAnimationFrame(report);
    }
    let dragFrame = 0;

    function onPointerUp(event: PointerEvent): void {
        if (!drag || event.pointerId !== drag.pointerId) return;
        const done = drag;
        drag = null;
        if (!done.moved) return;
        const moved = shift ?? { x: 0, y: 0 };
        shift = null;
        // The piece's middle where it was let go decides its corner.
        let centre: { x: number; y: number } | null = null;
        if (done.kind === "room" && roomBox) {
            const width = roomPill ? roomPillWidth : roomBox.width;
            centre = { x: roomBox.x + width / 2 + moved.x, y: roomBox.y + roomBox.height / 2 + moved.y };
        } else if (done.kind === "bubbles") {
            const rect =
                groupRect ?? (pile ? { x: pile.left, y: pile.top, width: pileWidth, height: pileHeight } : null);
            if (rect) centre = { x: rect.x + rect.width / 2 + moved.x, y: rect.y + rect.height / 2 + moved.y };
        }
        if (centre && event.type === "pointerup") {
            const corner = nearestCorner(centre.x, centre.y, stage);
            const bubbles = $bubblesCornerStore;
            const room = $roomWindowCornerStore;
            // Two pieces never share a corner: the one already there takes the other's place.
            if (done.kind === "bubbles") {
                if (corner === room) roomWindowCornerStore.set(bubbles);
                bubblesCornerStore.set(corner);
            } else {
                if (corner === bubbles) bubblesCornerStore.set(room);
                roomWindowCornerStore.set(corner);
            }
        }
        // The names and the pile follow the bubbles to their corner as soon as they are drawn there.
        requestAnimationFrame(() => requestAnimationFrame(measure));
        // The click that ends a drag opens nothing.
        const swallow = (click: Event) => {
            click.stopPropagation();
            click.preventDefault();
        };
        window.addEventListener("click", swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
    }

    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    window.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
    window.addEventListener("pointerup", onPointerUp, { capture: true });
    window.addEventListener("pointercancel", onPointerUp, { capture: true });

    // A platform that starts listening later (its frame reloaded) hears the shapes again with its first word.
    const onPlatformWord = (event: MessageEvent) => {
        if (event.data?.type === "quanta_wa_side_panel" && $bubblesOnStore) retellFloats();
    };
    window.addEventListener("message", onPlatformWord);

    onDestroy(() => {
        window.removeEventListener("resize", onResize);
        window.removeEventListener("quanta-chat-reserve", onReserve);
        window.removeEventListener("pointerdown", onPointerDown, { capture: true });
        window.removeEventListener("pointermove", onPointerMove, { capture: true });
        window.removeEventListener("pointerup", onPointerUp, { capture: true });
        window.removeEventListener("pointercancel", onPointerUp, { capture: true });
        window.removeEventListener("message", onPlatformWord);
        clearInterval(poll);
    });
</script>

{#if $bubblesOnStore}
    {#each measured as item (item.id)}
        {@const box = bubbleBoxes.find((candidate) => candidate.uniqueId === item.id)}
        {#if box}
            <!-- Floating, under its bubble; parked, left of it. -->
            <span
                class="qb-name"
                class:parked
                class:talking={talkingIds.has(item.id)}
                bind:offsetWidth={nameWidths[item.id]}
                style:left="{parked ? item.x - 6 : nameLeft(item.x + item.width / 2, item.id)}px"
                style:top="{parked ? item.y + item.height / 2 : item.y + item.height + NAME_GAP}px"
                style:translate={parked ? undefined : "var(--qb-shift-x, 0px) var(--qb-shift-y, 0px)"}
                >{personName(box)}</span
            >
        {/if}
    {/each}

    {#if pileBoxes.length}
        <div
            class="qb-pile"
            class:faces-only={!pileLabel}
            class:measuring={!pile || !pileWidth}
            style:left="{pile?.left ?? 0}px"
            style:top="{pile?.top ?? 0}px"
            style:translate={parked ? undefined : "var(--qb-shift-x, 0px) var(--qb-shift-y, 0px)"}
            bind:offsetWidth={pileWidth}
            bind:offsetHeight={pileHeight}
            title={parked ? undefined : $QL.bubblesMove()}
            data-testid="bubbles-pile"
        >
            <span class="qb-faces">
                {#each pileFaces as face (face.box.uniqueId)}
                    <span class="qb-face">
                        {#if face.picture}
                            <img src={face.picture} alt="" draggable="false" />
                        {:else}
                            {initials(face.box)}
                        {/if}
                    </span>
                {/each}
            </span>
            {#if pileLabel}<span class="qb-pile-label">{pileLabel}</span>{/if}
        </div>
    {/if}

    {#if roomBox}
        {@const board = $boardTileStore !== null}
        <button
            type="button"
            class="qb-room"
            class:pill={roomPill}
            class:board
            class:dragging={shift?.kind === "room"}
            style:left="{roomBox.x}px"
            style:top="{roomBox.y}px"
            style:width={roomPill ? undefined : `${roomBox.width}px`}
            style:height="{roomBox.height}px"
            style:translate="{roomShift.x}px {roomShift.y}px"
            bind:offsetWidth={roomPillWidth}
            aria-label={board ? $QL.stageShowBoard() : $QL.stageShowRoom()}
            title={parked ? undefined : $QL.bubblesMove()}
            data-testid={board ? "bubbles-board-window" : "bubbles-room-window"}
            onclick={board ? pinBoard : pinRoom}
        >
            {#if board && !roomPill}<span class="qb-board-icon"><Icon name="board" size={32} /></span>{/if}
            <span class="qb-room-label">
                <Icon name={board ? "board" : "map"} size={14} />
                <span class="qb-room-text"
                    >{board
                        ? $boardTileStore || $QL.stageBoard()
                        : `${$QL.stageRoom()}${people ? ` · ${people}` : ""}`}</span
                >
            </span>
        </button>
    {/if}
{/if}

<style>
    .qb-name {
        position: fixed;
        z-index: 46;
        transform: translateX(-50%);
        max-width: 160px;
        overflow: hidden;
        text-overflow: ellipsis;
        height: 22px;
        padding: 0 10px;
        border-radius: 999px;
        background: #1d2027;
        color: rgb(255 255 255 / 0.92);
        font-size: 12px;
        font-weight: 600;
        line-height: 22px;
        white-space: nowrap;
        pointer-events: auto;
        touch-action: none;
        cursor: grab;
        box-shadow: 0 2px 8px rgb(0 0 0 / 0.3);
    }

    .qb-name.parked {
        transform: translate(-100%, -50%);
        max-width: 96px;
    }

    .qb-name.talking {
        background: #80da88;
        color: #0b3d13;
    }

    .measuring {
        visibility: hidden;
    }

    .qb-pile {
        position: fixed;
        z-index: 46;
        display: inline-flex;
        align-items: center;
        gap: 8px;
        height: 36px;
        padding: 0 12px 0 4px;
        border-radius: 999px;
        background: #1d2027;
        color: rgb(255 255 255 / 0.92);
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
        pointer-events: auto;
        touch-action: none;
        cursor: grab;
        box-shadow: 0 2px 8px rgb(0 0 0 / 0.3);
    }

    /* Faces alone: the pill closes evenly around them. */
    .qb-pile.faces-only {
        padding: 0 4px;
    }

    .qb-faces {
        display: inline-flex;
    }

    .qb-face {
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        margin-left: -8px;
        overflow: hidden;
        border-radius: 999px;
        background: #2b3038;
        box-shadow: 0 0 0 2px #1d2027;
        color: #eceef1;
        font-size: 10px;
        font-weight: 700;
    }

    .qb-face:first-child {
        margin-left: 0;
    }

    /* The whole woka in the middle of its round face, pixels kept sharp (as in the folded strip). */
    .qb-face img {
        width: 24px;
        height: 24px;
        max-width: none;
        image-rendering: pixelated;
    }

    .qb-room {
        position: fixed;
        z-index: 46;
        box-sizing: border-box;
        padding: 0;
        border: 0;
        border-radius: 14px;
        background: transparent;
        cursor: pointer;
        pointer-events: auto;
        touch-action: none;
        box-shadow:
            inset 0 0 0 1px rgb(255 255 255 / 0.1),
            0 6px 18px rgb(0 0 0 / 0.35);
    }

    .qb-room:hover {
        box-shadow:
            inset 0 0 0 2px rgb(255 255 255 / 0.35),
            0 6px 18px rgb(0 0 0 / 0.35);
    }

    .qb-room.dragging {
        cursor: grabbing;
    }

    .qb-room.board {
        background: #c9d5ea;
        color: #1d2b45;
    }

    .qb-room.pill {
        display: inline-flex;
        align-items: center;
        padding: 0 14px 0 12px;
        border-radius: 999px;
        background: #1d2027;
    }

    .qb-room.pill.board {
        background: #c9d5ea;
    }

    .qb-board-icon {
        position: absolute;
        inset: 0 0 28px;
        display: grid;
        place-items: center;
        opacity: 0.75;
    }

    .qb-room-label {
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

    .pill .qb-room-label {
        position: static;
        max-width: none;
        padding: 0;
        background: transparent;
        color: inherit;
    }

    .qb-room.pill:not(.board) .qb-room-label {
        color: rgb(255 255 255 / 0.92);
    }

    .qb-room-text {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .qb-room:focus-visible {
        outline: 2px solid #c9d5ea;
        outline-offset: 2px;
    }
</style>
