<script lang="ts">
    interface Props {
        checked: boolean;
        label: string;
        testId?: string;
        onchange: (checked: boolean) => void;
    }

    let { checked, label, testId, onchange }: Props = $props();
</script>

<button
    type="button"
    role="switch"
    class="qs-switch"
    class:on={checked}
    aria-checked={checked}
    aria-label={label}
    data-testid={testId}
    onclick={() => onchange(!checked)}
>
    <i></i>
</button>

<style>
    /* Material's switch without the tick: the knob grows and moves right when on, 4px inside the track. */
    .qs-switch {
        flex: none;
        position: relative;
        width: 52px;
        height: 32px;
        padding: 0;
        border: 0;
        border-radius: 9999px;
        background: transparent;
        box-shadow: inset 0 0 0 2px var(--qs-outline);
        cursor: pointer;
    }

    .qs-switch i {
        position: absolute;
        left: 8px;
        top: 8px;
        width: 16px;
        height: 16px;
        border-radius: 9999px;
        background: var(--qs-outline);
        transition:
            left 0.15s,
            top 0.15s,
            width 0.15s,
            height 0.15s;
    }

    /* On: Quanta's checked-control grey with a dark knob (Quanta's dark theme, --primary). */
    .qs-switch.on {
        background: #b9bec6;
        box-shadow: none;
    }

    .qs-switch.on i {
        left: 24px;
        top: 4px;
        width: 24px;
        height: 24px;
        background: #1b1e23;
    }
</style>
