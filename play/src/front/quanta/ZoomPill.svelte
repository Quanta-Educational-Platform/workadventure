<script lang="ts">
    // quanta: the map's zoom at hand, in the room window's bottom-right corner: closer, further, the whole room. The ⋮
    // menu keeps the same three for keyboards and screen readers.
    import { BUTTON_ZOOM_STEP_FACTOR } from "../Phaser/Game/CameraZoomUtils";
    import { gameManager } from "../Phaser/Game/GameManager";
    import { IconMinus, IconPlus, IconZoomInArea } from "../Components/Icons";
    import { QL } from "./i18n";

    const camera = () => gameManager.getCurrentGameScene().getCameraManager();
</script>

<div class="quanta-zoom-pill" data-testid="quanta-zoom-pill">
    <button
        type="button"
        title={$QL.zoomIn()}
        aria-label={$QL.zoomIn()}
        onclick={() => camera()?.smoothZoomByFactor(BUTTON_ZOOM_STEP_FACTOR)}
    >
        <IconPlus font-size="18" />
    </button>
    <button
        type="button"
        title={$QL.zoomOut()}
        aria-label={$QL.zoomOut()}
        onclick={() => camera()?.smoothZoomByFactor(1 / BUTTON_ZOOM_STEP_FACTOR)}
    >
        <IconMinus font-size="18" />
    </button>
    <span class="rule" aria-hidden="true"></span>
    <button
        type="button"
        title={$QL.zoomWholeRoom()}
        aria-label={$QL.zoomWholeRoom()}
        onclick={() => camera()?.refitRoom(true, true)}
    >
        <IconZoomInArea font-size="18" />
    </button>
</div>

<style>
    /* The dock's panel and buttons, small, in the corner of the room's window (above the dock, left of the chat). */
    .quanta-zoom-pill {
        position: fixed;
        z-index: 900;
        right: calc(24px + var(--quanta-chat-map, 0px));
        /* Above a notice that reaches across to it (QuantaDock.svelte measures it). */
        bottom: max(calc(108px + var(--quanta-chat-below, 0px)), var(--quanta-zoom-lift, 0px));
        transition: bottom 0.18s ease;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: 4px;
        /* Concentric: the buttons' 10px corner and the 4px around them. */
        border-radius: 14px;
        background: rgb(24 27 33 / 0.88);
        box-shadow: 0 2px 8px rgb(0 0 0 / 0.25);
        pointer-events: auto;
    }

    button {
        width: 32px;
        height: 32px;
        display: grid;
        place-items: center;
        border: 0;
        border-radius: 10px;
        background: transparent;
        color: #eceef1;
        cursor: pointer;
        transition: background 0.15s ease;
    }

    button:hover {
        background: #2b3038;
    }

    button:focus-visible {
        outline: 2px solid #c9d5ea;
        outline-offset: 1px;
    }

    .rule {
        width: 18px;
        height: 1px;
        margin: 2px 0;
        background: #3a3f48;
    }

    /* Not over a board or a share on the stage; phones pinch. */
    :global(html[data-quanta-stage]) .quanta-zoom-pill,
    :global(html[data-quanta-board-on]) .quanta-zoom-pill {
        display: none;
    }

    @media (max-width: 480px), (max-height: 480px) {
        .quanta-zoom-pill {
            display: none;
        }
    }
</style>
