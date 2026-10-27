<script lang="ts">
    import { icons, type IconName } from "./icons";

    interface Props {
        name: IconName;
        size?: number;
    }

    let { name, size = 24 }: Props = $props();
</script>

<svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
>
    {#each icons[name] as [tag, attrs], i (i)}
        <svelte:element this={tag} {...attrs} />
    {/each}
</svg>
