<script lang="ts">
    // quanta: the call controls docked at the bottom like Google Meet's, with the device trays that open above
    // them. Drives the same stores as WA's action bar (ActionBar.svelte), which QUANTA_UI replaces.
    import { AvailabilityStatus } from "@workadventure/messages";
    import { onDestroy } from "svelte";
    import { derived, get } from "svelte/store";
    import { analyticsClient } from "../Administration/AnalyticsClient";
    import { navChat } from "../Chat/Stores/ChatStore";
    import { selectedRoomStore } from "../Chat/Stores/SelectRoomStore";
    import { localUserStore } from "../Connection/LocalUserStore";
    import { gameManager } from "../Phaser/Game/GameManager";
    import { EditorToolName } from "../Phaser/Game/MapEditor/MapEditorModeManager";
    import { mapEditorModeStore } from "../Stores/MapEditorStore";
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
    import { notificationPlayingStore } from "../Stores/NotificationStore";
    import { chatNotificationStore } from "../Stores/ProximityNotificationStore";
    import { raiseHandAvailableStore, raiseHandSpacesStore } from "../Stores/RaiseHandAvailabilityStore";
    import { isHandRaisedStore, requestedHandRaiseState } from "../Stores/RaiseHandStore";
    import {
        isScreenSharingSupported,
        requestedScreenSharingState,
        screenSharingAvailableStore,
    } from "../Stores/ScreenSharingStore";
    import { hideActionBarStoreBecauseOfChatBar } from "../Chat/ChatSidebarWidthStore";
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
    import DeviceSelect from "./DeviceSelect.svelte";
    import { QL } from "./i18n";
    import Icon from "./Icon.svelte";
    import { startHandsBridge } from "./handsBridge";
    import { quantaSettingsTabStore } from "./settingsTab";

    type Tray = "mic" | "cam";

    const gameScene = gameManager.getCurrentGameScene();
    const chatEnabledInAdmin = gameScene.room.isChatEnabled;
    const userListEnabled = gameScene.room.isChatOnlineListEnabled;
    const proximityChatRoomManager = gameScene.proximityChatRoomManager;

    // The tray stays rendered while it closes, so it can animate out.
    let tray: Tray | undefined = $state(undefined);
    let shownTray: Tray | undefined = $state(undefined);
    let backgroundsOpen = $state(false);
    let dock: HTMLDivElement | undefined = $state();
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
    // WA releases the microphone and camera while you are alone and still (energy saving): the level shows only
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
        if ($silentStore) return;
        if ($requestedCameraState) requestedCameraState.disableWebcam();
        else requestedCameraState.enableWebcam();
    }

    // Three bars from WA's seven volume bands, like the level Meet shows in place of the arrow.
    let levels = $derived.by(() => {
        const bands = $localVolumeStore ?? [];
        return [0, 1, 2].map((i) => {
            const slice = bands.slice(i * 2, i * 2 + 3);
            const average = slice.length ? slice.reduce((a, b) => a + b, 0) / slice.length : 0;
            return Math.min(1, average / 120);
        });
    });

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

    let sharing = $derived($requestedScreenSharingState && !$silentStore);

    function toggleScreenSharing(): void {
        analyticsClient.trackAdminEvent("meeting.screenshare.toggled");
        if ($silentStore && !$isSpeakerStore) return;
        if ($requestedScreenSharingState) requestedScreenSharingState.disableScreenSharing();
        else requestedScreenSharingState.enableScreenSharing();
    }

    const [emojiRef, emojiContent, emojiArrow] = createFloatingUiActions({ placement: "top" }, 12);

    // The click that opens the picker must not count as a click outside it (svelte-outside skips handled clicks).
    function toggleEmoji(event: MouseEvent): void {
        event.preventDefault();
        if ($activeSecondaryZoneActionBarStore === "emote") {
            activeSecondaryZoneActionBarStore.set(undefined);
        } else {
            activeSecondaryZoneActionBarStore.set("emote");
            openedMenuStore.closeAll();
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
            notificationPlayingStore.playNotification(get(LL).notification.floorGivenBack(), "microphone-off.png");
            return;
        }
        if ($silentStore) return;
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
        if (spaces.length === 0 || !handButton) return;
        const raisedIn = get(requestedHandRaiseState);
        const entries: RaiseHandSpaceEntry[] = spaces.map((space) => ({
            spaceName: space.getName(),
            kind: space.kind ?? "",
            label: spaceLabel(space),
            raised: raisedIn.has(space.getName()),
        }));
        closeHandPicker = showFloatingUi(
            handButton,
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
            8,
            true,
        );
    }

    // ⋮ is WA's profile menu, with every right-hand item of WA's bar (maps, participants, invite...) inside it.
    let closeMoreMenu: (() => void) | undefined;

    function openMoreMenu(): void {
        if (!moreButton || closeMoreMenu) return;
        closeMoreMenu = showFloatingUi(
            moreButton,
            ProfileMenuContent,
            { showContextualMenuItems: true },
            { placement: "top-end" },
            12,
            false,
            true,
            () => {
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
        openChatPanel();
        chatVisibilityStore.set(!$chatVisibilityStore);
        navChat.switchToChat();
        if (!chatEnabledInAdmin) {
            const proximityChatRoom = proximityChatRoomManager.resolveTargetRoom();
            if (proximityChatRoom) {
                selectedRoomStore.set(proximityChatRoom);
                proximityChatRoom.hasUnreadMessages.set(false);
                proximityChatRoom.unreadMessagesCount.set(0);
                chatNotificationStore.clearRoom(proximityChatRoom.id);
                proximityChatRoom.unreadNotificationCount.set(0);
            }
        }
        if ($chatVisibilityStore) analyticsClient.trackAdminEvent("chat.opened");
    }

    function togglePeople(): void {
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
            {#if unread > 0}<span class="qd-badge">{unread > 99 ? "99+" : unread}</span>{/if}
        </button>
    {/if}
{/snippet}

{#if !$hideActionBarStoreBecauseOfChatBar}
    <div class="quanta-dock" data-testid="quanta-dock">
        <div
            class="qd-dock"
            class:open={tray !== undefined}
            bind:this={dock}
            onkeydown={(event) => {
                if (event.key === "Escape") closeTray();
            }}
            role="toolbar"
            tabindex="-1"
        >
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
                            disabled={camDisabled}
                            aria-pressed={camOn}
                            aria-label={camOn ? $QL.cameraOff() : $QL.cameraOn()}
                            data-tip={camOn ? $QL.cameraOff() : $QL.cameraOn()}
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
                        data-optional
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

                <button
                    type="button"
                    class="qd-button"
                    class:on={$activeSecondaryZoneActionBarStore === "emote"}
                    aria-pressed={$activeSecondaryZoneActionBarStore === "emote"}
                    aria-label={$LL.actionbar.help.emoji.title()}
                    data-tip={$LL.actionbar.help.emoji.title()}
                    data-testid="emoji-btn"
                    data-optional
                    use:emojiRef
                    onclick={toggleEmoji}
                >
                    <Icon name="mood" />
                </button>
                {#if $activeSecondaryZoneActionBarStore === "emote"}
                    <div use:emojiContent class="absolute">
                        <EmojiSubMenu arrowAction={emojiArrow} />
                    </div>
                {/if}

                <!-- Always there, as in Meet; WA only takes a raised hand inside a conversation. -->
                {#if !$inExternalServiceStore}
                    {@const handLabel = $givenFloorSpaceStore
                        ? $LL.actionbar.help.giveBackFloor.title()
                        : $isHandRaisedStore
                          ? $QL.lowerHand()
                          : $LL.actionbar.help.raiseHand.title()}
                    <button
                        type="button"
                        class="qd-button"
                        class:on={$isHandRaisedStore && !$givenFloorSpaceStore}
                        class:live={$givenFloorSpaceStore !== undefined}
                        disabled={!$givenFloorSpaceStore && ($silentStore || !$raiseHandAvailableStore)}
                        aria-pressed={$isHandRaisedStore}
                        aria-label={handLabel}
                        data-tip={handLabel}
                        data-testid="raise-hand-button"
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

        <div class="qd-side">{@render sideButtons()}</div>

        <!-- Buttons the room script puts in WA's top bar (Quanta's recording pill) stay in sight. -->
        <!-- Inside the map's rounded window, which a co-website pushes down on a portrait screen. -->
        {#if $additionalRightButtonsMenu.length > 0 && !$fullScreenCowebsite && $canvasSize.height >= 200 && $canvasSize.width >= 200}
            <div
                class="qd-top"
                data-testid="quanta-room-buttons"
                style:max-width={`${Math.max($canvasSize.width - 48, 0)}px`}
                style:top={`${24 + ($coWebsites.length > 0 && $windowSize.width <= $windowSize.height ? $coWebsitesSize.height : 0)}px`}
            >
                {#each $additionalRightButtonsMenu as button (button.id)}
                    {@const ButtonComponent = button.component}
                    <div data-room-button={button.id}><ButtonComponent {...button.props} /></div>
                {/each}
            </div>
        {/if}
    </div>
{/if}

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

    .qd-dock {
        position: absolute;
        left: 50%;
        bottom: 12px;
        transform: translateX(-50%);
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

    .qd-note {
        flex: 1 1 0;
        min-width: 0;
        padding-left: 6px;
        color: var(--qd-muted);
        font-size: 14px;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
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

    .qd-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
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

    .qd-side {
        position: absolute;
        right: 16px;
        bottom: 36px;
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

    [data-tip] {
        position: relative;
    }

    /* Not over the button's own pop-up (the emoji picker, a tray) while it is open. */
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

    .qd-inline {
        display: none;
        gap: 14px;
    }

    .qd-inline .qd-icon {
        width: 40px;
        background: var(--qd-button);
    }

    /* Narrow rooms (the room beside a lesson): People and Chat join the dock instead of a corner. */
    @media (max-width: 860px) {
        .qd-side {
            display: none;
        }

        .qd-inline {
            display: contents;
        }
    }

    /* Picture-in-picture only where the dock has room for an eighth button. */
    @media (max-width: 720px) {
        .qd-buttons > [data-wide] {
            display: none;
        }
    }

    /* Phones: tighter, and without screen sharing (phones cannot share their screen) and reactions, so the
       dock fits a 360px screen. */
    @media (max-width: 480px) {
        .qd-dock {
            padding: 10px;
            bottom: 8px;
        }

        .qd-buttons,
        .qd-tray {
            gap: 8px;
        }

        .qd-buttons > [data-optional] {
            display: none;
        }

        .qd-button {
            width: 48px;
        }

        .qd-split .qd-button {
            width: 44px;
        }

        .qd-split-toggle {
            width: 32px;
        }

        .qd-button.leave {
            width: 56px;
        }
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
