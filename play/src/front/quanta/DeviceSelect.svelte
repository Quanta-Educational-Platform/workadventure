<script lang="ts">
    import { clickOutside } from "svelte-outside";
    import { listboxKeys, openOnArrows } from "./listboxKeys";
    import Icon from "./Icon.svelte";
    import type { IconName } from "./icons";

    interface Props {
        icon: IconName;
        label: string;
        devices: MediaDeviceInfo[];
        selectedId: string | undefined;
        fallbackLabel: (index: number) => string;
        onselect: (deviceId: string) => void;
        testId?: string;
    }

    let { icon, label, devices, selectedId, fallbackLabel, onselect, testId }: Props = $props();

    let open = $state(false);
    let button: HTMLButtonElement | undefined = $state();

    function closeList(refocus: boolean): void {
        open = false;
        if (refocus) button?.focus();
    }

    const deviceLabel = (device: MediaDeviceInfo, index: number) => device.label || fallbackLabel(index + 1);
    let selectedIndex = $derived(devices.findIndex((device) => device.deviceId === selectedId));
    let current = $derived(selectedIndex >= 0 ? deviceLabel(devices[selectedIndex], selectedIndex) : label);
</script>

<div class="qd-select" use:clickOutside={() => (open = false)}>
    <button
        type="button"
        class="qd-select-button"
        bind:this={button}
        use:openOnArrows={() => (open = true)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        title={current}
        data-testid={testId}
        onclick={() => (open = !open)}
    >
        <Icon name={icon} size={20} />
        <span>{current}</span>
        <Icon name="dropDown" size={22} />
    </button>
    {#if open}
        <ul class="qd-list" role="listbox" aria-label={label} use:listboxKeys={closeList}>
            {#each devices as device, index (device.deviceId)}
                <li role="option" aria-selected={device.deviceId === selectedId}>
                    <button
                        type="button"
                        onclick={() => {
                            onselect(device.deviceId);
                            closeList(true);
                        }}
                    >
                        <span class="qd-check">
                            {#if device.deviceId === selectedId}<Icon name="check" size={20} />{/if}
                        </span>
                        <span>{deviceLabel(device, index)}</span>
                    </button>
                </li>
            {/each}
        </ul>
    {/if}
</div>
