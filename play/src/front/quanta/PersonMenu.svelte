<script lang="ts">
    // quanta: the menu on a person's video tile, the same as the one on their row in the platform's people list
    // (personMenu.ts). Above it, what only a tile has: this viewer's volume for them.
    import { type Writable, writable } from "svelte/store";
    import { analyticsClient } from "../Administration/AnalyticsClient";
    import { meetingOf } from "../Administration/CurrentMeeting";
    import type { SpaceUserExtended } from "../Space/SpaceInterface";
    import RangeSlider from "../Components/Input/RangeSlider.svelte";
    import { openModerationModal } from "../Components/Moderation/openModerationModal";
    import { fullNamesStore, shownName } from "./fullNames";
    import Icon from "./Icon.svelte";
    import type { IconName } from "./icons";
    import { QL } from "./i18n";
    import { personMenuItems, type PersonMenuItem } from "./personMenu";
    import {
        askPlatformToLetDraw,
        moderatePerson,
        platformLetsDrawStore,
        pokePerson,
        POKE_PRESETS,
        roomModerationStore,
    } from "./moderationBridge";
    import { giveFloorTo, handsStateStore, revokeFloorFrom } from "./handsBridge";
    import { drawersOf, presentedBoardStore } from "./boardAccess";
    import { mayBlockOrReport, staffTarget } from "./staffTargets";
    import { goTo } from "./goTo";
    import { openDirectWithAccount } from "./directMessages";
    import { pokeText } from "./poke";

    interface Props {
        spaceUser: SpaceUserExtended;
        videoEnabled: boolean;
        onClose: () => void;
        volumeStore?: Writable<number>;
        /** quanta: from a character on the map: their name on top, and no volume (that is the call tile's). */
        fromMap?: boolean;
        /** Whether they run the room, when the opener found out (characterMenu.ts). */
        targetStaff?: boolean;
    }

    let {
        spaceUser,
        videoEnabled,
        onClose,
        volumeStore = writable(1),
        fromMap = false,
        targetStaff = undefined,
    }: Props = $props();

    const LOOK: Record<PersonMenuItem, { icon: IconName; label: () => string; danger?: true }> = {
        go_to: { icon: "navigation", label: () => $QL.personGoTo() },
        message: { icon: "message", label: () => $QL.personMessage() },
        poke: { icon: "bellRing", label: () => $QL.personPoke() },
        let_speak: { icon: "campaign", label: () => $QL.personLetSpeak() },
        stop_speaking: { icon: "campaignOff", label: () => $QL.personStopSpeaking() },
        let_draw: { icon: "pencil", label: () => $QL.personLetDraw() },
        stop_drawing: { icon: "pencilOff", label: () => $QL.personStopDrawing() },
        mute_mic: { icon: "micOff", label: () => $QL.personMuteMic() },
        mute_camera: { icon: "videocamOff", label: () => $QL.personMuteCamera() },
        allow_camera: { icon: "videocam", label: () => $QL.personAllowCamera() },
        mute_chat: { icon: "messageOff", label: () => $QL.personMuteChat() },
        unmute_chat: { icon: "message", label: () => $QL.personUnmuteChat() },
        remove: { icon: "userX", label: () => $QL.personRemove(), danger: true },
        report: { icon: "flag", label: () => $QL.personReport() },
        mute_everyone_mic: { icon: "micOff", label: () => $QL.personMuteEveryoneMic() },
        mute_everyone_camera: { icon: "videocamOff", label: () => $QL.personMuteEveryoneCamera() },
    };

    let canSilenceConversation = $derived(spaceUser.space.canAskToMuteAudioOrTurnOffVideo);
    let uuid = $derived(spaceUser.uuid);
    let room = $derived($roomModerationStore);
    let staff = $derived(room?.canModerate === true);
    let hand = $derived($handsStateStore.queue.find((entry) => entry.id === spaceUser.spaceUserId));
    let groups = $derived(
        personMenuItems({
            viewerStaff: staff,
            // Someone the room doesn't know yet counts as staff (staffTargets.ts).
            targetStaff:
                targetStaff ??
                room?.people.find((person) => person.id === uuid)?.staff ??
                staffTarget(uuid, spaceUser.tags) ??
                true,
            self: !!room && room.self === uuid,
            canGoTo: staff,
            canMessage: staff,
            mayLetSpeak: !!hand?.floor && !hand.self,
            speaking: $handsStateStore.speaking.some((speaker) => speaker.id === spaceUser.spaceUserId),
            canLetDraw: $platformLetsDrawStore,
            drawing: drawersOf($presentedBoardStore).includes(uuid),
            canTurnOffCamera: true,
            cameraHeld: !!room?.cameraOff?.includes(uuid),
            chatMuted: !!room?.muted.includes(uuid),
            mayReport: mayBlockOrReport(spaceUser),
            canSilenceConversation: staff && $canSilenceConversation,
        }),
    );

    let confirmRemove = $state(false);
    // Poke opens its presets in the menu's place.
    let poking = $state(false);

    function run(item: PersonMenuItem) {
        if (item === "remove" && !confirmRemove) {
            confirmRemove = true;
            return;
        }
        if (item === "poke") {
            poking = true;
            return;
        }
        const name = spaceUser.name;
        switch (item) {
            case "go_to":
                goTo({ uuid });
                break;
            case "message":
                openDirectWithAccount(uuid, name);
                break;
            case "let_speak":
                analyticsClient.trackAdminEvent("meeting.floor.given");
                giveFloorTo(spaceUser.spaceUserId);
                break;
            case "stop_speaking":
                analyticsClient.trackAdminEvent("meeting.floor.revoked");
                revokeFloorFrom(spaceUser.spaceUserId);
                break;
            case "let_draw":
            case "stop_drawing":
                askPlatformToLetDraw(uuid, item === "let_draw");
                break;
            case "report":
                analyticsClient.trackAdminEvent("meeting.report.clicked", meetingOf(spaceUser.space));
                openModerationModal(uuid, name);
                break;
            // Everyone in this conversation, as WA's tile menu did: the noisy group, not the whole class.
            case "mute_everyone_mic":
                analyticsClient.trackAdminEvent("meeting.microphone.muted_for_everybody", meetingOf(spaceUser.space));
                spaceUser.space.emitPublicMessage({ $case: "muteAudioForEverybody", muteAudioForEverybody: {} });
                break;
            case "mute_everyone_camera":
                analyticsClient.trackAdminEvent("meeting.video.muted_for_everybody", meetingOf(spaceUser.space));
                spaceUser.space.emitPublicMessage({ $case: "muteVideoForEverybody", muteVideoForEverybody: {} });
                break;
            default:
                if (item === "mute_mic")
                    analyticsClient.trackAdminEvent("meeting.microphone.muted", meetingOf(spaceUser.space));
                if (item === "mute_camera")
                    analyticsClient.trackAdminEvent("meeting.video.muted", meetingOf(spaceUser.space));
                moderatePerson(item, uuid);
        }
        onClose();
    }

    function act(event: Event, action: () => void) {
        event.preventDefault();
        event.stopPropagation();
        action();
    }
</script>

<div
    class="person-menu flex flex-col p-1 w-max min-w-60 max-w-72 bg-contrast/80 backdrop-blur-md rounded-md max-h-max z-50 select-none text-white"
    class:mt-[0.2rem]={!videoEnabled}
    role="menu"
    tabindex="-1"
    aria-label={$QL.personActions({ name: shownName($fullNamesStore, uuid, spaceUser.name) })}
    data-testid="person-menu"
    onkeydown={(event) => event.key === "Escape" && onClose()}
    onmouseleave={() => onClose()}
>
    {#if confirmRemove}
        <div class="w-60 p-2">
            <p class="m-0 text-sm leading-5 break-words">
                {$QL.personRemoveConfirm({ name: shownName($fullNamesStore, uuid, spaceUser.name) })}
            </p>
            <div class="mt-3 flex justify-end gap-2">
                <button
                    class="btn btn-sm btn-ghost btn-light"
                    onclick={(event) => act(event, () => (confirmRemove = false))}
                >
                    {$QL.personCancel()}
                </button>
                <button class="btn btn-sm btn-danger" onclick={(event) => act(event, () => run("remove"))}>
                    {$QL.personRemoveYes()}
                </button>
            </div>
        </div>
    {:else if poking}
        <p class="m-0 px-2 pt-2 pb-1 text-xs text-white/60 break-words">
            {$QL.personPokeTitle({ name: shownName($fullNamesStore, uuid, spaceUser.name) })}
        </p>
        {#each POKE_PRESETS as preset (preset)}
            <button
                class="flex gap-2 items-center hover:bg-white/10 m-0 p-2 w-full text-sm rounded leading-4 text-left"
                role="menuitem"
                data-testid="person-menu-poke-{preset}"
                onclick={(event) =>
                    act(event, () => {
                        pokePerson(uuid, preset);
                        onClose();
                    })}
            >
                {pokeText($QL, preset)}
            </button>
        {/each}
    {:else}
        {#if fromMap}
            <p class="m-0 px-2 pt-2 pb-1 text-sm font-semibold break-words" data-testid="person-menu-name">
                {shownName($fullNamesStore, uuid, spaceUser.name)}
            </p>
        {:else}
            <div
                class="flex gap-2 items-center m-0 py-2 pl-2 pr-3 w-full text-sm"
                role="group"
                aria-label={$QL.personVolume()}
            >
                <button
                    class="p-0 m-0 flex text-white"
                    aria-label={$QL.personVolume()}
                    aria-pressed={$volumeStore === 0}
                    onclick={(event) => act(event, () => volumeStore.set($volumeStore === 0 ? 1 : 0))}
                >
                    <Icon name={$volumeStore === 0 ? "volumeOff" : "volume"} size={16} />
                </button>
                <div class="flex-1">
                    <RangeSlider
                        min={0}
                        max={1}
                        step={0.01}
                        bind:value={$volumeStore}
                        valueFormatter={(v) => Math.round(v * 100).toString()}
                        unit="%"
                        variant="secondary"
                        wrapperMargins={false}
                    />
                </div>
            </div>
        {/if}
        {#each groups as group (group.join())}
            <div class="divider" role="separator"></div>
            {#each group as item (item)}
                <button
                    class="flex gap-2 items-center hover:bg-white/10 m-0 p-2 w-full text-sm rounded leading-4 text-left"
                    class:danger={LOOK[item].danger}
                    role="menuitem"
                    data-testid="person-menu-{item}"
                    onclick={(event) => act(event, () => run(item))}
                >
                    <span class="flex shrink-0"><Icon name={LOOK[item].icon} size={16} /></span>
                    {LOOK[item].label()}
                </button>
            {/each}
        {/each}
    {/if}
</div>

<style>
    /* A short room window scrolls the menu rather than cutting it off. */
    .person-menu {
        max-height: calc(100dvh - 24px);
        overflow-y: auto;
    }
    .divider {
        height: 1px;
        margin: 4px 0;
        background: rgba(255, 255, 255, 0.12);
    }
    .danger {
        color: #f87171;
    }
</style>
