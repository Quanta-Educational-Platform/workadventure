<script lang="ts">
    // quanta: above the dock, whether the class hears the person on air, who staff have on air and in what state, a
    // colleague on air with a weak link (staff), and the first-time hint about the tables' megaphone spots.
    import type { WeakLinkNotice } from "../Livekit/WeakLinkNotice";
    import type { PresenterWeakNotice } from "./presenterLink";
    import Notice from "./Notice.svelte";
    import { QL } from "./i18n";
    import { nameTag } from "./nameTag";
    import { audibleSpeakers, visibleSpeakers, type OnAirPrompt } from "./onAir";
    import { laneShows, laneStore, offerLane, LANE_RANK, type LaneOffer } from "./lane";
    import LaneMore from "./LaneMore.svelte";

    interface Speaker {
        id: string;
        name: string;
        muted?: boolean;
        talking?: boolean;
        quiet?: boolean;
    }

    interface Props {
        /** This person on air, as they are told; nothing when they are not on air or need not be told. */
        prompt: OnAirPrompt | undefined;
        staff: boolean;
        levels: number[];
        speakers: Speaker[];
        /** On a spot, but they have to step off and back on before they can speak to the class. */
        stepAgain: boolean;
        megaphoneHint: boolean;
        /** Talking with nobody in earshot: who is told what to do about it. */
        notHeard: boolean;
        ondismissnotheard: () => void;
        /** The room's width less a margin: the dock is centred in the room, not the window. */
        maxWidth: number;
        micToggleDisabled: boolean;
        onmicon: () => void;
        onaudiosettings: () => void;
        ondismissquiet: () => void;
        ondismisshint: () => void;
        /** This person's own weak link (Livekit/WeakLinkNotice.ts): the blue notice, as a call app shows it. */
        weakLink?: WeakLinkNotice;
        oncameraon?: () => void;
        ondismissweaklink?: () => void;
        /** The page can present a board now: a weak share's notice to staff offers it (presentBoardBridge.ts). */
        presentBoard?: boolean;
        onpresentboard?: () => void;
        /** Staff: a colleague on air to the class has a weak link (presenterLink.ts). */
        presenterWeak?: PresenterWeakNotice;
        /** This person can go on air to the class now: the notice offers it. */
        canTakeOver?: boolean;
        ontakeover?: () => void;
        ondismisspresenterweak?: () => void;
        noticesHidden?: boolean;
        /** Free ground beside the dock (QuantaDock.svelte): the notices stand there when they fit it, above the dock if not. */
        ground?: { side: "left" | "right"; width: number; maxHeight: number };
    }

    let {
        prompt,
        staff,
        levels,
        speakers,
        stepAgain,
        megaphoneHint,
        notHeard,
        ondismissnotheard,
        maxWidth,
        micToggleDisabled,
        onmicon,
        onaudiosettings,
        ondismissquiet,
        ondismisshint,
        weakLink = undefined,
        oncameraon = () => {},
        ondismissweaklink = () => {},
        presentBoard = false,
        onpresentboard = () => {},
        presenterWeak = undefined,
        canTakeOver = false,
        ontakeover = () => {},
        ondismisspresenterweak = () => {},
        noticesHidden = false,
        ground = undefined,
    }: Props = $props();

    let weakLinkText = $derived.by(() => {
        switch (weakLink?.kind) {
            case "linkCameraOn":
                return $QL.weakLinkCameraOn();
            case "linkCameraOff":
                return $QL.weakLinkCameraOff();
            case "share":
                return staff ? $QL.weakScreenShareStaff() : $QL.weakScreenShare();
            case "cameraOff":
                return weakLink.better ? $QL.weakLinkCameraBetter() : $QL.weakLinkCameraTurnedOff();
            default:
                return undefined;
        }
    });

    let presenterWeakText = $derived(presenterWeak ? $QL.presenterWeakLink({ name: presenterWeak.name }) : undefined);

    let audible = $derived(audibleSpeakers(speakers));
    let list = $derived(visibleSpeakers(audible));
    let speakerLine = $derived.by(() => {
        if (audible.length === 0) return undefined;
        if (audible.length === 1) return $QL.speakerOnAir({ name: nameTag(audible[0].name) });
        const names = list.shown.map((speaker) => nameTag(speaker.name));
        const tail = list.more > 0 ? $QL.moreOnAir({ count: list.more }) : `${$QL.speakerAnd()} ${names.pop()}`;
        return $QL.speakersOnAir({ names: `${names.join(", ")} ${tail}` });
    });

    // Under a board these share one row with the room's notices (lane.ts): each says what it weighs.
    let offered = $derived.by(() => {
        const list: LaneOffer[] = [];
        if (noticesHidden) return list;
        if (weakLinkText)
            list.push({
                key: "strip:weak",
                rank: weakLink?.kind === "cameraOff" && weakLink.better ? LANE_RANK.action : LANE_RANK.problem,
            });
        if (presenterWeakText) list.push({ key: "strip:presenterWeak", rank: LANE_RANK.problem });
        if (prompt === "heard") list.push({ key: "strip:heard", rank: LANE_RANK.heard });
        else if (prompt === "micBlocked") list.push({ key: "strip:micBlocked", rank: LANE_RANK.problem });
        else if (prompt) list.push({ key: `strip:${prompt}`, rank: LANE_RANK.actOnAir });
        if (speakerLine) list.push({ key: "strip:speakers", rank: LANE_RANK.speakers });
        if (stepAgain) list.push({ key: "strip:stepAgain", rank: LANE_RANK.actOnAir });
        if (notHeard && !prompt) list.push({ key: "strip:notHeard", rank: LANE_RANK.hint });
        if (megaphoneHint && !prompt) list.push({ key: "strip:megaphoneHint", rank: LANE_RANK.hint });
        return list;
    });
    $effect(() => offerLane("strip", offered));
    const shows = (key: string) => laneShows($laneStore, key);

    // Beside the dock unless what is shown is taller than the ground there: then above it until what is shown changes,
    // so the two placements don't take turns. Judged on the settled height, unseen meanwhile: a notice measures itself
    // into its stacked form a frame after it appears (Notice.svelte).
    let height = $state(0);
    let shownKey = $derived(
        [
            weakLinkText,
            presenterWeakText,
            prompt,
            speakerLine,
            stepAgain,
            megaphoneHint,
            notHeard,
            ground?.side,
            ground?.width,
        ].join("|"),
    );
    let tooTallFor: string | undefined = $state();
    let fitsFor: string | undefined = $state();
    // Being on air is the megaphone's own line: always above the dock, over the button it belongs to; passing notices
    // (a warning, a hint) may stand beside the dock.
    let placed = $derived(ground && tooTallFor !== shownKey && prompt !== "heard" ? ground : undefined);
    let checking = $derived(placed !== undefined && fitsFor !== shownKey);
    $effect(() => {
        if (!checking || !placed) return;
        const key = shownKey;
        const limit = placed.maxHeight;
        const timer = setTimeout(() => {
            if (height > limit) tooTallFor = key;
            else fitsFor = key;
        }, 350);
        return () => clearTimeout(timer);
    });
    // Once beside the dock, a notice that grows past the ground there (it wraps into its stacked form, a longer line
    // comes in) goes above the dock, rather than reaching past the window's foot.
    $effect(() => {
        if (placed && !checking && height > placed.maxHeight + 1) tooTallFor = shownKey;
    });
</script>

{#if offered.some((offer) => shows(offer.key))}
    <!-- Clear of the zoom column, which stands level with it at the map's right edge, except on a phone's full width. -->
    <div
        class="qs"
        class:beside-left={placed?.side === "left"}
        class:beside-right={placed?.side === "right"}
        class:checking
        bind:clientHeight={height}
        style:width={`${placed ? placed.width : Math.max(Math.min(maxWidth > 456 ? maxWidth - 144 : maxWidth, 760), 200)}px`}
        data-testid="quanta-on-air-strip"
    >
        {#if weakLinkText && shows("strip:weak")}
            <div class="qs-row">
                <Notice
                    tone={weakLink?.kind === "cameraOff" && weakLink.better ? "action" : "problem"}
                    icon={weakLink?.kind === "cameraOff" && weakLink.better ? "videocam" : "wifiOff"}
                    text={weakLinkText}
                    action={weakLink?.kind === "cameraOff"
                        ? $QL.cameraOn()
                        : weakLink?.kind === "share" && staff && presentBoard
                          ? $QL.presentBoardInstead()
                          : undefined}
                    onaction={weakLink?.kind === "cameraOff" ? oncameraon : onpresentboard}
                    ondismiss={ondismissweaklink}
                    testid="quanta-weak-link"
                />
                <LaneMore key="strip:weak" />
            </div>
        {/if}

        {#if presenterWeakText && shows("strip:presenterWeak")}
            <div class="qs-row">
                <Notice
                    tone="problem"
                    icon="wifiOff"
                    text={presenterWeakText}
                    action={canTakeOver ? $QL.speakToClass() : undefined}
                    actionIcon="campaign"
                    onaction={ontakeover}
                    ondismiss={ondismisspresenterweak}
                    testid="quanta-presenter-weak-link"
                />
                <LaneMore key="strip:presenterWeak" />
            </div>
        {/if}

        {#if prompt && shows(`strip:${prompt}`)}
            <div class="qs-row">
                {#if prompt === "heard"}
                    <Notice
                        icon="campaign"
                        text={staff ? $QL.onAirHeardStaff() : $QL.onAirHeard()}
                        testid="quanta-on-air-heard"
                    >
                        {#snippet trailing()}
                            <span class="qs-level" aria-hidden="true">
                                {#each levels as level, i (i)}
                                    <i style:--level={level}></i>
                                {/each}
                            </span>
                        {/snippet}
                    </Notice>
                {:else if prompt === "micOff"}
                    <Notice
                        tone="action"
                        icon="micOff"
                        live="assertive"
                        text={staff ? $QL.onAirMicOffStaff() : $QL.onAirMicOffPrompt()}
                        action={$QL.microphoneOn()}
                        actionIcon="mic"
                        actionDisabled={micToggleDisabled}
                        onaction={onmicon}
                        testid="quanta-on-air-mic-off"
                    />
                {:else if prompt === "micBlocked"}
                    <Notice
                        tone="problem"
                        icon="micOff"
                        live="assertive"
                        text={$QL.onAirMicBlocked()}
                        testid="quanta-on-air-mic-blocked"
                    />
                {:else if prompt === "quiet"}
                    <Notice
                        tone="problem"
                        icon="mic"
                        text={$QL.onAirQuiet()}
                        action={$QL.audioSettings()}
                        onaction={onaudiosettings}
                        ondismiss={ondismissquiet}
                        testid="quanta-on-air-quiet"
                    />
                {/if}
                <LaneMore key={`strip:${prompt}`} />
            </div>
        {/if}

        {#if speakerLine && shows("strip:speakers")}
            <div class="qs-row">
                <Notice icon="campaign" text={speakerLine} testid="quanta-on-air-speakers">
                    {#snippet trailing()}
                        <!-- Three still dots while nobody talks: the line keeps its width and its end stays filled. -->
                        <span
                            class="qs-level"
                            class:talking={audible.some((speaker) => speaker.talking)}
                            class:quiet={!audible.some((speaker) => speaker.talking)}
                            aria-hidden="true"><i></i><i></i><i></i></span
                        >
                    {/snippet}
                </Notice>
                <LaneMore key="strip:speakers" />
            </div>
        {/if}

        {#if stepAgain && shows("strip:stepAgain")}
            <div class="qs-row">
                <Notice tone="action" icon="campaign" text={$QL.onAirStepAgain()} testid="quanta-spot-step-again" />
                <LaneMore key="strip:stepAgain" />
            </div>
        {/if}

        {#if notHeard && !prompt && shows("strip:notHeard")}
            <div class="qs-row">
                <Notice
                    icon="volumeOff"
                    text={staff ? $QL.notHeardStaff() : $QL.notHeardStudent()}
                    ondismiss={ondismissnotheard}
                    testid="quanta-not-heard"
                />
                <LaneMore key="strip:notHeard" />
            </div>
        {/if}

        {#if megaphoneHint && !prompt && shows("strip:megaphoneHint")}
            <div class="qs-row">
                <Notice
                    icon="campaign"
                    text={$QL.megaphoneHint()}
                    ondismiss={ondismisshint}
                    testid="quanta-megaphone-hint"
                />
                <LaneMore key="strip:megaphoneHint" />
            </div>
        {/if}
    </div>
{/if}

<style>
    /* Above the dock, centred on it, in the room's notice shape (Notice.svelte); they wrap rather than cut off. Inside
       the room window, as far above its lower edge as the zoom pill (12px): the window ends 96px above the screen's
       bottom (84px on a phone, quanta-ui.css) and the dock 12px (8px in a narrow room), whatever the dock's height. */
    .qs {
        --qs-window: 96px;
        --qs-dock: 12px;
        position: absolute;
        left: 50%;
        bottom: calc(var(--qs-window) + 12px - var(--qs-dock) + var(--quanta-chat-below, 0px));
        transform: translateX(-50%);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        container-type: inline-size;
        pointer-events: none;
    }

    :global(.quanta-dock.room-740) .qs {
        --qs-dock: 8px;
    }

    /* A board covers the room: no window edge to keep inside, so the line stands 12px over the dock, as far as the
       board stops above it (the platform's stage). */
    :global(html[data-quanta-board-on]) .qs {
        bottom: calc(var(--qs-window) - var(--qs-dock) + var(--quanta-chat-below, 0px));
    }

    @media (max-width: 480px), (max-height: 480px) {
        .qs {
            --qs-window: 84px;
        }
    }

    /* One message and, under a board, its "+N" (lane.ts) on one line. */
    .qs-row {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        max-width: 100%;
    }

    .qs-row > :global(.qn) {
        min-width: 0;
    }

    /* Still read out by screen readers while it settles. */
    .qs.checking {
        opacity: 0;
    }

    .qs.checking :global(*) {
        pointer-events: none !important;
    }

    /* Beside the dock, centred on its height, in the free ground QuantaDock measured. */
    .qs.beside-right {
        left: calc(100% + 12px);
        top: 50%;
        bottom: auto;
        transform: translateY(-50%);
        align-items: flex-start;
    }

    .qs.beside-left {
        left: auto;
        right: calc(100% + 12px);
        top: 50%;
        bottom: auto;
        transform: translateY(-50%);
        align-items: flex-end;
    }

    /* The person's own level, as on the microphone button; a speaker heard, as a steady pulse: live sound is green. */
    .qs-level {
        flex: none;
        display: flex;
        gap: 3px;
        align-items: center;
        height: 16px;
    }

    .qs-level i {
        width: 3px;
        height: calc(4px + var(--level, 0) * 12px);
        border-radius: 2px;
        background: var(--qd-live);
        transition: height 0.1s linear;
    }

    .qs-level.talking i {
        animation: qs-talk 0.9s ease-in-out infinite;
    }

    .qs-level.quiet i {
        height: 3px;
        border-radius: 50%;
        background: currentColor;
        opacity: 0.45;
    }

    .qs-level.talking i:nth-child(2) {
        animation-delay: 0.15s;
    }

    .qs-level.talking i:nth-child(3) {
        animation-delay: 0.3s;
    }

    @keyframes qs-talk {
        0%,
        100% {
            height: 5px;
        }
        50% {
            height: 15px;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .qs-level.talking i {
            animation: none;
            height: 12px;
        }
    }
</style>
