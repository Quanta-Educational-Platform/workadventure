<script lang="ts">
    // quanta: the class screen's three layouts in the dock's ⋮ menu (layout.ts). The choice applies at once, for this
    // person only, and closes the menu: a pick is final.
    import Icon from "./Icon.svelte";
    import type { IconName } from "./icons";
    import { QL } from "./i18n";
    import { openedMenuStore } from "../Stores/MenuStore";
    import { chooseRoomLayout, roomLayoutStore, type RoomLayout } from "./layout";

    const options: { layout: RoomLayout; icon: IconName; label: () => string }[] = [
        { layout: "a", icon: "layoutRail", label: () => $QL.layoutRail() },
        { layout: "b", icon: "layoutStrip", label: () => $QL.layoutStrip() },
        { layout: "c", icon: "layoutBubbles", label: () => $QL.layoutBubbles() },
    ];
</script>

<div class="ql-rule" aria-hidden="true"></div>
<div role="group" aria-labelledby="quanta-layout-heading" data-testid="quanta-layout-menu">
    <p class="ql-heading" id="quanta-layout-heading">{$QL.layoutHeading()}</p>
    {#each options as option (option.layout)}
        <button
            type="button"
            role="menuitemradio"
            aria-checked={$roomLayoutStore === option.layout}
            class="ql-option"
            class:on={$roomLayoutStore === option.layout}
            data-testid={`quanta-layout-${option.layout}`}
            onclick={() => {
                chooseRoomLayout(option.layout);
                openedMenuStore.close("profileMenu");
            }}
        >
            <span class="ql-icon"><Icon name={option.icon} size={20} /></span>
            <span class="ql-label">{option.label()}</span>
            {#if $roomLayoutStore === option.layout}<span class="ql-check"><Icon name="check" size={18} /></span>{/if}
        </button>
    {/each}
</div>
<div class="ql-rule" aria-hidden="true"></div>

<style>
    .ql-rule {
        height: 1px;
        margin: 8px 0;
        background: #3a3f48;
    }

    .ql-heading {
        margin: 0;
        padding: 6px 16px 4px;
        color: #a7adb7;
        font-size: 12px;
        font-weight: 500;
        line-height: 16px;
    }

    .ql-option {
        display: flex;
        align-items: center;
        width: 100%;
        text-align: start;
        cursor: pointer;
    }

    .ql-icon {
        display: grid;
        place-items: center;
        width: 24px;
        flex: none;
    }

    .ql-label {
        flex: 1;
        min-width: 0;
    }

    .ql-check {
        display: grid;
        place-items: center;
        flex: none;
    }

    /* The chosen one: its pictogram and tick in the room's on-colour. */
    .ql-option.on .ql-icon :global(svg),
    .ql-check :global(svg) {
        color: #c9d5ea;
    }

    .ql-option:focus-visible {
        outline: 2px solid #c9d5ea;
        outline-offset: -2px;
    }
</style>
