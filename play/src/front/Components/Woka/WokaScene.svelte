<script lang="ts">
    import { onDestroy, onMount } from "svelte";
    import { SelectCharacterSceneName } from "../../Phaser/Login/SelectCharacterScene";
    import { areCharacterTexturesValid } from "../../Connection/LocalUserUtils";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { gameManager } from "../../Phaser/Game/GameManager";
    import { connectionManager } from "../../Connection/ConnectionManager";
    import { selectCharacterSceneVisibleStore } from "../../Stores/SelectCharacterStore";
    import WokaSelectScene from "./WokaSelectScene.svelte";
    import WokaCustomizeScene from "./WokaCustomizeScene.svelte";

    // quanta: the builder, always: the ready-made wokas are retired (a pick of one opens the builder on a new woka)
    let buildOwnWoka = $state(true);
    let error: string | null = $state(null);

    async function saveAndContinue(texturesId: string[]) {
        error = null; // Reset error message
        try {
            if (!areCharacterTexturesValid(texturesId)) {
                error = "Invalid character textures";
                return;
            }

            analyticsClient.trackAdminEvent("onboarding.woka_validated", { scene: "SelectWoka" });
            gameManager.setCharacterTextureIds(texturesId);
            await connectionManager.saveTextures(texturesId);
            selectCharacterSceneVisibleStore.set(false);
            gameManager.tryToStopScene(SelectCharacterSceneName);
            gameManager.goToNextScene(SelectCharacterSceneName);
        } catch (err) {
            console.error("Error saving textures:", err);
            error = "Failed to save character customization";
        }
    }

    // Function to handle keyboard navigation
    function useKeyboardNavigation(event: KeyboardEvent) {
        if (event.key === "Escape") {
            event.preventDefault();
            buildOwnWoka = false; // Go back to the selection scene
        }
    }

    let mounted = $state(false);

    onMount(() => {
        mounted = true;
        // Add keyboard navigation listener
        window.addEventListener("keydown", useKeyboardNavigation);
    });

    onDestroy(() => {
        mounted = false;
        // Clean up the scene visibility store when the component is destroyed
        selectCharacterSceneVisibleStore.set(false);
        // Remove keyboard navigation listener
        window.removeEventListener("keydown", useKeyboardNavigation);
    });
</script>

{#if mounted}
    {#if buildOwnWoka}
        <WokaCustomizeScene back={() => (buildOwnWoka = false)} {saveAndContinue} />
    {:else}
        <WokaSelectScene customize={() => (buildOwnWoka = true)} {saveAndContinue} />
    {/if}
{/if}

{#if error}
    <p class="text-center text-danger-800 p-0 m-0">{error}</p>
{/if}
