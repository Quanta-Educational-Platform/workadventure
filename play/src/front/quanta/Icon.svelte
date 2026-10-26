<script lang="ts">
    import { icons, type IconName } from "./icons";

    interface Props {
        name: IconName;
        size?: number;
    }

    let { name, size = 24 }: Props = $props();
</script>

<svg width={size} height={size} viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
    <path d={icons[name]} />
</svg>
