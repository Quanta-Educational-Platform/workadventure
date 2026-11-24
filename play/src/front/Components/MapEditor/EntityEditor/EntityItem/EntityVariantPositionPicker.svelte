<script lang="ts">
    import type { EntityPrefab } from "@workadventure/map-editor";
    import { QL } from "../../../../quanta/i18n";

    interface Props {
        entityPrefabsPositions: EntityPrefab[];
        selectedEntity: EntityPrefab;
        onPickItem: (entity: EntityPrefab) => void;
        /** quanta: the row's name; "Positions" when none is given. */
        label?: string;
    }

    let { entityPrefabsPositions, selectedEntity, onPickItem, label }: Props = $props();
</script>

{#if entityPrefabsPositions.length > 1}
    <p class="m-0 text-xxs">{label ?? $QL.piecePositions()}</p>
    <div class="flex flex-row gap-2">
        {#each entityPrefabsPositions as item (item.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="hover:cursor-pointer" onclick={() => onPickItem(item)}>
                <img
                    draggable="false"
                    class={`hover:cursor-pointer item-image max-w-[32px] ${
                        item.imagePath === selectedEntity?.imagePath ? "border-solid border-yellow-400 rounded-sm" : ""
                    }`}
                    src={item.imagePath}
                    alt={item.name}
                />
            </div>
        {/each}
    </div>
{/if}
