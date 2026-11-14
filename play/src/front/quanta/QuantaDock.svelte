<script lang="ts">
    // quanta: the call controls docked at the bottom like Google Meet's, with the device trays that open above
    // them. Drives the same stores as WA's action bar (ActionBar.svelte), which QUANTA_UI replaces.
    import { AvailabilityStatus } from "@workadventure/messages";
    import { onDestroy, tick } from "svelte";
    import { derived, get } from "svelte/store";
    import { analyticsClient } from "../Administration/AnalyticsClient";
    import { navChat } from "../Chat/Stores/ChatStore";
    import { localUserStore } from "../Connection/LocalUserStore";
    import { gameManager } from "../Phaser/Game/GameManager";
    import { EditorToolName } from "../Phaser/Game/MapEditor/MapEditorModeManager";
    import { mapEditorModeStore } from "../Stores/MapEditorStore";
    import { userIsAdminStore } from "../Stores/GameStore";
    import { popupStore } from "../Stores/PopupStore";
    import { chatVisibilityStore } from "../Stores/ChatStore";
    import { backgroundConfigStore, backgroundProcessingSupportedStore } from "../Stores/BackgroundTransformStore";
    import { givenFloorSpaceStore } from "../Stores/MegaphoneStore";
    import { cameraPermissionStateStore, microphonePermissionStateStore } from "../Stores/MediaStatusStore";
    import {
        availabilityStatusStore,
        cameraAccessIssueStore,
        cameraListStore,
        inBackgroundSettingsStore,
        isSpeakerStore,
        localVolumeStore,
        localStreamStore,
        mouseIsHoveringCameraButton,
        microphoneAccessIssueStore,
        microphoneListStore,
        requestedCameraDeviceIdStore,
        requestedCameraState,
        requestedMicrophoneDeviceIdStore,
        requestedMicrophoneState,
        silentStore,
        speakerListStore,
        speakerSelectedStore,
        usedCameraDeviceIdStore,
        usedMicrophoneDeviceIdStore,
    } from "../Stores/MediaStore";
    import {
        activeSecondaryZoneActionBarStore,
        additionalRightButtonsMenu,
        activeSubMenuStore,
        handleOpenMenuEvent,
        menuVisiblilityStore,
        openedMenuStore,
        screenSharingActivatedStore,
        settingsSubMenuTargetStore,
        SubMenusInterface,
    } from "../Stores/MenuStore";
    import {
        inExternalServiceStore,
        myCameraStore,
        myMicrophoneStore,
        proximityMeetingStore,
    } from "../Stores/MyMediaStore";
    import { raiseHandAvailableStore, raiseHandSpacesStore } from "../Stores/RaiseHandAvailabilityStore";
    import { isHandRaisedStore, requestedHandRaiseState } from "../Stores/RaiseHandStore";
    import {
        isScreenSharingSupported,
        requestedScreenSharingState,
        screenSharingAvailableStore,
    } from "../Stores/ScreenSharingStore";
    import { spaceLabel } from "../Space/spaceLabel";
    import { showFloatingUi } from "../Utils/svelte-floatingui-show";
    import { createFloatingUiActions } from "../Utils/svelte-floatingui";
    import { LL } from "../../i18n/i18n-svelte";
    import EmojiSubMenu from "../Components/ActionBar/EmojiSubMenu.svelte";
    import BackgroundSettingsPanel from "../Components/ActionBar/MediaSettingsList/BackgroundSettingsPanel.svelte";
    import {
        activePictureInPictureStore,
        askPictureInPictureActivatingStore,
        pictureInPictureSupportedStore,
    } from "../Stores/PeerStore";
    import { isInRemoteConversation } from "../Stores/StreamableCollectionStore";
    import { canvasSize, coWebsites, coWebsitesSize, fullScreenCowebsite, windowSize } from "../Stores/CoWebsiteStore";
    import ProfileMenuContent from "../Components/ActionBar/MenuIcons/ProfileMenuContent.svelte";
    import RaiseHandSpacePicker, { type RaiseHandSpaceEntry } from "../Components/PopUp/RaiseHandSpacePicker.svelte";
    import { gameSceneIsLoadedStore } from "../Stores/GameSceneStore";
    import { effectiveMicrophoneStateStore, effectiveCameraStateStore } from "../Stores/MediaStore";
    import { cameraHeldStore } from "./moderationBridge";
    import { screenSharingLocalStreamStore } from "../Stores/ScreenSharingStore";
    import { dismissWeakLinkNotice, turnCameraBackOn, weakLinkNoticeStore } from "../Livekit/WeakLinkNotice";
    import DeviceSelect from "./DeviceSelect.svelte";
    import { dockGuttersStore, dockSizeStore } from "./dockBar";
    import { DOCK_FOLDS, PHONE_FOLDS, dockFoldedStore, type DockFold, type FoldedAction } from "./dockFold";
    import { mentionMarksStore } from "./mentions";
    import { QL } from "./i18n";
    import Icon from "./Icon.svelte";
    import { watchMediaStates } from "./mediaStateEvents";
    import { handsStateStore, startHandsBridge } from "./handsBridge";
    import { spotStandingStore } from "./megaphoneSpots";
    import { startAwayBridge } from "./awayBridge";
    import { fullNamesStore } from "./fullNames";
    import ActivityFeed from "./ActivityFeed.svelte";
    import OnAirStrip from "./OnAirStrip.svelte";
    import { keepNoticesBelow } from "./noticeOffsets";
    import { dismissNotHeardHint, notHeardBlockedStore, notHeardHintStore } from "./notHeardHint";
    import { emojiPanelPadding } from "./classroomUi";
    import { setStudentView, studentViewStore } from "./studentView";
    import { RECORDING_BUTTON } from "./recordingIndicator";
    import RoomRecordingIndicator from "./RoomRecordingIndicator.svelte";
    import { micLevels, onAirPrompt, quietFor, sounding } from "./onAir";
    import { dismissHint, dockHintStore, hintDone } from "./dockHints";
    import {
        classLectureAvailableStore,
        selfOnAirMutedStore,
        selfOnAirStore,
        speakToClass,
        stopSpeakingToClass,
    } from "./speakingToClass";
    import { showChat, showPeople, sideColumnShownStore, sidePanelLayoutStore, startSidePanel } from "./sidePanel";
    import { quantaSettingsTabStore } from "./settingsTab";
    import { phoneLayoutStore } from "./roomWindow";
    import { dockLiftStore } from "./layout";
    import { dockTrayOpenStore } from "./roomOverlay";

    type Tray = "mic" | "cam";

    // The on-air button opens and closes its place instead of shifting the dock's buttons in one jump.
    function grow(node: HTMLElement) {
        const width = node.offsetWidth;
        return {
            duration: 200,
            css: (t: number) => `max-width: ${t * width}px; opacity: ${t}; overflow: hidden;`,
        };
    }

    const gameScene = gameManager.getCurrentGameScene();
    const chatEnabledInAdmin = gameScene.room.isChatEnabled;
    const userListEnabled = gameScene.room.isChatOnlineListEnabled;
    const proximityChatRoomManager = gameScene.proximityChatRoomManager;

    // The tray stays rendered while it closes, so it can animate out.
    let tray: Tray | undefined = $state(undefined);
    let shownTray: Tray | undefined = $state(undefined);
    let backgroundsOpen = $state(false);
    let dock: HTMLDivElement | undefined = $state();
    let dockRow: HTMLDivElement | undefined = $state();
    let sideBox: HTMLDivElement | undefined = $state();
    let recSideBox: HTMLDivElement | undefined = $state();
    let moreButton: HTMLButtonElement | undefined = $state();
    let handButton: HTMLButtonElement | undefined = $state();

    function toggleTray(which: Tray): void {
        backgroundsOpen = false;
        tray = tray === which ? undefined : which;
        if (tray) shownTray = tray;
    }

    // An open tray grows into the zoom column's corner: the column steps aside while it is open (quanta-ui.css).
    $effect(() => {
        document.documentElement.classList.toggle("quanta-tray-open", tray !== undefined);
        dockTrayOpenStore.set(tray !== undefined);
    });

    // The platform's bottom bar lines up with the dock's buttons and keeps clear of its width (dockBar.ts): the size
    // of the closed dock, kept while the dock is away (a phone's chat covering it), so the bar doesn't jump.
    $effect(() => {
        const element = dock;
        if (!element) return;
        const report = () => {
            const buttons = element.querySelector<HTMLElement>(".qd-buttons");
            if (!buttons) return;
            const pad = parseFloat(getComputedStyle(element).paddingBottom) || 0;
            const rect = element.getBoundingClientRect();
            dockSizeStore.set({
                width: Math.round(element.offsetWidth),
                height: Math.round(buttons.offsetHeight + 2 * pad),
                bottom: Math.round(window.innerHeight - rect.bottom),
            });
        };
        report();
        const observer = new ResizeObserver(report);
        observer.observe(element);
        return () => observer.disconnect();
    });

    function closeTray(): void {
        tray = undefined;
        backgroundsOpen = false;
    }

    function onDocumentPointerDown(event: PointerEvent): void {
        if (tray && dock && !dock.contains(event.target as Node)) closeTray();
    }

    // Busy, away and the other statuses that silence the user disable both devices, as in WA's action bar.
    const mediaBlockedStore = derived(
        [availabilityStatusStore, silentStore],
        ([$status, $silent]) =>
            $status === AvailabilityStatus.BUSY ||
            $status === AvailabilityStatus.AWAY ||
            $status === AvailabilityStatus.BACK_IN_A_MOMENT ||
            $status === AvailabilityStatus.SOUND_BLOCKED ||
            $status === AvailabilityStatus.DO_NOT_DISTURB ||
            $silent,
    );

    let micDisabled = $derived(
        $mediaBlockedStore || ($microphoneListStore !== undefined && $microphoneListStore.length === 0),
    );
    let camDisabled = $derived($mediaBlockedStore || ($cameraListStore !== undefined && $cameraListStore.length === 0));
    let micDenied = $derived(
        $microphonePermissionStateStore === "denied" ||
            ($microphoneAccessIssueStore === "permission_denied" && $microphonePermissionStateStore !== "granted"),
    );
    let camDenied = $derived(
        $cameraPermissionStateStore === "denied" ||
            ($cameraAccessIssueStore === "permission_denied" && $cameraPermissionStateStore !== "granted"),
    );
    let micOn = $derived($requestedMicrophoneState && !micDisabled);
    // A track can be gone with the button on (the room's other reasons to cut the microphone): the level shows only
    // while the microphone really captures.
    let micCapturing = $derived(
        $localStreamStore.type === "success" &&
            !!$localStreamStore.stream?.getAudioTracks().some((track) => track.readyState === "live"),
    );
    // Hovering the microphone or camera, or their tray being open, wakes them for a check, as WA's own buttons do.
    let devicesHovered = $state(false);
    $effect(() => {
        mouseIsHoveringCameraButton.set(
            $availabilityStatusStore === AvailabilityStatus.ONLINE &&
                (devicesHovered || tray === "mic" || tray === "cam"),
        );
    });
    onDestroy(() => mouseIsHoveringCameraButton.set(false));
    $effect(() => {
        notHeardBlockedStore.set(
            tray !== undefined ||
                $activeSecondaryZoneActionBarStore === "emote" ||
                $openedMenuStore === "profileMenu" ||
                $dockHintStore !== undefined ||
                $popupStore.length > 0 ||
                // The chat covers the room above the dock: a hint there would count as shown without being seen.
                ($sidePanelLayoutStore.cover && $chatVisibilityStore),
        );
    });
    let camOn = $derived($requestedCameraState && !camDisabled);
    // While a device is off, the one the trays show is the one it comes back with, not the last one it used.
    let selectedMicrophoneId = $derived(
        $requestedMicrophoneState
            ? $usedMicrophoneDeviceIdStore
            : ($requestedMicrophoneDeviceIdStore ?? $usedMicrophoneDeviceIdStore),
    );
    let selectedCameraId = $derived(
        $requestedCameraState ? $usedCameraDeviceIdStore : ($requestedCameraDeviceIdStore ?? $usedCameraDeviceIdStore),
    );

    function toggleMicrophone(): void {
        analyticsClient.trackAdminEvent("media.microphone.toggled");
        if ($silentStore) return;
        if ($requestedMicrophoneState) requestedMicrophoneState.disableMicrophone();
        else requestedMicrophoneState.enableMicrophone();
    }

    function toggleCamera(): void {
        analyticsClient.trackAdminEvent("media.camera.toggled");
        if ($silentStore || $cameraHeldStore) return;
        if ($requestedCameraState) requestedCameraState.disableWebcam();
        else requestedCameraState.enableWebcam();
    }

    // On air in the lecture (podium, megaphone spot, or from anywhere); staff can also go on air from anywhere.
    let onAir = $derived($selfOnAirStore && !$givenFloorSpaceStore);
    let roomButtons = $derived($additionalRightButtonsMenu.filter((button) => button.id !== RECORDING_BUTTON));
    // The room's notices start below these buttons (noticeOffsets.ts).
    let roomButtonsBox: HTMLDivElement | undefined = $state();
    $effect(() => (roomButtonsBox ? keepNoticesBelow(roomButtonsBox) : undefined));
    let canSpeakToClass = $derived($userIsAdminStore && $classLectureAvailableStore && !$givenFloorSpaceStore);

    // Asking to speak to the class is asking to be heard: the microphone comes on with it.
    function startSpeakingToClass(): void {
        if (!$requestedMicrophoneState && !micDisabled) requestedMicrophoneState.enableMicrophone();
        speakToClass();
    }

    // Three bars from WA's seven volume bands, like the level Meet shows in place of the arrow.
    let levels = $derived(micLevels($localVolumeStore));
    // Staff see real names here too, as on the tags and in the people list.
    let onAirSpeakers = $derived(
        $userIsAdminStore
            ? $handsStateStore.speaking.map((speaker) => ({
                  ...speaker,
                  name: (speaker.uuid && $fullNamesStore.get(speaker.uuid)) || speaker.name,
              }))
            : [],
    );

    // Heard by the whole class: from the podium, a megaphone spot, a floor given, or staff from anywhere.
    let selfOnAir = $derived($selfOnAirStore || $givenFloorSpaceStore !== undefined);
    // Once this microphone has picked anything up, silence is someone listening. Counted again only for a new start.
    let micHeard = $state(false);
    let quietDismissed = $state(false);
    $effect(() => {
        void $usedMicrophoneDeviceIdStore;
        micHeard = false;
        quietDismissed = false;
        if (!(micOn && micCapturing)) return;
        return derived(localVolumeStore, sounding).subscribe((on) => {
            if (on) micHeard = true;
        });
    });
    let selfQuiet = $state(false);
    $effect(() => {
        if (!(selfOnAir && micOn && micCapturing) || micHeard) {
            selfQuiet = false;
            return;
        }
        return quietFor(derived(localVolumeStore, sounding)).subscribe((quiet) => (selfQuiet = quiet));
    });
    let onAirStatus = $derived.by(() => {
        // On a spot with the microphone off nothing is on air yet: turning it on is what starts it.
        if (!selfOnAir) return $spotStandingStore === "micOff" ? (micDenied ? "micBlocked" : "micOff") : undefined;
        const prompt = onAirPrompt({ on: micOn, denied: micDenied, quiet: selfQuiet });
        return prompt === "quiet" && quietDismissed ? "heard" : prompt;
    });

    function turnMicrophoneOnToSpeak(): void {
        analyticsClient.trackAdminEvent("media.microphone.toggled");
        if (!$silentStore) requestedMicrophoneState.enableMicrophone();
    }

    function selectMicrophone(deviceId: string): void {
        analyticsClient.trackAdminEvent("settings.microphone.selected");
        requestedMicrophoneDeviceIdStore.set(deviceId);
        localUserStore.setPreferredAudioInputDevice(deviceId);
    }

    function selectSpeaker(deviceId: string): void {
        localUserStore.setSpeakerDeviceId(deviceId);
        speakerSelectedStore.set(deviceId);
    }

    function selectCamera(deviceId: string): void {
        analyticsClient.trackAdminEvent("settings.camera.selected");
        requestedCameraDeviceIdStore.set(deviceId);
        localUserStore.setPreferredVideoInputDevice(deviceId);
    }

    function openSettings(target: "microphone" | undefined): void {
        closeTray();
        settingsSubMenuTargetStore.set(target);
        quantaSettingsTabStore.set(target === "microphone" ? "audio" : "video");
        handleOpenMenuEvent(SubMenusInterface.settings);
    }

    let blurOn = $derived($backgroundConfigStore.mode === "blur");

    function toggleBlur(): void {
        if (blurOn) {
            backgroundConfigStore.setMode("none");
        } else {
            backgroundConfigStore.setBlurAmount($backgroundConfigStore.blurAmount || 25);
            backgroundConfigStore.setMode("blur");
        }
    }

    // A running share outlives bubbles and silent zones: the button shows it, and always stops it.
    let sharing = $derived($requestedScreenSharingState);

    function toggleScreenSharing(): void {
        analyticsClient.trackAdminEvent("meeting.screenshare.toggled");
        if (!sharing && $silentStore && !$isSpeakerStore) return;
        if ($requestedScreenSharingState) requestedScreenSharingState.disableScreenSharing();
        else requestedScreenSharingState.enableScreenSharing();
    }

    // WA hides its bar when the chat or the map editor leaves the map too narrow; the map editor's panels end above
    // this dock (quanta-ui.css), so only a chat over the whole room still does (in the markup below).
    // The side column (People or Chat) takes the window's right edge: the dock centres and steps down in what is left.
    // A column beside the map takes its width from the dock's row; a band below the stage (upright screens) does not.
    // What the column holds now (sidePanel.ts): beside the page it grows and shrinks with the frame's slide.
    let sideColumn = $derived($sideColumnShownStore);
    let roomWidth = $derived($windowSize.width - sideColumn);

    // A row that can't hold every button gives the least needed to ⋮, one at a time (dockFold.ts), rather than
    // squeezing them: measured, so a teacher's extra buttons fold sooner than a student's.
    let foldLevel = $state(0);
    let dockRoom = $derived(roomWidth - $dockGuttersStore.left - $dockGuttersStore.right - 16);
    const folded = (key: DockFold) =>
        ($phoneLayoutStore && PHONE_FOLDS.includes(key) && (key !== "megaphone" || !onAir)) ||
        (key !== "megaphone" && DOCK_FOLDS.indexOf(key) < foldLevel);
    let fitRun = 0;

    async function fitDock(): Promise<void> {
        const run = ++fitRun;
        foldLevel = 0;
        await tick();
        while (run === fitRun && dock && dock.offsetWidth > dockRoom && foldLevel < DOCK_FOLDS.length) {
            foldLevel += 1;
            await tick();
        }
    }

    $effect(() => {
        void dockRoom;
        void $phoneLayoutStore;
        void fitDock();
    });

    // Buttons coming and going refit from scratch; growing in place (a transition, a wider word) only folds further,
    // so folding never feeds back into itself.
    $effect(() => {
        const node = dock;
        if (!node) return;
        const row = node.querySelector(".qd-buttons");
        const added = new MutationObserver(() => void fitDock());
        if (row) added.observe(row, { childList: true });
        const grown = new ResizeObserver(() => {
            if (node.offsetWidth > dockRoom && foldLevel < DOCK_FOLDS.length) foldLevel += 1;
        });
        grown.observe(node);
        return () => {
            added.disconnect();
            grown.disconnect();
        };
    });
    // The dock with whatever tray is open, its 8-12px from the frame's foot and a gap.
    const ABOVE_DOCK = 20;
    let dockHeight = $state(72);
    let dockWidth = $state(0);
    // The row's ground left of the centred dock, from the room's left edge (24px) to 12px short of the dock: the room's
    // recording indicator stands there in words if they fit, in its short form if not, and in the dock itself if not even
    // that.
    let recordingSpace = $derived(dockWidth ? (roomWidth - dockWidth) / 2 - 24 - 12 : Infinity);
    // The indicator's short form (RoomRecordingIndicator.svelte: the dot and "REC").
    const REC_SHORT_WIDTH = 76;
    let studentViewHeight = $state(44);
    let studentViewWidth = $state(278);
    let studentViewOverChat = $derived($sidePanelLayoutStore.cover && $chatVisibilityStore);
    // Centred over the room like the dock. A frame too narrow for that keeps it off the zoom column (72px from the room's
    // right edge, and a gap).
    const ZOOM_CLEARANCE = 80;
    let studentViewCentre = $derived(
        studentViewOverChat
            ? roomWidth / 2
            : Math.max(
                  8 + studentViewWidth / 2,
                  Math.min(roomWidth / 2, roomWidth - ZOOM_CLEARANCE - studentViewWidth / 2),
              ),
    );
    // What stands on the dock, which the pill stands on in turn: from the frame's foot to the top of it all.
    const ON_THE_DOCK =
        '[data-testid="quanta-on-air-strip"], .qd-hint, .bottom-action-bar, [data-testid="profile-menu"]';
    let aboveDock = $state(84);
    // Layouts A and C on an upright screen: what stands on the dock stands on what they put under the stage (layout.ts).
    let standOn = $derived($dockLiftStore ? Math.max(aboveDock, $dockLiftStore - 8) : aboveDock);
    let studentViewBottom = $derived(standOn + (roomWidth <= 740 ? 12 : 8));
    $effect(() => {
        if (!dock) return;
        const dockEl = dock;
        // Read so that opening or closing any of them measures again, and the room's width steps, which move the dock
        // without resizing it.
        void $openedMenuStore;
        void $activeSecondaryZoneActionBarStore;
        void tray;
        void roomWidth;
        // The on-air line moves with the lift (quanta-ui.css).
        void $dockLiftStore;
        let frame = 0;
        const measure = () => {
            frame = 0;
            let top = dockEl.getBoundingClientRect().top;
            for (const el of document.querySelectorAll(ON_THE_DOCK)) {
                const box = el.getBoundingClientRect();
                if (box.height > 0) top = Math.min(top, box.top);
            }
            aboveDock = window.innerHeight - top;
            // The room's axis: every overlay centred over the room (notices, the on-air line, the Say box, WA's popups and
            // messages, the settings dialog) centres on the dock, never on the window, which the chat column is part of.
            const dockBox = dockEl.getBoundingClientRect();
            if (dockBox.width > 0) {
                const root = document.documentElement.style;
                root.setProperty("--quanta-room-x", `${Math.round(dockBox.left + dockBox.width / 2)}px`);
                root.setProperty("--quanta-room-w", `${Math.round(roomWidth)}px`);
            }
            // The zoom pill (ZoomPill.svelte) stands above a notice that would cover it, which a narrow room's notices
            // reach across to; elsewhere it keeps its corner.
            const zoom = document.querySelector<HTMLElement>(".quanta-zoom-pill")?.getBoundingClientRect();
            let lift = 0;
            if (zoom && zoom.width > 0) {
                for (const el of document.querySelectorAll<HTMLElement>(
                    '[data-testid="quanta-on-air-strip"] > *, [data-quanta-notices] > *',
                )) {
                    const box = el.getBoundingClientRect();
                    if (!box.width || !box.height || getComputedStyle(el).visibility === "hidden") continue;
                    if (box.right > zoom.left - 8 && box.left < zoom.right + 8)
                        lift = Math.max(lift, Math.ceil(window.innerHeight - box.top + 8));
                }
            }
            document.documentElement.style.setProperty("--quanta-zoom-lift", `${lift}px`);
        };
        const schedule = () => {
            if (!frame) frame = requestAnimationFrame(measure);
        };
        const resized = new ResizeObserver(schedule);
        resized.observe(dockEl);
        if (sideBox) resized.observe(sideBox);
        if (recSideBox) resized.observe(recSideBox);
        const changed = new MutationObserver(schedule);
        changed.observe(dockEl, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
        // The room's notices come and go outside the dock: the zoom pill's lift depends on them too.
        const notices = document.querySelector("[data-quanta-notices]");
        if (notices) changed.observe(notices, { subtree: true, childList: true });
        window.addEventListener("resize", schedule);
        // The menu and the emoji panel place themselves a moment after they open.
        const settled = setTimeout(schedule, 150);
        measure();
        return () => {
            cancelAnimationFrame(frame);
            clearTimeout(settled);
            resized.disconnect();
            changed.disconnect();
            window.removeEventListener("resize", schedule);
        };
    });
    // The room's notices (quanta-ui.css .quanta-notices) stand on whatever stands on the dock, the view-as-student
    // notice included; with the dock gone under a covering chat, at the room's foot.
    $effect(() => {
        const above = !dock
            ? 16
            : standOn +
              8 +
              ($studentViewStore && !studentViewOverChat ? studentViewHeight + 8 + (roomWidth <= 740 ? 4 : 0) : 0);
        document.documentElement.style.setProperty("--quanta-notices-bottom", `${Math.round(above)}px`);
    });
    onDestroy(() => {
        const root = document.documentElement.style;
        for (const name of ["--quanta-notices-bottom", "--quanta-room-x", "--quanta-room-w"]) root.removeProperty(name);
    });
    // The chat toasts in the corner (quanta-ui.css): above the dock, which a tray makes taller, and above the pill where
    // the room is narrow enough for the two to share width (a toast is 300px wide, 16px from the edge).
    $effect(() => {
        const sharesWidth = $studentViewStore && studentViewCentre - studentViewWidth / 2 < 332;
        const clear = sharesWidth
            ? studentViewBottom + studentViewHeight + 8
            : Math.max(dockHeight + ABOVE_DOCK, $dockLiftStore);
        document.documentElement.style.setProperty("--quanta-toasts-bottom", `${clear}px`);
    });

    // Pop-ups over the dock leave 12px of the map between them and its edge (their button sits 12px inside it).
    const POPUP_OFFSET = 24;
    // Kept clear of the zoom column on either side (12px window inset, 12px, 48px, 12px).
    const [emojiRef, emojiContent, emojiArrow] = createFloatingUiActions(
        { placement: "top" },
        POPUP_OFFSET,
        (panelWidth) => emojiPanelPadding(window.innerWidth, panelWidth),
    );

    // The click that opens the picker must not count as a click outside it (svelte-outside skips handled clicks).
    function toggleEmoji(event: MouseEvent): void {
        event.preventDefault();
        if ($activeSecondaryZoneActionBarStore === "emote") {
            activeSecondaryZoneActionBarStore.set(undefined);
        } else {
            activeSecondaryZoneActionBarStore.set("emote");
            openedMenuStore.closeAll();
            hintDone("reactions");
        }
    }

    // Raise hand, lower it, or hand the floor back once given: RaiseHandMenuItem's lifecycle.
    let closeHandPicker: (() => void) | undefined;

    function toggleHand(spaceName: string): void {
        analyticsClient.trackAdminEvent("meeting.hand.toggled", {
            raised: !get(requestedHandRaiseState).has(spaceName),
        });
        requestedHandRaiseState.toggle(spaceName);
    }

    function onHandClick(): void {
        const floorSpace = get(givenFloorSpaceStore);
        if (floorSpace) {
            analyticsClient.trackAdminEvent("meeting.floor.given_back");
            floorSpace.stopStreaming();
            isSpeakerStore.set(false);
            givenFloorSpaceStore.set(undefined);
            return;
        }
        const spaces = $raiseHandSpacesStore;
        if (spaces.length === 1) {
            toggleHand(spaces[0].getName());
            return;
        }
        if (closeHandPicker) {
            closeHandPicker();
            closeHandPicker = undefined;
            return;
        }
        const anchor = folded("hand") ? moreButton : handButton;
        if (spaces.length === 0 || !anchor) return;
        const raisedIn = get(requestedHandRaiseState);
        const entries: RaiseHandSpaceEntry[] = spaces.map((space) => ({
            spaceName: space.getName(),
            kind: space.kind ?? "",
            label: spaceLabel(space),
            raised: raisedIn.has(space.getName()),
        }));
        closeHandPicker = showFloatingUi(
            anchor,
            RaiseHandSpacePicker,
            {
                entries,
                onselect: (entry: RaiseHandSpaceEntry) => toggleHand(entry.spaceName),
                onclose: () => {
                    closeHandPicker?.();
                    closeHandPicker = undefined;
                },
            },
            { placement: "top" },
            POPUP_OFFSET,
            true,
        );
    }

    let handLabel = $derived(
        $givenFloorSpaceStore
            ? $LL.actionbar.help.giveBackFloor.title()
            : $isHandRaisedStore
              ? $QL.lowerHand()
              : !$raiseHandAvailableStore
                ? $QL.raiseHandUnavailable()
                : $LL.actionbar.help.raiseHand.title(),
    );

    // What the row folded, for ⋮ to offer in its place.
    $effect(() => {
        const items: FoldedAction[] = [];
        if (folded("megaphone") && canSpeakToClass)
            items.push({ key: "megaphone", label: $QL.speakToClass(), icon: "campaign", run: startSpeakingToClass });
        if (folded("reactions"))
            items.push({ key: "reactions", label: $QL.reactions(), icon: "addReaction", run: () => undefined });
        if (folded("hand") && !$inExternalServiceStore) {
            items.push({
                key: "hand",
                label: handLabel,
                icon: "hand",
                pressed: $isHandRaisedStore && !$givenFloorSpaceStore,
                disabled: !$givenFloorSpaceStore && !$raiseHandAvailableStore,
                run: onHandClick,
            });
        }
        if (folded("share") && isScreenSharingSupported()) {
            items.push({
                key: "share",
                label: sharing ? $QL.stopSharing() : $LL.actionbar.help.share.title(),
                icon: sharing ? "stopShare" : "share",
                pressed: sharing,
                disabled: !$screenSharingActivatedStore || (!sharing && !$screenSharingAvailableStore),
                run: toggleScreenSharing,
            });
        }
        dockFoldedStore.set(items);
    });
    onDestroy(() => dockFoldedStore.set([]));

    // ⋮ is WA's profile menu, with every right-hand item of WA's bar (maps, participants, invite...) inside it.
    let closeMoreMenu: (() => void) | undefined;

    function openMoreMenu(): void {
        if (!moreButton || closeMoreMenu) return;
        const button = moreButton;
        // The menu is a floating layer outside the dock, so the dock's own Escape never reaches it. Captured first, it
        // closes the menu before Escape closes anything under it (a notice), and hands focus back to ⋮ from inside.
        const onKey = (event: KeyboardEvent) => {
            if (event.key !== "Escape" || event.defaultPrevented) return;
            event.preventDefault();
            const inside = document.activeElement?.closest('[data-testid="profile-menu"]');
            openedMenuStore.close("profileMenu");
            if (inside) button.focus({ preventScroll: true });
        };
        window.addEventListener("keydown", onKey, true);
        closeMoreMenu = showFloatingUi(
            button,
            ProfileMenuContent,
            { showContextualMenuItems: true },
            { placement: "top-end" },
            POPUP_OFFSET,
            false,
            true,
            () => {
                window.removeEventListener("keydown", onKey, true);
                closeMoreMenu = undefined;
                openedMenuStore.close("profileMenu");
            },
            1100,
        );
    }

    $effect(() => {
        if ($openedMenuStore === "profileMenu") {
            openMoreMenu();
        } else {
            const close = closeMoreMenu;
            closeMoreMenu = undefined;
            close?.();
        }
    });

    let chatAvailable = $state(false);
    gameManager
        .getChatConnection()
        .then(() => (chatAvailable = true))
        .catch((e: unknown) => console.error("Could not get chat", e));

    function openChatPanel(): void {
        if (!$chatVisibilityStore) {
            menuVisiblilityStore.set(false);
            activeSubMenuStore.activateByIndex(0);
        }
    }

    function toggleChat(): void {
        if ($chatVisibilityStore) {
            chatVisibilityStore.set(false);
            return;
        }
        showChat();
        analyticsClient.trackAdminEvent("chat.opened");
    }

    function togglePeople(): void {
        // Inside the platform its own people list (the whole room) takes the column; WA's lists only nearby players.
        if ($sidePanelLayoutStore.tabs) {
            showPeople();
            return;
        }
        openChatPanel();
        chatVisibilityStore.set(!$chatVisibilityStore);
        navChat.switchToUserList();
    }

    const unreadChatMessages = derived(
        gameManager.chatConnectionStore,
        (chatConnection, set) => {
            if (!chatConnection) {
                set(0);
                return;
            }
            return derived(
                [
                    chatConnection.nbUnreadRoomsMessages,
                    chatConnection.nbUnreadDirectRoomsMessages,
                    chatConnection.nbUnreadInvitationsMessages,
                ],
                ([rooms, directRooms, invitations]) => rooms + directRooms + invitations,
            ).subscribe(set);
        },
        0,
    );
    const proximityUnread = proximityChatRoomManager.unreadMessagesCount;
    let unread = $derived($unreadChatMessages + $proximityUnread);

    // Inside Quanta's room panel, leaving closes the panel (Quanta's VirtualRoom listens); alone, there is
    // nothing to leave to.
    const embedded = window.parent !== window;

    function leaveRoom(): void {
        window.parent.postMessage({ type: "quanta_wa_leave" }, "*");
    }

    // WA's picture-in-picture button (PictureInPictureMenuItem.svelte): asking for it also allows it in the settings.
    function togglePictureInPicture(): void {
        analyticsClient.trackAdminEvent("meeting.picture_in_picture.toggled", {
            open: !$askPictureInPictureActivatingStore,
        });
        if (!localUserStore.getAllowPictureInPicture()) localUserStore.setAllowPictureInPicture(true);
        askPictureInPictureActivatingStore.set(!$askPictureInPictureActivatingStore);
    }

    const stopHandsBridge = startHandsBridge();
    const stopAwayBridge = startAwayBridge();
    const stopSidePanel = startSidePanel();
    const stopMediaStates = watchMediaStates(
        gameSceneIsLoadedStore,
        {
            microphone: effectiveMicrophoneStateStore,
            camera: effectiveCameraStateStore,
            screenshare: derived(
                screenSharingLocalStreamStore,
                (value) =>
                    value.type === "success" &&
                    (value.stream?.getVideoTracks().some((track) => track.readyState === "live") ?? false),
            ),
        },
        (kind, enabled) => {
            if (kind === "microphone") analyticsClient.trackAdminEvent("media.microphone.state_changed", { enabled });
            else if (kind === "camera") analyticsClient.trackAdminEvent("media.camera.state_changed", { enabled });
            else analyticsClient.trackAdminEvent("meeting.screenshare.state_changed", { enabled });
        },
    );
    onDestroy(stopMediaStates);

    // A website in full screen hides the map's layer, where the settings dialog, the chat and WA's menus open: opening
    // one of them leaves full screen, so it shows.
    $effect(() => {
        if ($fullScreenCowebsite && ($menuVisiblilityStore || $chatVisibilityStore)) fullScreenCowebsite.set(false);
    });
    // WA's editor panels ("Explore the room") stack above the room's own layer, the settings dialog included: a menu
    // closes them.
    $effect(() => {
        if ($menuVisiblilityStore && $mapEditorModeStore) {
            mapEditorModeStore.switchMode(false);
            gameManager.getCurrentGameScene().getMapEditorModeManager()?.equipTool(EditorToolName.CloseMapEditor);
        }
    });

    // As in WA's own background panel: the camera runs for the preview while the backgrounds are open, even when off.
    $effect(() => {
        inBackgroundSettingsStore.set(backgroundsOpen && tray === "cam");
    });

    onDestroy(() => {
        inBackgroundSettingsStore.set(false);
        document.documentElement.classList.remove("quanta-tray-open");
        stopHandsBridge();
        stopAwayBridge();
        stopSidePanel();
        closeHandPicker?.();
        closeMoreMenu?.();
    });
</script>

<svelte:document onpointerdown={onDocumentPointerDown} />

<!-- WA lists devices only once a stream has run: until then the tray says why, as WA's media panel does. -->
{#snippet noDevices(note: string, action: string | undefined, onclick: () => void)}
    <span class="qd-note">{note}</span>
    {#if action}
        <button type="button" class="qd-chip" {onclick}>{action}</button>
    {/if}
{/snippet}

{#snippet sideButtons()}
    <!-- The people list lives in the chat panel, which a room without chat doesn't have (ChatSidebar.svelte). -->
    {#if userListEnabled && chatEnabledInAdmin}
        <button
            type="button"
            class="qd-icon"
            disabled={!chatAvailable}
            aria-label={$QL.people()}
            data-tip={$QL.people()}
            data-testid="user-list-button"
            onclick={togglePeople}
        >
            <Icon name="people" />
        </button>
    {/if}
    <!-- Chat only where the platform turned it on: Quanta keeps chat off in its rooms, the proximity chat too. -->
    {#if chatEnabledInAdmin}
        <button
            type="button"
            class="qd-icon"
            disabled={!chatAvailable}
            aria-label={$QL.chat()}
            data-tip={$QL.chat()}
            data-testid="chat-btn"
            onclick={toggleChat}
        >
            <Icon name="chat" />
            {#if $mentionMarksStore.size > 0}<span class="qd-badge mention" aria-label={$QL.mentionedYou()}>@</span
                >{:else if unread > 0}<span class="qd-badge">{unread > 99 ? "99+" : unread}</span>{/if}
        </button>
    {/if}
{/snippet}

{#if $userIsAdminStore}
    <ActivityFeed bottom={standOn + 8} />
{/if}

<!-- Outside the dock, which the transform would hold it to and which a covering chat takes away. Directly above the dock:
     the call's tiles have the top of the room. Over a covering chat, under its tabs and audience row. -->
{#if $studentViewStore}
    <div
        class="qd-student-view"
        class:over-chat={studentViewOverChat}
        bind:clientHeight={studentViewHeight}
        bind:clientWidth={studentViewWidth}
        style:left={`${studentViewCentre}px`}
        style:bottom={studentViewOverChat ? undefined : `${studentViewBottom}px`}
        style:max-width={`${Math.max(roomWidth - (studentViewOverChat ? 32 : ZOOM_CLEARANCE + 16), 200)}px`}
        role="status"
        title={$QL.studentViewTip()}
        data-testid="quanta-student-view"
    >
        <span class="qd-student-view-text">{$QL.studentViewNotice()}</span>
        <button
            type="button"
            title={$QL.studentViewTip()}
            aria-label={$QL.stopStudentView()}
            onclick={() => setStudentView(false)}>{$QL.studentViewExit()}</button
        >
    </div>
{/if}

    <!-- A phone's ⋮ is a sheet (quanta-ui.css): the room dims behind it, and a tap there closes it. -->
    {#if $phoneLayoutStore && $openedMenuStore === "profileMenu"}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div class="qd-sheet-dim" onclick={() => openedMenuStore.close("profileMenu")}></div>
    {/if}
    <div
        class="quanta-dock"
        bind:this={dockRow}
        class:room-860={roomWidth <= 860 || $phoneLayoutStore}
        class:room-740={roomWidth <= 740 || $phoneLayoutStore}
        class:room-600={roomWidth <= 600 || $phoneLayoutStore}
        class:phone={$phoneLayoutStore}
        class:fold-1={foldLevel >= 1}
        class:fold-2={foldLevel >= 2}
        class:fold-3={foldLevel >= 3}
        class:fold-4={foldLevel >= 4}
        class:fold-megaphone={folded("megaphone")}
        class:rec-in-dock={recordingSpace < REC_SHORT_WIDTH}
        style:right={`${sideColumn}px`}
        style:--qd-gutter-left={`${$dockGuttersStore.left}px`}
        style:--qd-gutter-right={`${$dockGuttersStore.right}px`}
        data-testid="quanta-dock"
    >
        <div
            class="qd-dock"
            class:open={tray !== undefined}
            bind:this={dock}
            bind:clientHeight={dockHeight}
            bind:clientWidth={dockWidth}
            onkeydown={(event) => {
                if (event.key === "Escape") closeTray();
            }}
            role="toolbar"
            tabindex="-1"
        >
            <!-- Its notices not over a tray or a menu opening above the dock; the recording pill always. -->
            <OnAirStrip
                noticesHidden={tray !== undefined ||
                    $activeSecondaryZoneActionBarStore === "emote" ||
                    $openedMenuStore === "profileMenu" ||
                    $popupStore.length > 0}
                prompt={onAirStatus}
                staff={$userIsAdminStore}
                {levels}
                speakers={onAirSpeakers}
                stepAgain={$spotStandingStore === "stepAgain"}
                megaphoneHint={$dockHintStore === "megaphone"}
                notHeard={$notHeardHintStore}
                ondismissnotheard={dismissNotHeardHint}
                maxWidth={roomWidth - 24}
                micToggleDisabled={micDisabled}
                onmicon={turnMicrophoneOnToSpeak}
                onaudiosettings={() => toggleTray("mic")}
                ondismissquiet={() => (quietDismissed = true)}
                ondismisshint={() => dismissHint("megaphone")}
                weakLink={$weakLinkNoticeStore}
                oncameraon={turnCameraBackOn}
                ondismissweaklink={dismissWeakLinkNotice}
            />

            <div class="qd-tray-wrap">
                <div class="qd-tray-clip">
                    {#if shownTray === "mic"}
                        <div class="qd-tray" class:shown={tray === "mic"} inert={tray !== "mic"}>
                            {#if $microphoneListStore && $microphoneListStore.length > 0}
                                <DeviceSelect
                                    icon="mic"
                                    label={$LL.actionbar.subtitle.microphone()}
                                    devices={$microphoneListStore}
                                    selectedId={selectedMicrophoneId}
                                    fallbackLabel={(index) => $QL.microphoneNumber({ index })}
                                    onselect={selectMicrophone}
                                    testId="quanta-microphone-select"
                                />
                            {:else}
                                {@render noDevices(
                                    micDenied
                                        ? $LL.camera.help.microphoneTooltip.permissionDeniedTitle()
                                        : $LL.actionbar.microphone.disabled(),
                                    micDenied ? undefined : $QL.microphoneOn(),
                                    toggleMicrophone,
                                )}
                            {/if}
                            {#if $speakerListStore && $speakerListStore.length > 0}
                                <DeviceSelect
                                    icon="speaker"
                                    label={$LL.actionbar.subtitle.speaker()}
                                    devices={$speakerListStore}
                                    selectedId={$speakerSelectedStore}
                                    fallbackLabel={(index) => $QL.speakerNumber({ index })}
                                    onselect={selectSpeaker}
                                    testId="quanta-speaker-select"
                                />
                            {/if}
                            <button
                                type="button"
                                class="qd-gear"
                                aria-label={$QL.audioSettings()}
                                data-tip={$QL.audioSettings()}
                                onclick={() => openSettings("microphone")}
                            >
                                <Icon name="settings" size={22} />
                            </button>
                        </div>
                    {:else if shownTray === "cam"}
                        <div class="qd-tray" class:shown={tray === "cam"} inert={tray !== "cam"}>
                            {#if $cameraListStore && $cameraListStore.length > 0}
                                <DeviceSelect
                                    icon="videocam"
                                    label={$LL.actionbar.subtitle.camera()}
                                    devices={$cameraListStore}
                                    selectedId={selectedCameraId}
                                    fallbackLabel={(index) => $QL.cameraNumber({ index })}
                                    onselect={selectCamera}
                                    testId="quanta-camera-select"
                                />
                            {:else}
                                {@render noDevices(
                                    camDenied
                                        ? $LL.camera.help.tooltip.permissionDeniedTitle()
                                        : $LL.actionbar.camera.disabled(),
                                    camDenied ? undefined : $QL.cameraOn(),
                                    toggleCamera,
                                )}
                            {/if}
                            {#if $backgroundProcessingSupportedStore}
                                <!-- Round icon chips: the camera's name needs the width more than their labels. -->
                                <button
                                    type="button"
                                    class="qd-chip round"
                                    aria-pressed={blurOn}
                                    aria-label={$LL.actionbar.background.blur()}
                                    data-tip={$LL.actionbar.background.blur()}
                                    data-testid="quanta-blur"
                                    onclick={toggleBlur}
                                >
                                    <Icon name="blur" size={22} />
                                </button>
                                <button
                                    type="button"
                                    class="qd-chip round"
                                    aria-pressed={$backgroundConfigStore.mode === "image"}
                                    aria-expanded={backgroundsOpen}
                                    aria-label={$QL.backgrounds()}
                                    data-tip={$QL.backgrounds()}
                                    data-testid="quanta-backgrounds-button"
                                    onclick={() => (backgroundsOpen = !backgroundsOpen)}
                                >
                                    <Icon name="backgrounds" size={22} />
                                </button>
                            {/if}
                            <button
                                type="button"
                                class="qd-gear"
                                aria-label={$QL.videoSettings()}
                                data-tip={$QL.videoSettings()}
                                onclick={() => openSettings(undefined)}
                            >
                                <Icon name="settings" size={22} />
                            </button>
                        </div>
                    {/if}
                </div>
            </div>

            {#if backgroundsOpen && tray === "cam"}
                <div class="qd-backgrounds" data-testid="quanta-backgrounds">
                    <BackgroundSettingsPanel />
                </div>
            {/if}

            <div class="qd-buttons">
                <!-- In a narrow room the row has no ground beside the dock: the indicator is the dock's first cell. -->
                <span class="qd-rec-inline"><RoomRecordingIndicator size="cell" /></span>
                <!-- On air to the whole class (podium or a megaphone spot): a floor given is handed back with the hand.
                     Staff have it at all times, to speak to the class from anywhere. -->
                {#if onAir || canSpeakToClass}
                    <div class="qd-on-air" data-fold="megaphone" transition:grow>
                        <!-- With the microphone off nothing reaches the class: not lit as on air, and the tip says why. -->
                        <button
                            type="button"
                            class="qd-button"
                            class:live={onAir}
                            class:muted={onAir && $selfOnAirMutedStore}
                            aria-pressed={canSpeakToClass ? onAir : undefined}
                            aria-label={onAir ? $QL.stopSpeakingToClass() : $QL.speakToClass()}
                            data-tip={onAir
                                ? $selfOnAirMutedStore
                                    ? $QL.onAirMicOff()
                                    : $QL.stopSpeakingToClass()
                                : $QL.speakToClass()}
                            data-testid={onAir ? "stop-speaking-button" : "speak-to-class-button"}
                            onclick={onAir ? stopSpeakingToClass : startSpeakingToClass}
                        >
                            <Icon name="campaign" />
                        </button>
                        <span class="qd-divider" aria-hidden="true"></span>
                    </div>
                {/if}
                {#if !$inExternalServiceStore && $proximityMeetingStore && $myMicrophoneStore}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        class="qd-split"
                        class:off={!micOn}
                        onmouseenter={() => (devicesHovered = true)}
                        onmouseleave={() => (devicesHovered = false)}
                    >
                        <button
                            type="button"
                            class="qd-split-toggle"
                            class:open={tray === "mic"}
                            aria-label={$QL.audioSettings()}
                            aria-expanded={tray === "mic"}
                            data-tip={$QL.audioSettings()}
                            onclick={() => toggleTray("mic")}
                        >
                            {#if micOn && micCapturing && tray !== "mic"}
                                <span class="qd-level" aria-hidden="true">
                                    {#each levels as level, i (i)}
                                        <i style:--level={level}></i>
                                    {/each}
                                </span>
                            {/if}
                            <span class="qd-chevron"><Icon name="chevronUp" size={20} /></span>
                        </button>
                        <button
                            type="button"
                            class="qd-button"
                            class:off={!micOn}
                            disabled={micDisabled}
                            aria-pressed={micOn}
                            aria-label={micOn ? $QL.microphoneOff() : $QL.microphoneOn()}
                            data-tip={micOn ? $QL.microphoneOff() : $QL.microphoneOn()}
                            data-testid="microphone-button"
                            onclick={toggleMicrophone}
                        >
                            <Icon name={micOn ? "mic" : "micOff"} />
                        </button>
                    </div>
                {/if}

                {#if !$inExternalServiceStore && $myCameraStore}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <div
                        class="qd-split"
                        class:off={!camOn}
                        onmouseenter={() => (devicesHovered = true)}
                        onmouseleave={() => (devicesHovered = false)}
                    >
                        <button
                            type="button"
                            class="qd-split-toggle"
                            class:open={tray === "cam"}
                            aria-label={$QL.videoSettings()}
                            aria-expanded={tray === "cam"}
                            data-tip={$QL.videoSettings()}
                            onclick={() => toggleTray("cam")}
                        >
                            <span class="qd-chevron"><Icon name="chevronUp" size={20} /></span>
                        </button>
                        <button
                            type="button"
                            class="qd-button"
                            class:off={!camOn}
                            disabled={camDisabled || $cameraHeldStore}
                            aria-pressed={camOn}
                            aria-label={$cameraHeldStore ? $QL.cameraHeld() : camOn ? $QL.cameraOff() : $QL.cameraOn()}
                            data-tip={$cameraHeldStore ? $QL.cameraHeld() : camOn ? $QL.cameraOff() : $QL.cameraOn()}
                            data-testid="camera-button"
                            onclick={toggleCamera}
                        >
                            <Icon name={camOn ? "videocam" : "videocamOff"} />
                        </button>
                    </div>
                {/if}

                <span class="qd-divider" aria-hidden="true"></span>
                {#if isScreenSharingSupported()}
                    <button
                        type="button"
                        class="qd-button"
                        class:on={sharing}
                        disabled={!$screenSharingActivatedStore || (!sharing && !$screenSharingAvailableStore)}
                        aria-pressed={sharing}
                        aria-label={sharing ? $QL.stopSharing() : $LL.actionbar.help.share.title()}
                        data-tip={sharing ? $QL.stopSharing() : $LL.actionbar.help.share.title()}
                        data-testid="screenShareButton"
                        data-fold="share"
                        onclick={toggleScreenSharing}
                    >
                        <Icon name={sharing ? "stopShare" : "share"} />
                    </button>
                {/if}

                {#if $isInRemoteConversation && $pictureInPictureSupportedStore}
                    <button
                        type="button"
                        class="qd-button"
                        class:on={$activePictureInPictureStore}
                        aria-pressed={$activePictureInPictureStore}
                        aria-label={$LL.actionbar.help.pictureInPicture.title()}
                        data-tip={$LL.actionbar.help.pictureInPicture.title()}
                        data-testid="pictureInPictureButton"
                        data-wide
                        onclick={togglePictureInPicture}
                    >
                        <Icon name="pictureInPicture" />
                    </button>
                {/if}

                <!-- Reactions: the hint points here the first times others react, until the picker is opened once. -->
                <span class="qd-anchor" data-fold="reactions">
                    <button
                        type="button"
                        class="qd-button"
                        class:on={$activeSecondaryZoneActionBarStore === "emote"}
                        aria-pressed={$activeSecondaryZoneActionBarStore === "emote"}
                        aria-label={$QL.reactions()}
                        data-tip={$QL.reactions()}
                        data-testid="emoji-btn"
                        use:emojiRef
                        onclick={toggleEmoji}
                    >
                        <Icon name="addReaction" />
                    </button>
                    {#if $dockHintStore === "reactions" && $activeSecondaryZoneActionBarStore !== "emote"}
                        <span class="qd-hint" role="status" data-testid="quanta-reactions-hint">
                            <span>{$QL.reactionsHint()}</span>
                            <button
                                type="button"
                                class="qd-hint-close"
                                aria-label={$QL.closeHint()}
                                onclick={() => dismissHint("reactions")}
                            >
                                <Icon name="close" size={16} />
                            </button>
                        </span>
                    {/if}
                </span>
                {#if $activeSecondaryZoneActionBarStore === "emote"}
                    <div use:emojiContent class="absolute">
                        <EmojiSubMenu arrowAction={emojiArrow} />
                    </div>
                {/if}

                {#if !$inExternalServiceStore}
                    <button
                        type="button"
                        class="qd-button"
                        class:on={$isHandRaisedStore && !$givenFloorSpaceStore}
                        class:live={$givenFloorSpaceStore !== undefined}
                        disabled={!$givenFloorSpaceStore && !$raiseHandAvailableStore}
                        aria-pressed={$isHandRaisedStore}
                        aria-label={handLabel}
                        data-tip={handLabel}
                        data-testid="raise-hand-button"
                        data-fold="hand"
                        bind:this={handButton}
                        onclick={onHandClick}
                    >
                        <Icon name="hand" />
                    </button>
                {/if}

                <button
                    type="button"
                    class="qd-button narrow"
                    class:on={$openedMenuStore === "profileMenu"}
                    aria-haspopup="menu"
                    aria-expanded={$openedMenuStore === "profileMenu"}
                    aria-label={$QL.moreOptions()}
                    data-tip={$QL.moreOptions()}
                    data-testid="action-user"
                    bind:this={moreButton}
                    onclick={() => openedMenuStore.toggle("profileMenu")}
                >
                    <Icon name="more" />
                </button>
                {#if embedded}
                    <span class="qd-divider" aria-hidden="true"></span>
                    <button
                        type="button"
                        class="qd-button leave"
                        aria-label={$QL.leave()}
                        data-tip={$QL.leave()}
                        data-testid="quanta-leave"
                        onclick={leaveRoom}
                    >
                        <Icon name="leave" />
                    </button>
                {/if}
                <span class="qd-inline">{@render sideButtons()}</span>
            </div>
        </div>

        <div class="qd-side" bind:this={sideBox}>{@render sideButtons()}</div>
        <!-- The row's left end, as People and Chat are its right: where a call app puts what concerns the whole call. -->
        <div class="qd-rec-side" bind:this={recSideBox}><RoomRecordingIndicator size="row" space={recordingSpace} /></div>

        <!-- Buttons the room script puts in WA's top bar stay in sight (its recording pill sits above the dock). -->
        <!-- Inside the map's rounded window, which a co-website pushes down on a portrait screen. -->
        {#if roomButtons.length > 0 && !$fullScreenCowebsite && $canvasSize.height >= 200 && $canvasSize.width >= 200}
            <div
                class="qd-top"
                data-testid="quanta-room-buttons"
                bind:this={roomButtonsBox}
                style:max-width={`${Math.max($canvasSize.width - 48, 0)}px`}
                style:top={`${24 + ($coWebsites.length > 0 && $windowSize.width <= $windowSize.height ? $coWebsitesSize.height : 0)}px`}
            >
                {#each roomButtons as button (button.id)}
                    {@const ButtonComponent = button.component}
                    <div data-room-button={button.id}>
                        <ButtonComponent {...button.props} />
                    </div>
                {/each}
            </div>
        {/if}
    </div>

<style>
    /* Meet's dark call controls, measured at 2x, in Quanta's slate greys. */
    .quanta-dock {
        --qd-panel: #181b21;
        --qd-segment: #21252c;
        --qd-button: #2b3038;
        --qd-text: #eceef1;
        --qd-muted: #a7adb7;
        --qd-on: #c9d5ea;
        --qd-on-text: #1d2b45;
        --qd-off: #f9dedc;
        --qd-off-text: #8c1d18;
        --qd-off-segment: #601410;
        --qd-live: #80da88;
        --qd-leave: #dc362e;
        --qd-live-text: #0b3d13;
        --qd-outline: #8e918f;
        --qd-ease: cubic-bezier(0.2, 0, 0, 1);
        position: fixed;
        inset: auto 0 0 0;
        height: 84px;
        z-index: 950;
        pointer-events: none;
        color: var(--qd-text);
        font-family: inherit;
    }

    /* Centred in the row, between what the platform keeps at its ends (dockBar.ts). */
    .qd-dock {
        position: absolute;
        left: calc(var(--qd-gutter-left, 0px) + (100% - var(--qd-gutter-left, 0px) - var(--qd-gutter-right, 0px)) / 2);
        bottom: 12px;
        transform: translateX(-50%);
        /* Its buttons' own width, never squeezed by the half-width an absolute box gets: fitDock folds instead. */
        width: max-content;
        display: flex;
        flex-direction: column;
        align-items: stretch;
        padding: 12px 14px;
        border-radius: 36px;
        background: var(--qd-panel);
        pointer-events: auto;
        outline: none;
        transition: padding 0.25s var(--qd-ease);
    }

    .qd-dock.open {
        padding-top: 12px;
    }

    /* The tray never widens the dock: the buttons set its width and the tray fills it. */
    .qd-tray-wrap {
        width: 0;
        min-width: 100%;
        display: grid;
        grid-template-rows: 0fr;
        transition: grid-template-rows 0.25s var(--qd-ease);
    }

    .open .qd-tray-wrap {
        grid-template-rows: 1fr;
    }

    .qd-tray-clip {
        min-height: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr);
    }

    /* Clipped while it grows; the device lists then open above it. */
    .qd-tray-clip {
        overflow: hidden;
    }

    .open .qd-tray-clip {
        animation: qd-unclip 0s 0.25s forwards;
    }

    @keyframes qd-unclip {
        to {
            overflow: visible;
        }
    }

    .qd-tray {
        min-width: 0;
        display: flex;
        gap: 14px;
        align-items: center;
        padding-bottom: 14px;
        opacity: 0;
        transform: translateY(6px);
        transition:
            opacity 0.15s,
            transform 0.25s var(--qd-ease);
    }

    .qd-tray.shown {
        opacity: 1;
        transform: none;
        transition:
            opacity 0.2s 0.05s,
            transform 0.25s var(--qd-ease);
    }

    .qd-tray :global(.qd-select) {
        position: relative;
        flex: 1 1 0;
        min-width: 0;
    }

    .qd-tray :global(.qd-select-button) {
        width: 100%;
        height: 42px;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 0 10px 0 14px;
        border: 1px solid var(--qd-outline);
        border-radius: 9999px;
        background: transparent;
        color: inherit;
        font-size: 15px;
        cursor: pointer;
    }

    .qd-tray :global(.qd-select-button span) {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        text-align: start;
    }

    .qd-tray :global(.qd-select-button svg) {
        flex: none;
    }

    .qd-tray :global(.qd-list) {
        position: absolute;
        left: 0;
        bottom: calc(100% + 8px);
        min-width: 100%;
        width: max-content;
        max-width: 360px;
        max-height: 280px;
        overflow-y: auto;
        margin: 0;
        padding: 8px 0;
        list-style: none;
        border-radius: 12px;
        background: var(--qd-panel);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
    }

    .qd-tray :global(.qd-list button) {
        width: 100%;
        white-space: nowrap;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 16px 10px 12px;
        border: 0;
        background: transparent;
        color: inherit;
        font-size: 14px;
        text-align: start;
        cursor: pointer;
    }

    .qd-tray :global(.qd-list button:hover),
    .qd-tray :global(.qd-list button:focus-visible),
    .qd-tray :global(.qd-select-button:hover),
    .qd-gear:hover,
    .qd-icon:hover:not(:disabled) {
        background: rgba(255, 255, 255, 0.08);
    }

    .qd-tray :global(.qd-list button span:last-child) {
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .qd-tray :global(.qd-check) {
        width: 20px;
        flex: none;
        display: flex;
    }

    /* Wraps to a second line rather than cutting off when the tray is narrow (the room beside a lesson). */
    .qd-note {
        flex: 1 1 0;
        min-width: 0;
        padding-left: 6px;
        color: var(--qd-muted);
        font-size: 14px;
        line-height: 18px;
        overflow-wrap: anywhere;
    }

    .qd-chip {
        flex: none;
        height: 42px;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 0 16px;
        border: 0;
        border-radius: 9999px;
        background: var(--qd-button);
        color: inherit;
        font-size: 15px;
        white-space: nowrap;
        cursor: pointer;
    }

    .qd-chip.round {
        width: 42px;
        padding: 0;
        justify-content: center;
    }

    .qd-chip:hover {
        filter: brightness(1.12);
    }

    .qd-chip[aria-pressed="true"] {
        background: var(--qd-on);
        color: var(--qd-on-text);
    }

    .qd-gear {
        flex: none;
        width: 42px;
        height: 42px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 9999px;
        background: transparent;
        color: inherit;
        cursor: pointer;
    }

    .qd-backgrounds {
        position: absolute;
        right: 0;
        bottom: calc(100% + 8px);
        width: 288px;
        max-height: min(520px, calc(100vh - 140px));
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 12px;
        border-radius: 16px;
        background: var(--qd-panel);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
    }

    .qd-buttons {
        display: flex;
        gap: 14px;
        align-items: center;
    }

    .qd-on-air {
        display: flex;
        gap: 14px;
        align-items: center;
        flex: none;
    }

    .qd-on-air .qd-button.live {
        animation: qd-on-air 1.8s ease-out infinite;
    }

    @keyframes qd-on-air {
        0% {
            box-shadow: 0 0 0 0 rgba(128, 218, 136, 0.55);
        }
        70%,
        100% {
            box-shadow: 0 0 0 10px rgba(128, 218, 136, 0);
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .qd-on-air .qd-button {
            animation: none;
        }
    }

    /* Hairlines between the devices, the actions and leaving. */
    .qd-divider {
        width: 1px;
        height: 28px;
        margin: 0 -2px;
        background: rgba(255, 255, 255, 0.12);
    }

    .qd-button {
        width: 56px;
        height: 48px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 9999px;
        background: var(--qd-button);
        color: var(--qd-text);
        cursor: pointer;
        transition: filter 0.15s;
    }

    .qd-button:hover:not(:disabled) {
        filter: brightness(1.15);
    }

    /* Dimmed by its parts, not as a whole: the tooltip (::after) saying why stays readable. */
    .qd-button:disabled {
        background: color-mix(in srgb, var(--qd-button) 50%, transparent);
        cursor: not-allowed;
    }

    .qd-button:disabled > :global(*) {
        opacity: 0.5;
    }

    .qd-button.narrow {
        width: 40px;
    }

    .qd-button.on {
        background: var(--qd-on);
        color: var(--qd-on-text);
    }

    .qd-button.off {
        background: var(--qd-off);
        color: var(--qd-off-text);
    }

    .qd-button.leave {
        width: 72px;
        background: var(--qd-leave);
        color: #fff;
    }

    .qd-button.live {
        background: var(--qd-live);
        color: var(--qd-live-text);
    }

    .qd-on-air .qd-button.live.muted {
        background: var(--qd-button);
        color: var(--qd-text);
        animation: none;
    }

    .qd-split {
        display: flex;
        align-items: center;
        border-radius: 9999px;
        background: var(--qd-segment);
    }

    .qd-split.off {
        background: var(--qd-off-segment);
    }

    .qd-split .qd-button {
        width: 48px;
    }

    .qd-split-toggle {
        width: 40px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 9999px 0 0 9999px;
        background: transparent;
        color: var(--qd-muted);
        cursor: pointer;
    }

    .qd-split.off .qd-split-toggle {
        color: var(--qd-off);
    }

    .qd-chevron {
        display: flex;
        transition: transform 0.25s var(--qd-ease);
    }

    .qd-split-toggle.open .qd-chevron {
        transform: rotate(180deg);
    }

    /* While the microphone is on, the level replaces the arrow until the pointer is on it. */
    .qd-level {
        display: flex;
        gap: 3px;
        align-items: center;
        height: 14px;
    }

    .qd-level i {
        width: 3px;
        height: calc(4px + var(--level) * 10px);
        border-radius: 2px;
        background: var(--qd-on);
        transition: height 0.1s linear;
    }

    .qd-level + .qd-chevron {
        display: none;
    }

    .qd-split-toggle:hover .qd-level {
        display: none;
    }

    .qd-split-toggle:hover .qd-level + .qd-chevron {
        display: flex;
    }

    /* Under the zoom column (24px from the right, 48px wide) and level with the dock's buttons (12px from the
       bottom, 12px padding). */
    .qd-side {
        position: absolute;
        right: 24px;
        bottom: 24px;
        display: flex;
        gap: 4px;
        pointer-events: auto;
    }

    .qd-top {
        position: fixed;
        top: 24px;
        left: 24px;
        display: flex;
        flex-wrap: wrap;
        overflow: hidden;
        gap: 8px;
        pointer-events: auto;
    }

    .qd-icon {
        position: relative;
        width: 48px;
        height: 48px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 9999px;
        background: var(--qd-panel);
        color: var(--qd-text);
        cursor: pointer;
    }

    .qd-icon:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .qd-badge {
        position: absolute;
        top: 4px;
        right: 2px;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: 9999px;
        background: var(--qd-on);
        color: var(--qd-on-text);
        font-size: 11px;
        font-weight: 600;
        line-height: 18px;
    }

    /* Someone named this viewer: the chats' own "for you" amber (ChatPanelHeader.svelte). */
    .qd-badge.mention {
        background: #f2c14e;
        color: #1b1f26;
        font-weight: 700;
    }

    [data-tip] {
        position: relative;
    }

    /* Not over the button's own pop-up (the emoji picker, a tray) while it is open. Not on a touch screen either, where
       a tapped button keeps its hover and the tip stayed up over the map. */
    [data-tip]:not([aria-pressed="true"], [aria-expanded="true"]):hover::after {
        content: attr(data-tip);
        position: absolute;
        bottom: calc(100% + 10px);
        left: 50%;
        transform: translateX(-50%);
        padding: 6px 10px;
        border-radius: 6px;
        background: #e3e3e3;
        color: #1f1f1f;
        font-size: 12px;
        line-height: 16px;
        white-space: nowrap;
        pointer-events: none;
        transition-delay: 0.5s;
    }

    /* The dock's first button: its tip runs right from it rather than past the room's left edge. */
    .qd-on-air [data-tip]:hover::after {
        left: 0;
        transform: none;
    }

    @media (hover: none) {
        [data-tip]:not([aria-pressed="true"], [aria-expanded="true"]):hover::after {
            display: none;
        }
    }

    /* Under a presented board (the page's, over this frame) the tip would be hidden: the browser's tooltip names the
       button instead (stage.ts). */
    :global(html[data-quanta-board-on]) [data-tip]:hover::after {
        display: none;
    }

    /* In the room's notice shape (Notice.svelte), its one action in the notices' action colour. */
    .qd-student-view {
        position: fixed;
        transform: translateX(-50%);
        /* Under the dock's own tips and menus, which it stays clear of anyway. */
        z-index: 949;
        box-sizing: border-box;
        width: max-content;
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 44px;
        padding: 6px 6px 6px 14px;
        border: 1px solid rgb(255 255 255 / 0.07);
        border-radius: 14px;
        background: rgb(29 32 39 / 0.97);
        box-shadow:
            0 1px 2px rgb(0 0 0 / 0.3),
            0 8px 24px rgb(0 0 0 / 0.28);
        color: #e3e6ea;
        font-size: 14px;
        line-height: 20px;
        pointer-events: auto;
    }

    /* Above the chat (z 2000 in Chat), which also has the dock's place while it covers the room. */
    .qd-student-view.over-chat {
        top: 116px;
        z-index: 2001;
    }

    /* The room's own recording indicator (RoomRecordingIndicator.svelte): the row's left end, or the dock's first cell. */
    .qd-rec-side {
        position: absolute;
        left: 24px;
        bottom: 24px;
        display: flex;
        pointer-events: auto;
    }

    .qd-rec-inline {
        display: none;
    }

    .qd-sheet-dim {
        position: fixed;
        inset: 0;
        z-index: 1050;
        background: rgb(0 0 0 / 0.5);
        pointer-events: auto;
    }

    .qd-student-view-text {
        min-width: 0;
    }

    .qd-student-view button {
        flex-shrink: 0;
        height: 32px;
        padding: 0 14px;
        border-radius: 9999px;
        background: #c9d5ea;
        color: #1d2b45;
        font-size: 13.5px;
        font-weight: 600;
        white-space: nowrap;
        cursor: pointer;
    }

    .qd-anchor {
        position: relative;
        display: inline-flex;
    }

    /* Above its button, pointing at it; the button's own tip stays away while it is up. */
    .qd-hint {
        position: absolute;
        bottom: calc(100% + 14px);
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px 6px 6px 14px;
        border-radius: 12px;
        background: var(--qd-on);
        color: var(--qd-on-text);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
        font-size: 14px;
        line-height: 18px;
        font-weight: 500;
        white-space: nowrap;
    }

    .qd-hint::after {
        content: "";
        position: absolute;
        top: 100%;
        left: 50%;
        margin-left: -7px;
        border: 7px solid transparent;
        border-top-color: var(--qd-on);
    }

    .qd-hint-close {
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 9999px;
        background: transparent;
        color: inherit;
        cursor: pointer;
    }

    .qd-hint-close:hover {
        background: rgba(0, 0, 0, 0.08);
    }

    .qd-anchor:has(.qd-hint) [data-tip]:hover::after {
        display: none;
    }

    .qd-inline {
        display: none;
        gap: 14px;
    }

    .qd-inline .qd-icon {
        width: 40px;
        background: var(--qd-button);
    }

    /* Narrower rooms (the window less the side column) step down so the dock always fits, every control kept for as
       long as a laptop could need it (the room beside a lesson is 420px and up): first People and Chat join the dock
       and picture-in-picture leaves it, then tighter buttons, then round 44px ones without dividers (524px wide),
       then the device arrows go (devices stay in Settings), and only below any laptop's room screen sharing and
       reactions (phones can't share anyway). Widths measured with every button in. */
    :where(.quanta-dock.room-860) .qd-side,
    :where(.quanta-dock.room-860) .qd-rec-side,
    :where(.quanta-dock.rec-in-dock) .qd-rec-side {
        display: none;
    }

    :where(.quanta-dock.room-860) .qd-rec-inline,
    :where(.quanta-dock.rec-in-dock) .qd-rec-inline {
        display: contents;
    }

    :where(.quanta-dock.room-860) .qd-inline {
        display: contents;
    }

    :where(.quanta-dock.room-860) .qd-buttons > [data-wide] {
        display: none;
    }

    :where(.quanta-dock.room-740) .qd-dock {
        padding: 10px;
        bottom: 8px;
    }

    :where(.quanta-dock.room-740) .qd-buttons,
    :where(.quanta-dock.room-740) .qd-tray {
        gap: 8px;
    }

    :where(.quanta-dock.room-740) .qd-button {
        width: 48px;
    }

    :where(.quanta-dock.room-740) .qd-split .qd-button {
        width: 44px;
    }

    :where(.quanta-dock.room-740) .qd-split-toggle {
        width: 32px;
    }

    :where(.quanta-dock.room-740) .qd-button.leave {
        width: 56px;
    }

    :where(.quanta-dock.room-600) .qd-buttons,
    :where(.quanta-dock.room-600) .qd-tray {
        gap: 6px;
    }

    :where(.quanta-dock.room-600) .qd-divider {
        display: none;
    }

    :where(.quanta-dock.room-600) .qd-button,
    :where(.quanta-dock.room-600) .qd-split .qd-button,
    :where(.quanta-dock.room-600) .qd-split-toggle,
    :where(.quanta-dock.room-600) .qd-inline .qd-icon {
        width: 44px;
        height: 44px;
    }

    :where(.quanta-dock.room-600) .qd-split-toggle {
        width: 28px;
    }

    :where(.quanta-dock.room-600) .qd-button.narrow {
        width: 40px;
    }

    :where(.quanta-dock.room-600) .qd-button.leave {
        width: 52px;
    }

    /* Folded into ⋮ when the row can't hold them (fitDock), least needed first. Phones choose devices in Settings. */
    :where(.quanta-dock.fold-1) [data-fold="reactions"],
    :where(.quanta-dock.fold-2) [data-fold="hand"],
    :where(.quanta-dock.fold-3) [data-fold="share"],
    :where(.quanta-dock.fold-4, .quanta-dock.phone) .qd-split-toggle {
        display: none;
    }

    /* A phone's six (dockFold.ts PHONE_FOLDS); its recording shows in the page's top bar instead. */
    :where(.quanta-dock.phone) [data-fold="reactions"],
    :where(.quanta-dock.phone) [data-fold="share"],
    :where(.quanta-dock.fold-megaphone) [data-fold="megaphone"],
    .quanta-dock.phone .qd-rec-inline {
        display: none;
    }

    @media (prefers-reduced-motion: reduce) {
        .qd-dock,
        .qd-tray-wrap,
        .qd-tray,
        .qd-chevron {
            transition: none;
        }
    }
</style>
