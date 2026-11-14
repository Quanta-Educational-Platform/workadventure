<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import type { UserInputManager } from "../../Phaser/UserInput/UserInputManager";
    import Button from "../UI/Button.svelte";
    import { QUANTA_UI } from "../../Enum/EnvironmentVariable";
    import PopUpContainer from "./PopUpContainer.svelte";

    interface Props {
        message: string;
        click: () => void;
        userInputManager: UserInputManager;
    }

    let { message, click, userInputManager }: Props = $props();

    onMount(() => {
        userInputManager.addSpaceEventListener(click);
    });

    onDestroy(() => {
        userInputManager.removeSpaceEventListener(click);
    });
</script>

{#if QUANTA_UI}
    <!-- quanta: one button that says what it opens ("Open whiteboard"), not a card asking to "Open Website". -->
    <button type="button" class="quanta-open-site" onclick={click}>{message}</button>
{:else}
    <PopUpContainer reduceOnSmallScreen={true}>
        {message}
        {#snippet buttons()}
            <Button variant="secondary" size="sm" class="w-full max-w-96" onclick={click}>Open Website</Button>
        {/snippet}
    </PopUpContainer>
{/if}

<style>
    .quanta-open-site {
        display: block;
        pointer-events: auto;
        height: 44px;
        margin: 0 auto 12px;
        padding: 0 22px;
        border: 0;
        border-radius: 9999px;
        background: #c9d5ea;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
        font-size: 15px;
        font-weight: 600;
        color: #1d2b45;
        cursor: pointer;
    }

    .quanta-open-site:hover {
        background: #d8e1f0;
    }

    .quanta-open-site:focus-visible {
        outline: 2px solid #eceef1;
        outline-offset: 2px;
    }
</style>
