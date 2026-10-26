<script lang="ts">
    // quanta: WA's settings as one dialog in the dock's language (QUANTA_UI). Every control writes the same store or
    // localUserStore key as WA's own SettingsSubMenu.svelte, so the two stay interchangeable.
    import { onMount, tick, untrack } from "svelte";
    import { derived, get } from "svelte/store";
    import { analyticsClient } from "../Administration/AnalyticsClient";
    import { localUserStore } from "../Connection/LocalUserStore";
    import type { BandwidthConstrainedPreference, NoiseSuppressionProvider } from "../Connection/LocalUserStore";
    import { Room } from "../Connection/Room";
    import { gameManager } from "../Phaser/Game/GameManager";
    import {
        audioManagerFileStore,
        audioManagerVisibilityStore,
        audioManagerVolumeStore,
        bubbleSoundStore,
    } from "../Stores/AudioManagerStore";
    import { bandwidthConstrainedPreferenceStore } from "../Stores/BandwidthConstrainedPreferenceStore";
    import { browserNotificationStore } from "../Stores/BrowserNotificationStore";
    import { displayVideoQualityStore } from "../Stores/DisplayVideoQualityStore";
    import { userIsAdminStore } from "../Stores/GameStore";
    import { helpNotificationSettingsVisibleStore } from "../Stores/HelpSettingsStore";
    import {
        cameraListStore,
        localStreamStore,
        localVolumeStore,
        microphoneListStore,
        requestedCameraDeviceIdStore,
        requestedCameraState,
        requestedMicrophoneDeviceIdStore,
        requestedMicrophoneState,
        speakerListStore,
        speakerSelectedStore,
        usedCameraDeviceIdStore,
        usedMicrophoneDeviceIdStore,
        videoQualityStore,
    } from "../Stores/MediaStore";
    import {
        activeSubMenuStore,
        customMenuIframe,
        menuVisiblilityStore,
        SubMenusInterface,
        subMenusStore,
        type MenuItem,
    } from "../Stores/MenuStore";
    import {
        browserNoiseSuppressionSupportedStore,
        effectiveNoiseSuppressionProviderStore,
        microphoneAutoGainControlStore,
        microphoneBrowserNoiseSuppressionStore,
        microphoneEchoCancellationStore,
        noiseSuppressionEnabledStore,
        noiseSuppressionEngineStore,
        noiseSuppressionProviderStore,
        noiseSuppressionStateStore,
        voiceIsolationSupportedStore,
    } from "../Stores/NoiseSuppressionStore";
    import { volumeProximityDiscussionStore } from "../Stores/PeerStore";
    import { screenShareQualityStore } from "../Stores/ScreenSharingStore";
    import { srcObject } from "../Components/Video/utils";
    import GlobalMessagesSubMenu from "../Components/Menu/GlobalMessagesSubMenu.svelte";
    import { LL } from "../../i18n/i18n-svelte";
    import { sendMenuClickedEvent } from "../Api/Iframe/Ui/MenuItem";
    import { QL } from "./i18n";
    import Icon from "./Icon.svelte";
    import type { IconName } from "./icons";
    import Dropdown from "./settings/Dropdown.svelte";
    import Switch from "./settings/Switch.svelte";
    import { quantaSettingsTabStore, type QuantaSettingsTab } from "./settingsTab";

    interface Props {
        initialTab?: QuantaSettingsTab;
    }

    let { initialTab }: Props = $props();

    // The dock's trays ask for their own tab; anything else opens on Audio.
    let tab = $state<QuantaSettingsTab>(untrack(() => initialTab) ?? get(quantaSettingsTabStore));
    quantaSettingsTabStore.set("audio");

    type TabItem = { id: QuantaSettingsTab; label: string; icon: IconName };
    const tabs = $derived<TabItem[]>([
        { id: "audio", label: $QL.settingsAudio(), icon: "speaker" },
        { id: "video", label: $QL.settingsVideo(), icon: "videocam" },
        { id: "general", label: $QL.settingsGeneral(), icon: "settings" },
        { id: "shortcuts", label: $LL.menu.sub.shortcuts(), icon: "keyboard" },
        ...($userIsAdminStore
            ? [{ id: "globalMessages", label: $LL.menu.sub.globalMessages(), icon: "campaign" } satisfies TabItem]
            : []),
    ]);

    // WA's other menu pages (map credits, profile, contact, a room script's own commands) open in WA's menu, which
    // only this dialog leads to; WA's help and tips page is left out, as in the ⋮ menu.
    const OWN_TABS: string[] = [
        SubMenusInterface.settings,
        SubMenusInterface.shortcuts,
        SubMenusInterface.globalMessages,
        SubMenusInterface.help,
    ];
    const otherMenus = derived<typeof subMenusStore, MenuItem[]>(
        subMenusStore,
        ($menus, set) => {
            const others = $menus.filter((menu) => !OWN_TABS.includes(menu.key));
            return derived(
                others.map((menu) => menu.visible),
                ($visible) => others.filter((_, index) => $visible[index]),
            ).subscribe(set);
        },
        [],
    );

    function menuLabel(menu: MenuItem): string {
        return menu.type === "translated" ? $LL.menu.sub[menu.key]() : menu.label;
    }

    // A room script's plain command runs here: WA's menu, mounted on it, would run it twice (Menu.svelte runs its
    // switchMenu on mount and again from its store subscription). Pages open in WA's menu, focus on their entry.
    async function openMenu(menu: MenuItem): Promise<void> {
        if (menu.type === "scripting" && !customMenuIframe.has(menu.key)) {
            analyticsClient.trackAdminEvent("menu.custom.opened", { name: menu.key });
            sendMenuClickedEvent(menu.key);
            close();
            return;
        }
        activeSubMenuStore.activateByMenuItem(menu);
        await tick();
        document.querySelector<HTMLElement>(".menu-item-container.active .menu-item")?.focus();
    }

    function menuIcon(menu: MenuItem): IconName {
        if (menu.key === SubMenusInterface.profile) return "people";
        if (menu.key === SubMenusInterface.chat) return "chat";
        return "info";
    }

    function close(): void {
        menuVisiblilityStore.set(false);
    }

    // Fades on whichever edge of the list has more to scroll to.
    let scroller: HTMLDivElement | undefined = $state();
    let moreAbove = $state(false);
    let moreBelow = $state(false);

    function updateFades(): void {
        if (!scroller) return;
        moreAbove = scroller.scrollTop > 0;
        moreBelow = scroller.scrollTop < scroller.scrollHeight - scroller.clientHeight - 1;
    }

    function selectTab(id: QuantaSettingsTab): void {
        tab = id;
        if (scroller) scroller.scrollTop = 0;
        requestAnimationFrame(updateFades);
    }

    // Devices: the same selection paths as the dock's trays (QuantaDock.svelte).
    const deviceOptions = (devices: MediaDeviceInfo[] | undefined, fallback: (index: number) => string) =>
        (devices ?? []).map((device, index) => ({
            value: device.deviceId,
            label: device.label || fallback(index + 1),
        }));

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

    let micLevel = $derived.by(() => {
        const bands = $localVolumeStore ?? [];
        const average = bands.length ? bands.reduce((a, b) => a + b, 0) / bands.length : 0;
        return Math.min(1, average / 120);
    });

    // Audio
    type NoiseChoice = "off" | NoiseSuppressionProvider;
    let noiseChoice = $derived<NoiseChoice>(
        $noiseSuppressionEnabledStore ? $effectiveNoiseSuppressionProviderStore : "off",
    );
    const noiseOptions = $derived([
        { value: "off" as NoiseChoice, label: $QL.off() },
        { value: "workadventure" as NoiseChoice, label: "WorkAdventure" },
        ...($voiceIsolationSupportedStore
            ? [{ value: "voiceIsolation" as NoiseChoice, label: $LL.menu.settings.microphone.voiceIsolation() }]
            : []),
    ]);

    function chooseNoise(choice: NoiseChoice): void {
        if (choice === "off") {
            noiseSuppressionEnabledStore.setEnabled(false);
            return;
        }
        noiseSuppressionProviderStore.setProvider(choice);
        if (!get(noiseSuppressionEnabledStore)) noiseSuppressionEnabledStore.setEnabled(true);
    }

    // Product names: the same in every language, and short enough not to be cut off.
    const engineOptions = $derived([
        { value: "deepfilternet" as const, label: "DeepFilterNet" },
        { value: "dtln" as const, label: "DTLN" },
    ]);

    let volumeProximityDiscussion = $state(localUserStore.getVolumeProximityDiscussion());

    function updateVolumeProximityDiscussion(): void {
        analyticsClient.trackAdminEvent("settings.audio_volume.opened");
        localUserStore.setVolumeProximityDiscussion(volumeProximityDiscussion);
        volumeProximityDiscussionStore.set(volumeProximityDiscussion);
    }

    let bubbleSound = $state(localUserStore.getBubbleSound());
    const bubbleSoundOptions = $derived([
        { value: "ding" as const, label: $LL.menu.settings.bubbleSoundOptions.ding() },
        { value: "wobble" as const, label: $LL.menu.settings.bubbleSoundOptions.wobble() },
    ]);

    function changeBubbleSound(value: "ding" | "wobble"): void {
        bubbleSound = value;
        localUserStore.setBubbleSound(value);
        bubbleSoundStore.set(value);
        new Audio(`/resources/objects/webrtc-in-${value}.mp3`).play().catch(() => {});
    }

    let decreaseMusicWhileTalking = $state(localUserStore.getDecreaseAudioPlayerVolumeWhileTalking());

    function changeDecreaseMusicWhileTalking(value: boolean): void {
        decreaseMusicWhileTalking = value;
        analyticsClient.trackAdminEvent("settings.decrease_audio_volume.changed", { value: value ? "true" : "false" });
        localUserStore.setDecreaseAudioPlayerVolumeWhileTalking(value);
        audioManagerVolumeStore.setDecreaseWhileTalking(value);
    }

    let blockAudio = $state(localUserStore.getBlockAudio());

    function changeBlockAudio(value: boolean): void {
        blockAudio = value;
        if (value) {
            audioManagerFileStore.unloadAudio();
            audioManagerVisibilityStore.set("disabledBySettings");
        }
        localUserStore.setBlockAudio(value);
    }

    // Video
    type Quality = "low" | "recommended" | "high";
    const qualityOptions = $derived([
        { value: "low" as Quality, label: $LL.menu.settings.videoBandwidth.low() },
        { value: "recommended" as Quality, label: $LL.menu.settings.videoBandwidth.recommended() },
        { value: "high" as Quality, label: $LL.menu.settings.videoBandwidth.high() },
    ]);
    let videoQuality = $state<Quality>(localUserStore.getVideoQuality());
    let screenShareQuality = $state<Quality>(localUserStore.getScreenShareQuality());
    let bandwidthPreference = $state<BandwidthConstrainedPreference>(
        localUserStore.getBandwidthConstrainedScreenSharePreference(),
    );
    const bandwidthOptions = $derived([
        {
            value: "maintain-resolution" as BandwidthConstrainedPreference,
            label: $LL.menu.settings.bandwidthConstrainedPreference.maintainResolutionTitle(),
        },
        {
            value: "maintain-framerate" as BandwidthConstrainedPreference,
            label: $LL.menu.settings.bandwidthConstrainedPreference.maintainFramerateTitle(),
        },
        {
            value: "balanced" as BandwidthConstrainedPreference,
            label: $LL.menu.settings.bandwidthConstrainedPreference.balancedTitle(),
        },
    ]);
    let videoQualityStats = $state(localUserStore.getDisplayVideoQualityStats());

    // General
    let notification = $state(localUserStore.getNotification());
    let pictureInPicture = $state(localUserStore.getAllowPictureInPicture());
    let fullscreen = $state(localUserStore.getFullscreen());
    let ignoreFollowRequests = $state(localUserStore.getIgnoreFollowRequests());
    let forceCowebsiteTrigger = $state(localUserStore.getForceCowebsiteTrigger());
    let disableAnimations = $state(localUserStore.getDisableAnimations());
    let keepCamera = $state(
        localUserStore.getCameraPrivacySettings(
            gameManager.currentStartedRoomOrNull?.defaultCameraPrivacySettings ?? Room.DEFAULT_CAMERA_PRIVACY_SETTINGS,
        ),
    );
    let keepMicrophone = $state(
        localUserStore.getMicrophonePrivacySettings(
            gameManager.currentStartedRoomOrNull?.defaultMicrophonePrivacySettings ??
                Room.DEFAULT_MICROPHONE_PRIVACY_SETTINGS,
        ),
    );
    function changeNotification(value: boolean): void {
        notification = value;
        analyticsClient.trackAdminEvent("settings.notification.changed", { value: value ? "true" : "false" });
        // Turning notifications off never needs the permission.
        if (!value || Notification.permission === "granted") {
            localUserStore.setNotification(value);
            browserNotificationStore.refresh();
            return;
        }
        Notification.requestPermission()
            .then((response) => {
                if (response === "granted") {
                    localUserStore.setNotification(true);
                } else {
                    localUserStore.setNotification(false);
                    notification = false;
                    if (response === "denied") helpNotificationSettingsVisibleStore.set(true);
                }
                browserNotificationStore.refresh();
            })
            .catch((e) => console.error(e));
    }

    function changeFullscreen(value: boolean): void {
        fullscreen = value;
        analyticsClient.trackAdminEvent("settings.fullscreen.changed", { value: value ? "true" : "false" });
        if (document.fullscreenElement !== null && !value) {
            document.exitFullscreen().catch((e) => console.error(e));
        } else if (value) {
            document.documentElement.requestFullscreen().catch((e) => console.error(e));
        }
        localUserStore.setFullscreen(value);
    }

    let shortcuts: { description: string; keys: string[] }[] = $state([]);

    onMount(() => {
        requestAnimationFrame(updateFades);
        const input = gameManager.getCurrentGameScene().userInputManager;
        const grouped: { description: string; keys: string[] }[] = [];
        for (const { description, key, ctrlKey, shiftKey, altKey } of input.keysCodeList.concat(
            input.userInputHandler.shortcuts,
        )) {
            const keys = [
                ...(ctrlKey ? ["Ctrl"] : []),
                ...(shiftKey ? ["Shift"] : []),
                ...(altKey ? ["Alt"] : []),
                key,
            ];
            const existing = grouped.find((item) => item.description === description);
            if (existing) existing.keys.push(keys.join(" + "));
            else grouped.push({ description, keys: [keys.join(" + ")] });
        }
        shortcuts = grouped;
    });
</script>

<svelte:window
    onkeydown={(event) => {
        if (event.key === "Escape") close();
    }}
/>

<div class="qs" data-testid="quanta-settings">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="qs-scrim" onclick={close}></div>
    <div class="qs-dialog" role="dialog" aria-modal="true" aria-labelledby="qs-title">
        <div class="qs-head">
            <h2 id="qs-title">{$LL.menu.sub.settings()}</h2>
            <button type="button" class="qs-close" aria-label={$LL.actionbar.close()} onclick={close}>
                <Icon name="close" />
            </button>
        </div>
        <div class="qs-body">
            <nav aria-label={$LL.menu.sub.settings()}>
                <ul>
                    {#each tabs as item (item.id)}
                        <li>
                            <button
                                type="button"
                                class:current={tab === item.id}
                                aria-current={tab === item.id ? "page" : undefined}
                                data-testid={`quanta-settings-tab-${item.id}`}
                                onclick={() => selectTab(item.id)}
                            >
                                <Icon name={item.icon} />
                                <span>{item.label}</span>
                            </button>
                        </li>
                    {/each}
                    {#if $otherMenus.length > 0}
                        <li class="qs-nav-gap" role="presentation"></li>
                        {#each $otherMenus as menu (menu.key)}
                            <li>
                                <button
                                    type="button"
                                    data-testid={`quanta-settings-menu-${menu.key}`}
                                    onclick={() => openMenu(menu).catch((error) => console.error(error))}
                                >
                                    <Icon name={menuIcon(menu)} />
                                    <span>{menuLabel(menu)}</span>
                                </button>
                            </li>
                        {/each}
                    {/if}
                </ul>
            </nav>
            <section class:more-above={moreAbove} class:more-below={moreBelow}>
                <div class="qs-scroll" bind:this={scroller} onscroll={updateFades}>
                    {#if tab === "audio"}
                        <h3>{$LL.actionbar.subtitle.microphone()}</h3>
                        {#if $microphoneListStore && $microphoneListStore.length > 0}
                            <div class="qs-block">
                                <Dropdown
                                    icon="mic"
                                    label={$LL.actionbar.subtitle.microphone()}
                                    options={deviceOptions($microphoneListStore, (index) =>
                                        $QL.microphoneNumber({ index }),
                                    )}
                                    value={$requestedMicrophoneState
                                        ? $usedMicrophoneDeviceIdStore
                                        : ($requestedMicrophoneDeviceIdStore ?? $usedMicrophoneDeviceIdStore)}
                                    onchange={selectMicrophone}
                                />
                            </div>
                            <div class="qs-meter"><i style:width={`${micLevel * 100}%`}></i></div>
                        {:else}
                            <p class="qs-lead">{$LL.actionbar.microphone.disabled()}</p>
                        {/if}
                        <div class="qs-row">
                            <div><span>{$LL.menu.settings.microphone.enableAdvancedNoiseReduction()}</span></div>
                            <Dropdown
                                compact
                                label={$LL.menu.settings.microphone.enableAdvancedNoiseReduction()}
                                options={noiseOptions}
                                value={noiseChoice}
                                testId="quanta-noise-suppression"
                                onchange={chooseNoise}
                            />
                        </div>
                        {#if noiseChoice === "workadventure"}
                            <div class="qs-row">
                                <div>
                                    <span>{$LL.menu.settings.microphone.noiseSuppressionEngine()}</span>
                                    {#if $noiseSuppressionStateStore.status === "initializing"}
                                        <small>{$LL.actionbar.microphone.noiseSuppressionInitializing()}</small>
                                    {:else if $noiseSuppressionStateStore.status === "unsupported"}
                                        <!-- WA's own message carries file paths and HTTP codes: never shown to users -->
                                        <small class="warn"
                                            >{$LL.actionbar.microphone.noiseSuppressionUnsupported()}</small
                                        >
                                    {:else if $noiseSuppressionStateStore.status === "error"}
                                        <small class="warn">{$LL.actionbar.microphone.noiseSuppressionError()}</small>
                                    {/if}
                                </div>
                                <Dropdown
                                    compact
                                    label={$LL.menu.settings.microphone.noiseSuppressionEngine()}
                                    options={engineOptions}
                                    value={$noiseSuppressionEngineStore}
                                    onchange={(value) => noiseSuppressionEngineStore.setEngine(value)}
                                />
                            </div>
                        {/if}
                        {#if $browserNoiseSuppressionSupportedStore}
                            <div class="qs-row">
                                <div>
                                    <span>{$LL.menu.settings.microphone.browserNoiseSuppression()}</span>
                                    <small>{$LL.menu.settings.microphone.browserNoiseSuppressionDescription()}</small>
                                </div>
                                <Switch
                                    label={$LL.menu.settings.microphone.browserNoiseSuppression()}
                                    checked={$microphoneBrowserNoiseSuppressionStore}
                                    onchange={(value) => microphoneBrowserNoiseSuppressionStore.setEnabled(value)}
                                />
                            </div>
                        {/if}
                        <div class="qs-row">
                            <div>
                                <span>{$LL.menu.settings.microphone.autoGainControl()}</span>
                                <small>{$LL.menu.settings.microphone.autoGainControlDescription()}</small>
                            </div>
                            <Switch
                                label={$LL.menu.settings.microphone.autoGainControl()}
                                checked={$microphoneAutoGainControlStore}
                                onchange={(value) => microphoneAutoGainControlStore.setEnabled(value)}
                            />
                        </div>
                        <div class="qs-row">
                            <div><span>{$LL.menu.settings.microphone.echoCancellation()}</span></div>
                            <Switch
                                label={$LL.menu.settings.microphone.echoCancellation()}
                                checked={$microphoneEchoCancellationStore}
                                onchange={(value) => microphoneEchoCancellationStore.setEnabled(value)}
                            />
                        </div>

                        {#if $speakerListStore && $speakerListStore.length > 0}
                            <h3>{$LL.actionbar.subtitle.speaker()}</h3>
                            <div class="qs-block">
                                <Dropdown
                                    icon="speaker"
                                    label={$LL.actionbar.subtitle.speaker()}
                                    options={deviceOptions($speakerListStore, (index) => $QL.speakerNumber({ index }))}
                                    value={$speakerSelectedStore}
                                    onchange={selectSpeaker}
                                />
                            </div>
                        {/if}
                        <div class="qs-row">
                            <div><span>{$LL.menu.settings.proximityDiscussionVolume()}</span></div>
                            <input
                                class="qs-slider"
                                type="range"
                                min="0"
                                max="1"
                                step="0.1"
                                aria-label={$LL.menu.settings.proximityDiscussionVolume()}
                                style:--fill={`${volumeProximityDiscussion * 100}%`}
                                bind:value={volumeProximityDiscussion}
                                onchange={updateVolumeProximityDiscussion}
                            />
                        </div>
                        <div class="qs-row">
                            <div><span>{$LL.menu.settings.bubbleSound()}</span></div>
                            <Dropdown
                                compact
                                label={$LL.menu.settings.bubbleSound()}
                                options={bubbleSoundOptions}
                                value={bubbleSound}
                                onchange={changeBubbleSound}
                            />
                        </div>
                        <div class="qs-row">
                            <div><span>{$LL.audio.manager.reduce()}</span></div>
                            <Switch
                                label={$LL.audio.manager.reduce()}
                                checked={decreaseMusicWhileTalking}
                                onchange={changeDecreaseMusicWhileTalking}
                            />
                        </div>
                        <div class="qs-row">
                            <div><span>{$LL.menu.settings.blockAudio()}</span></div>
                            <Switch
                                label={$LL.menu.settings.blockAudio()}
                                checked={blockAudio}
                                onchange={changeBlockAudio}
                            />
                        </div>
                    {:else if tab === "video"}
                        <h3>{$LL.actionbar.subtitle.camera()}</h3>
                        {#if $cameraListStore && $cameraListStore.length > 0}
                            <div class="qs-block">
                                <Dropdown
                                    icon="videocam"
                                    label={$LL.actionbar.subtitle.camera()}
                                    options={deviceOptions($cameraListStore, (index) => $QL.cameraNumber({ index }))}
                                    value={$requestedCameraState
                                        ? $usedCameraDeviceIdStore
                                        : ($requestedCameraDeviceIdStore ?? $usedCameraDeviceIdStore)}
                                    onchange={selectCamera}
                                />
                            </div>
                        {/if}
                        <div class="qs-block">
                            <div class="qs-preview">
                                {#if $requestedCameraState && $localStreamStore.type === "success" && $localStreamStore.stream?.getVideoTracks().length}
                                    <video use:srcObject={$localStreamStore.stream} autoplay muted playsinline></video>
                                {:else}
                                    <span>{$LL.actionbar.camera.disabled()}</span>
                                {/if}
                            </div>
                        </div>
                        <div class="qs-row">
                            <div><span>{$LL.menu.settings.videoBandwidth.title()}</span></div>
                            <Dropdown
                                compact
                                label={$LL.menu.settings.videoBandwidth.title()}
                                options={qualityOptions}
                                value={videoQuality}
                                onchange={(value) => {
                                    videoQuality = value;
                                    videoQualityStore.setQuality(value);
                                }}
                            />
                        </div>
                        <div class="qs-row">
                            <div><span>{$LL.menu.settings.shareScreenBandwidth.title()}</span></div>
                            <Dropdown
                                compact
                                label={$LL.menu.settings.shareScreenBandwidth.title()}
                                options={qualityOptions}
                                value={screenShareQuality}
                                onchange={(value) => {
                                    screenShareQuality = value;
                                    screenShareQualityStore.setQuality(value);
                                }}
                            />
                        </div>
                        <div class="qs-row">
                            <div><span>{$LL.menu.settings.bandwidthConstrainedPreference.title()}</span></div>
                            <Dropdown
                                compact
                                label={$LL.menu.settings.bandwidthConstrainedPreference.title()}
                                options={bandwidthOptions}
                                value={bandwidthPreference}
                                onchange={(value) => {
                                    bandwidthPreference = value;
                                    bandwidthConstrainedPreferenceStore.setPreference(value);
                                }}
                            />
                        </div>
                        <div class="qs-row">
                            <div><span>{$LL.menu.settings.displayVideoQualityStats()}</span></div>
                            <Switch
                                label={$LL.menu.settings.displayVideoQualityStats()}
                                checked={videoQualityStats}
                                onchange={(value) => {
                                    videoQualityStats = value;
                                    localUserStore.setDisplayVideoQualityStats(value);
                                    displayVideoQualityStore.set(value);
                                }}
                            />
                        </div>
                    {:else if tab === "general"}
                        <!-- No language picker: the room follows the user's language in Quanta (?lang=). -->
                        <div class="qs-row">
                            <div><span>{$LL.menu.settings.notifications()}</span></div>
                            <Switch
                                label={$LL.menu.settings.notifications()}
                                checked={notification}
                                onchange={changeNotification}
                            />
                        </div>
                        <div class="qs-row">
                            <div><span>{$LL.menu.settings.enablePictureInPicture()}</span></div>
                            <Switch
                                label={$LL.menu.settings.enablePictureInPicture()}
                                checked={pictureInPicture}
                                onchange={(value) => {
                                    pictureInPicture = value;
                                    analyticsClient.trackAdminEvent("settings.picture_in_picture.changed", {
                                        value: value ? "true" : "false",
                                    });
                                    localUserStore.setAllowPictureInPicture(value);
                                }}
                            />
                        </div>
                        <div class="qs-row">
                            <div><span>{$LL.menu.settings.fullscreen()}</span></div>
                            <Switch
                                label={$LL.menu.settings.fullscreen()}
                                checked={fullscreen}
                                onchange={changeFullscreen}
                            />
                        </div>

                        <h3>{$LL.menu.settings.privacySettings.title()}</h3>
                        <p class="qs-lead">{$LL.menu.settings.privacySettings.explanation()}</p>
                        <div class="qs-row">
                            <div><span>{$LL.menu.settings.privacySettings.cameraToggle()}</span></div>
                            <Switch
                                label={$LL.menu.settings.privacySettings.cameraToggle()}
                                checked={keepCamera}
                                onchange={(value) => {
                                    keepCamera = value;
                                    analyticsClient.trackAdminEvent("settings.camera.changed", {
                                        value: value ? "true" : "false",
                                    });
                                    localUserStore.setCameraPrivacySettings(value);
                                }}
                            />
                        </div>
                        <div class="qs-row">
                            <div><span>{$LL.menu.settings.privacySettings.microphoneToggle()}</span></div>
                            <Switch
                                label={$LL.menu.settings.privacySettings.microphoneToggle()}
                                checked={keepMicrophone}
                                onchange={(value) => {
                                    keepMicrophone = value;
                                    analyticsClient.trackAdminEvent("settings.microphone.changed", {
                                        value: value ? "true" : "false",
                                    });
                                    localUserStore.setMicrophonePrivacySettings(value);
                                }}
                            />
                        </div>

                        <h3>{$LL.menu.settings.otherSettings()}</h3>
                        <div class="qs-row">
                            <div><span>{$LL.menu.settings.ignoreFollowRequest()}</span></div>
                            <Switch
                                label={$LL.menu.settings.ignoreFollowRequest()}
                                checked={ignoreFollowRequests}
                                onchange={(value) => {
                                    ignoreFollowRequests = value;
                                    analyticsClient.trackAdminEvent("settings.request_follow.changed", {
                                        value: value ? "true" : "false",
                                    });
                                    localUserStore.setIgnoreFollowRequests(value);
                                }}
                            />
                        </div>
                        <div class="qs-row">
                            <div><span>{$LL.menu.settings.cowebsiteTrigger()}</span></div>
                            <Switch
                                label={$LL.menu.settings.cowebsiteTrigger()}
                                checked={forceCowebsiteTrigger}
                                onchange={(value) => {
                                    forceCowebsiteTrigger = value;
                                    analyticsClient.trackAdminEvent("settings.ask_website.changed", {
                                        value: value ? "true" : "false",
                                    });
                                    localUserStore.setForceCowebsiteTrigger(value);
                                }}
                            />
                        </div>
                        <div class="qs-row">
                            <div><span>{$LL.menu.settings.disableAnimations()}</span></div>
                            <Switch
                                label={$LL.menu.settings.disableAnimations()}
                                checked={disableAnimations}
                                onchange={(value) => {
                                    disableAnimations = value;
                                    localUserStore.setDisableAnimations(value);
                                    gameManager.getCurrentGameScene().setTileAnimationsPaused(value);
                                }}
                            />
                        </div>
                    {:else if tab === "shortcuts"}
                        {#each shortcuts as shortcut, i (i)}
                            <div class="qs-row">
                                <div><span>{shortcut.description}</span></div>
                                <div class="qs-keys">
                                    {#each shortcut.keys as combo, k (k)}
                                        <kbd>{combo}</kbd>
                                    {/each}
                                </div>
                            </div>
                        {/each}
                    {:else if tab === "globalMessages"}
                        <div class="qs-embedded"><GlobalMessagesSubMenu /></div>
                    {/if}
                </div>
            </section>
        </div>
    </div>
</div>

<style>
    /* Measured from the mockup ~/wa-ui-refs/mockup/panels.py: 860×600 dialog, 28px corners, a 260px tab column;
       rows 76px with the control 14px from each divider, headings 32px above and 12px below. */
    .qs {
        --qs-surface: #1d2027;
        --qs-raised: #262a32;
        --qs-text: #eceef1;
        --qs-muted: #a7adb7;
        --qs-line: #2a2e36;
        --qs-outline: #8e918f;
        --qs-on: #c9d5ea;
        --qs-on-text: #1d2b45;
        --qs-tonal: #2f343d;
        position: fixed;
        inset: 0;
        z-index: 900;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--qs-text);
        pointer-events: auto;
    }

    .qs-scrim {
        position: absolute;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
    }

    .qs-dialog {
        position: relative;
        width: min(860px, calc(100vw - 24px));
        height: min(600px, calc(100vh - 24px));
        display: flex;
        flex-direction: column;
        border-radius: 28px;
        background: var(--qs-surface);
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
        overflow: hidden;
    }

    .qs-head {
        flex: none;
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 18px 16px 16px 28px;
    }

    .qs-head h2 {
        margin: 0;
        padding: 0;
        line-height: 28px;
        text-transform: none;
        letter-spacing: normal;
        font-family: inherit;
        font-size: 22px;
        font-weight: 400;
        color: var(--qs-text);
    }

    .qs-close {
        width: 44px;
        height: 44px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: 9999px;
        background: transparent;
        color: var(--qs-text);
        cursor: pointer;
    }

    .qs-close:hover {
        background: rgba(255, 255, 255, 0.08);
    }

    .qs-body {
        flex: 1;
        min-height: 0;
        display: flex;
    }

    nav {
        width: 260px;
        flex: none;
        padding: 0 12px 24px;
    }

    nav ul {
        margin: 0;
        padding: 0;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    nav button {
        width: 100%;
        height: 52px;
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 0 18px;
        border: 0;
        border-radius: 9999px;
        background: transparent;
        color: var(--qs-text);
        font: inherit;
        font-size: 15px;
        font-weight: 500;
        text-align: start;
        cursor: pointer;
    }

    nav button :global(svg) {
        color: var(--qs-muted);
    }

    /* WA's own menu pages, after the settings. */
    .qs-nav-gap {
        height: 1px;
        margin: 8px 18px;
        background: var(--qs-line);
    }

    nav button:hover {
        background: rgba(255, 255, 255, 0.06);
    }

    nav button.current {
        background: var(--qs-tonal);
        color: var(--qs-text);
    }

    nav button.current :global(svg) {
        color: var(--qs-text);
    }

    section {
        position: relative;
        flex: 1;
        min-width: 0;
        margin-right: 8px;
        overflow: hidden;
    }

    section::before,
    section::after {
        content: "";
        position: absolute;
        left: 0;
        right: 12px;
        height: 40px;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.15s;
        z-index: 1;
    }

    section::before {
        top: 0;
        background: linear-gradient(var(--qs-surface), transparent);
    }

    section::after {
        bottom: 0;
        background: linear-gradient(transparent, var(--qs-surface));
    }

    section.more-above::before,
    section.more-below::after {
        opacity: 1;
    }

    .qs-scroll {
        height: 100%;
        overflow-y: auto;
        padding: 0 24px 32px 32px;
    }

    .qs-scroll::-webkit-scrollbar {
        width: 8px;
    }

    .qs-scroll::-webkit-scrollbar-button {
        display: none;
        height: 0;
    }

    .qs-scroll::-webkit-scrollbar-track {
        background: transparent;
        margin: 4px 0 24px;
    }

    .qs-scroll::-webkit-scrollbar-thumb {
        background: #3a3f48;
        border-radius: 4px;
    }

    h3 {
        margin: 32px 0 12px;
        padding: 0;
        text-transform: none;
        letter-spacing: normal;
        font-family: inherit;
        font-size: 14px;
        font-weight: 500;
        line-height: 18px;
        color: var(--qs-on);
    }

    .qs-scroll > h3:first-child {
        margin-top: 0;
    }

    .qs-block {
        padding-bottom: 16px;
    }

    .qs-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 32px;
        min-height: 76px;
        padding: 14px 0;
        border-bottom: 1px solid var(--qs-line);
    }

    .qs-scroll > .qs-row:first-child {
        padding-top: 0;
        min-height: 62px;
    }

    .qs-scroll > .qs-row:last-child {
        border-bottom: 0;
    }

    .qs-row > div:first-child {
        flex: 1;
        min-width: 0;
        overflow-wrap: anywhere;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .qs-row span {
        font-size: 15px;
        color: var(--qs-text);
    }

    .qs-row small {
        font-size: 13px;
        line-height: 18px;
        color: var(--qs-muted);
    }

    .qs-row small.warn {
        color: #f2b8b5;
    }

    .qs-lead {
        margin: 0 0 4px;
        font-size: 13px;
        line-height: 20px;
        color: var(--qs-muted);
    }

    .qs-meter {
        height: 6px;
        margin: 0 0 16px;
        border-radius: 3px;
        background: var(--qs-line);
        overflow: hidden;
    }

    .qs-meter i {
        display: block;
        height: 100%;
        border-radius: 3px;
        background: var(--qs-on);
        transition: width 0.1s linear;
    }

    .qs-slider {
        flex: none;
        width: 200px;
        height: 20px;
        margin: 0;
        appearance: none;
        background: transparent;
        cursor: pointer;
    }

    .qs-slider::-webkit-slider-runnable-track {
        height: 4px;
        border-radius: 2px;
        background:
            linear-gradient(var(--qs-on), var(--qs-on)) 0 / var(--fill) 100% no-repeat,
            #3a3f48;
    }

    .qs-slider::-webkit-slider-thumb {
        appearance: none;
        width: 20px;
        height: 20px;
        margin-top: -8px;
        border-radius: 9999px;
        background: var(--qs-on);
    }

    .qs-slider::-moz-range-track {
        height: 4px;
        border-radius: 2px;
        background: #3a3f48;
    }

    .qs-slider::-moz-range-progress {
        height: 4px;
        border-radius: 2px;
        background: var(--qs-on);
    }

    .qs-slider::-moz-range-thumb {
        width: 20px;
        height: 20px;
        border: 0;
        border-radius: 9999px;
        background: var(--qs-on);
    }

    .qs-preview {
        width: 100%;
        height: 240px;
        border-radius: 12px;
        background: linear-gradient(135deg, #2c3b55, #1b2333);
        display: flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        color: var(--qs-muted);
        font-size: 14px;
    }

    .qs-preview video {
        width: 100%;
        height: 100%;
        object-fit: cover;
        transform: scaleX(-1);
    }

    .qs-keys {
        display: flex;
        flex-wrap: wrap;
        justify-content: flex-end;
        gap: 8px;
    }

    kbd {
        padding: 4px 10px;
        border-radius: 8px;
        background: var(--qs-raised);
        color: var(--qs-text);
        font: inherit;
        font-size: 13px;
        white-space: nowrap;
    }

    /* A narrow room (the room beside a lesson): the tabs become a row above the settings. */
    @media (max-width: 720px) {
        .qs-body {
            flex-direction: column;
        }

        nav {
            width: auto;
            padding: 0 16px 12px;
            overflow-x: auto;
        }

        nav ul {
            flex-direction: row;
        }

        .qs-nav-gap {
            width: 1px;
            height: auto;
            margin: 8px 4px;
        }

        nav button {
            height: 40px;
            gap: 8px;
            padding: 0 14px;
            white-space: nowrap;
        }

        section {
            margin-right: 4px;
        }

        .qs-scroll {
            padding: 4px 16px 24px 20px;
        }

        .qs-row :global(.qs-dropdown.compact) {
            width: 180px;
        }
    }
</style>
