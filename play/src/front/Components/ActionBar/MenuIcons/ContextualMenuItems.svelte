<script lang="ts">
    import { getContext } from "svelte";

    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { audioManagerVisibilityStore } from "../../../Stores/AudioManagerStore";
    import { bottomActionBarVisibilityStore } from "../../../Stores/BottomActionBarStore";
    import { inLivekitStore } from "../../../Stores/MediaStore";
    import { inExternalServiceStore } from "../../../Stores/MyMediaStore";
    import { raiseHandAvailableStore } from "../../../Stores/RaiseHandAvailabilityStore";
    import { onboardingStore } from "../../../Stores/OnboardingStore";
    import { followStateStore } from "../../../Stores/FollowStore";
    import { requestedMegaphoneStore } from "../../../Stores/MegaphoneStore";
    import { currentPlayerLockableAreasStore } from "../../../Stores/CurrentPlayerAreaLockStore";
    import { currentPlayerGroupLockStateStore } from "../../../Stores/CurrentPlayerGroupStore";
    import { localUserStore } from "../../../Connection/LocalUserStore";
    import { QUANTA_UI } from "../../../Enum/EnvironmentVariable";
    import LL from "../../../../i18n/i18n-svelte";
    import { followEntryVisible, lockEntryVisible, profileMenuEntryVisible } from "../../../quanta/classroomUi";

    import AppsMenuItem from "./AppsMenuItem.svelte";
    import FollowMenuItem from "./FollowMenuItem.svelte";
    import EmojiMenuItem from "./EmojiMenuItem.svelte";
    import LockDiscussionMenuItem from "./LockDiscussionMenuItem.svelte";
    import MusicMenuItem from "./MusicMenuItem.svelte";
    import HeaderMenuItem from "./HeaderMenuItem.svelte";
    import MegaphoneMenuItem from "./MegaphoneMenuItem.svelte";
    import RaiseHandMenuItem from "./RaiseHandMenuItem.svelte";
    import RecordingMenuItem from "./RecordingMenuItem.svelte";
    import { createRecordingMenuStateStore } from "./RecordingMenuUtils";

    const inProfileMenu = getContext("profileMenu");

    const gameScene = gameManager.getCurrentGameScene();
    const recording = gameManager.currentStartedRoom.recording;
    const recordingMenuState = createRecordingMenuStateStore(gameScene.spaceRegistry, {
        canStartRecording: localUserStore.isLogged() && recording?.buttonState === "enabled",
        isUserLoggedIn: localUserStore.isLogged(),
        roomButtonState: recording?.buttonState,
    });

    let showMusic = $derived($audioManagerVisibilityStore !== "hidden");
    let showFollow = $derived(
        followEntryVisible(
            QUANTA_UI,
            ($bottomActionBarVisibilityStore && !$inLivekitStore) || $followStateStore !== "off",
            $followStateStore !== "off",
        ),
    );
    let showLock = $derived(
        lockEntryVisible(
            QUANTA_UI,
            $currentPlayerLockableAreasStore.length > 0 ||
                ($bottomActionBarVisibilityStore &&
                    !$inLivekitStore &&
                    $currentPlayerGroupLockStateStore !== undefined) ||
                $onboardingStore === "lockBubble",
            $currentPlayerGroupLockStateStore === true ||
                $currentPlayerLockableAreasStore.some((area) => area.lockState),
        ),
    );
    let showRecording = $derived(
        profileMenuEntryVisible(QUANTA_UI, "recording", $recordingMenuState.shouldDisplayButton),
    );
    let showApps = $derived(profileMenuEntryVisible(QUANTA_UI, "apps"));
    let showMegaphone = $derived(!!$requestedMegaphoneStore);
    let showRaiseHand = $derived(!$inExternalServiceStore && $raiseHandAvailableStore && !(QUANTA_UI && inProfileMenu));

    // These menu items are displayed to the left of the camera/microphone icons.
    // They switch automatically to the profile menu when the screen is small.
</script>

<!-- quanta: the heading only over items it heads; raise hand is the dock's, so in a conversation the group can be empty
     and left two dividers with nothing between them. -->
{#if QUANTA_UI ? inProfileMenu && (showMusic || showFollow || showLock || showRecording || showMegaphone || showRaiseHand) : inProfileMenu && ($audioManagerVisibilityStore !== "hidden" || $bottomActionBarVisibilityStore)}
    <HeaderMenuItem label={$LL.menu.sub.contextualActions()} />
{/if}

{#if showMusic}
    <MusicMenuItem />
{/if}

{#if !inProfileMenu}
    <EmojiMenuItem />
    <AppsMenuItem />
{/if}

{#if showFollow}
    <!-- <ChangeLayoutMenuItem /> -->

    <FollowMenuItem />
{/if}

{#if showLock}
    <LockDiscussionMenuItem />
{/if}

{#if showRecording}
    <RecordingMenuItem {recordingMenuState} />
{/if}

{#if showMegaphone}
    <MegaphoneMenuItem />
{/if}

<!-- Single control for the whole "ask to speak" lifecycle: shown to raise the hand in every remote conversation
     (meeting room, megaphone audience, proximity bubble — a zone can turn it off), and kept on stage (green "live"
     state) once the floor is granted so the user can hand it back. See raiseHandAvailableStore. -->
<!-- quanta: the docked controls have their own raise-hand button -->
{#if showRaiseHand}
    <RaiseHandMenuItem />
{/if}

{#if inProfileMenu && showApps}
    <!-- In the profile menu, the apps submenu is displayed at the end (because it contains a heading) -->
    <AppsMenuItem />
{/if}
