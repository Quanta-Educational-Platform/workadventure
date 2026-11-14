<script lang="ts">
    // quanta: the room's own recording indicator (recordingIndicator.ts), the web header's capsule in the room's sizes:
    // red for "recording", a still grey for paused. `size`: the dock's row (44px, its label), the dock's own cell in a
    // narrow room, or the chat's head while a chat covers the room (28px). `space`: the width it has; where its words
    // would not fit (a language's longer label, a narrow room) it is the short form: the dot and "REC" on the dock
    // buttons' own grey (a red ground beside the red microphone and camera read as one more control), its words in the
    // tip and for screen readers.
    import { roomRecordingIndicatorStore } from "./recordingIndicator";

    let { size, space = Infinity }: { size: "row" | "cell" | "head"; space?: number } = $props();
    let recording = $derived($roomRecordingIndicatorStore);
    let natural = $state(0);
    let compact = $derived(size === "cell" || natural > space);
</script>

{#if recording}
    <!-- The words' form, out of sight: what it would take, measured in this language. -->
    <span class="rec {size} measure" aria-hidden="true" bind:clientWidth={natural}>
        <span class="dot"></span><span>{recording.label}</span>
    </span>
    <span
        class="rec {size}"
        class:compact
        class:paused={recording.paused}
        role="status"
        aria-label={compact ? recording.label : undefined}
        title={compact ? recording.label : recording.tip}
        data-tip={compact ? recording.label : undefined}
        data-testid="quanta-recording-indicator"
    >
        {#if recording.paused}<span class="pause" aria-hidden="true"><i></i><i></i></span>{:else}<span
                class="dot"
                aria-hidden="true"
            ></span>{/if}
        {#if compact}<span class="short" aria-hidden="true">REC</span>{:else}<span>{recording.label}</span>{/if}
    </span>
{/if}

<style>
    .rec {
        box-sizing: border-box;
        flex: none;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        height: 44px;
        padding: 0 16px 0 14px;
        border-radius: 9999px;
        background: rgb(229 72 77 / 0.2);
        box-shadow: inset 0 0 0 1px rgb(229 72 77 / 0.45);
        color: #fff;
        font-family: "Fira Sans", system-ui, sans-serif;
        font-size: 14px;
        font-weight: 500;
        line-height: 20px;
        white-space: nowrap;
    }

    /* The short form: as wide as its letters need, like the leave button beside its round neighbours. */
    .rec.compact {
        gap: 7px;
        padding: 0 14px 0 13px;
        background: #2b3038;
        box-shadow: none;
    }

    .short {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.06em;
        color: #eceef1;
    }

    .rec.compact.paused .short {
        color: #8b919b;
    }

    .rec.measure {
        position: absolute;
        visibility: hidden;
        pointer-events: none;
    }

    .rec.head {
        align-self: center;
        gap: 6px;
        height: 28px;
        padding: 0 10px;
        font-size: 12px;
    }

    .rec.head.compact {
        gap: 5px;
        padding: 0 9px 0 8px;
        background: rgb(255 255 255 / 0.1);
    }

    .rec.head .short {
        font-size: 11px;
    }

    .rec.paused {
        background: #2b3038;
        box-shadow: none;
        color: #a7adb7;
    }

    .rec.head.paused {
        background: rgb(255 255 255 / 0.1);
    }

    .dot {
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #e5484d;
        animation: rec-pulse 2s ease-in-out infinite;
    }

    .pause {
        flex: none;
        display: flex;
        gap: 3px;
    }

    .pause i {
        width: 3px;
        height: 10px;
        border-radius: 1px;
        background: currentColor;
    }

    @keyframes rec-pulse {
        50% {
            box-shadow: 0 0 0 4px rgb(229 72 77 / 0.25);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .dot {
            animation: none;
        }
    }
</style>
