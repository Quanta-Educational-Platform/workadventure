<script lang="ts">
    import * as Sentry from "@sentry/svelte";
    import { AvailabilityStatus } from "@workadventure/messages";
    import { setContext } from "svelte";
    import type { Readable } from "svelte/store";
    import { derived, get } from "svelte/store";
    import { analyticsClient } from "../../../Administration/AnalyticsClient";
    import { connectionManager } from "../../../Connection/ConnectionManager";
    import { showModalGlobalComminucationVisibilityStore } from "../../../Stores/ModalStore";
    import { userIsAdminStore } from "../../../Stores/GameStore";
    import { BUTTON_ZOOM_STEP_FACTOR } from "../../../Phaser/Game/CameraZoomUtils";
    import MegaphoneIcon from "../../Icons/MegaphoneIcon.svelte";
    import { ENABLE_OPENID, QUANTA_UI, SENTRY_DSN_FRONT } from "../../../Enum/EnvironmentVariable";
    import { gameManager } from "../../../Phaser/Game/GameManager";
    import { EnableCameraScene, EnableCameraSceneName } from "../../../Phaser/Login/EnableCameraScene";
    import { LoginScene, LoginSceneName } from "../../../Phaser/Login/LoginScene";
    import { PwaInstallScene, PwaInstallSceneName } from "../../../Phaser/Login/PwaInstallScene";
    import { SelectCharacterScene, SelectCharacterSceneName } from "../../../Phaser/Login/SelectCharacterScene";
    import { SelectCompanionScene, SelectCompanionSceneName } from "../../../Phaser/Login/SelectCompanionScene";
    import type { RequestedStatus } from "../../../Rules/StatusRules/statusRules";
    import { loginSceneVisibleStore } from "../../../Stores/LoginSceneStore";
    import { enableCameraSceneVisibilityStore } from "../../../Stores/MediaStore";
    import type { RightMenuItem } from "../../../Stores/MenuStore";
    import {
        mapEditorMenuVisibleStore,
        openedMenuStore,
        rightActionBarMenuItems,
        showMenuItem,
        SubMenusInterface,
        userIsConnected,
    } from "../../../Stores/MenuStore";
    import { onboardingStore } from "../../../Stores/OnboardingStore";
    import { pwaInstallProfileMenuEligibleStore } from "../../../Stores/PwaInstallStore";
    import { selectCharacterSceneVisibleStore } from "../../../Stores/SelectCharacterStore";
    import { selectCompanionSceneVisibleStore } from "../../../Stores/SelectCompanionStore";
    import { getStatusInformation } from "../../../Utils/AvailabilityStatus";
    import { LL } from "../../../../i18n/i18n-svelte";
    import { profileMenuEntryVisible as entryVisible } from "../../../quanta/classroomUi";
    import { canViewAsStudentStore, setStudentView, studentViewStore } from "../../../quanta/studentView";
    import { stopSpeakingToClass } from "../../../quanta/speakingToClass";
    import { QL } from "../../../quanta/i18n";
    import { mapEditorModeStore } from "../../../Stores/MapEditorStore";
    import { EditorToolName } from "../../../Phaser/Game/MapEditor/MapEditorModeManager";
    import { IconMapEditor } from "@wa-icons";
    import { dockFoldedStore } from "../../../quanta/dockFold";
    import { pageMenuStore } from "../../../quanta/pageMenu";
    import DockFoldedItems from "../../../quanta/DockFoldedItems.svelte";
    import LayoutMenuItems from "../../../quanta/LayoutMenuItems.svelte";
    import ActionBarButton from "../ActionBarButton.svelte";
    import AvailabilityStatusList from "../AvailabilityStatus/AvailabilityStatusList.svelte";
    import Companion from "../../Companion/Companion.svelte";
    import ExternalComponents from "../../ExternalModules/ExternalComponents.svelte";
    import CamSettingsIcon from "../../Icons/CamSettingsIcon.svelte";
    import {
        IconBug,
        IconEye,
        IconFileDownload,
        IconHelpCircle,
        IconLogout,
        IconMinus,
        IconPlus,
        IconZoomInArea,
    } from "../../Icons";
    import ProfilIcon from "../../Icons/ProfilIcon.svelte";
    import SettingsIcon from "../../Icons/SettingsIcon.svelte";
    import Woka from "../../Woka/WokaFromUserId.svelte";
    import AdditionalMenuItems from "./AdditionalMenuItems.svelte";
    import ContextualMenuItems from "./ContextualMenuItems.svelte";
    import HeaderMenuItem from "./HeaderMenuItem.svelte";

    interface Props {
        showContextualMenuItems: boolean;
    }

    let { showContextualMenuItems }: Props = $props();

    // This component is mounted in the global floating UI layer, so it must provide
    // the menu contexts itself rather than inheriting them from the action bar.
    setContext("profileMenu", true);
    setContext("inMenu", true);

    const statusToShow: Array<RequestedStatus | AvailabilityStatus.ONLINE> = [
        AvailabilityStatus.ONLINE,
        AvailabilityStatus.BUSY,
        AvailabilityStatus.BACK_IN_A_MOMENT,
        AvailabilityStatus.DO_NOT_DISTURB,
    ];

    function showWokaNameMenuItem() {
        return connectionManager.currentRoom?.opidWokaNamePolicy !== "force_opid";
    }

    function openEditNameScene() {
        loginSceneVisibleStore.set(true);
        gameManager.leaveGame(LoginSceneName, new LoginScene());
    }

    function openEditSkinScene() {
        selectCharacterSceneVisibleStore.set(true);
        gameManager.leaveGame(SelectCharacterSceneName, new SelectCharacterScene());
    }

    function openEditCompanionScene() {
        selectCompanionSceneVisibleStore.set(true);
        gameManager.leaveGame(SelectCompanionSceneName, new SelectCompanionScene());
    }

    function openEnableCameraScene() {
        enableCameraSceneVisibilityStore.showEnableCameraScene();
        gameManager.leaveGame(EnableCameraSceneName, new EnableCameraScene());
        analyticsClient.trackAdminEvent("profile.camera_edit_opened");
    }

    async function openFeedbackScene() {
        const feedbackIntegrationInstance = Sentry.feedbackIntegration({
            colorScheme: "system",
            showBranding: false,
            enableScreenshot: true,
            formTitle: $LL.actionbar.issueReport.formTitle(),
            emailLabel: $LL.actionbar.issueReport.emailLabel(),
            nameLabel: $LL.actionbar.issueReport.nameLabel(),
            messageLabel: $LL.actionbar.issueReport.descriptionLabel(),
            messagePlaceholder: $LL.actionbar.issueReport.descriptionPlaceholder(),
            submitButtonLabel: $LL.actionbar.issueReport.submitButtonLabel(),
            cancelButtonLabel: $LL.actionbar.issueReport.cancelButtonLabel(),
            confirmButtonLabel: $LL.actionbar.issueReport.confirmButtonLabel(),
            addScreenshotButtonLabel: $LL.actionbar.issueReport.addScreenshotButtonLabel(),
            removeScreenshotButtonLabel: $LL.actionbar.issueReport.removeScreenshotButtonLabel(),
            successMessageText: $LL.actionbar.issueReport.successMessageText(),
            removeHighlightText: $LL.actionbar.issueReport.removeHighlightText(),
            highlightToolText: $LL.actionbar.issueReport.highlightToolText(),
            hideToolText: $LL.actionbar.issueReport.hideToolText(),
            isRequiredLabel: "",
            onFormOpen: () => {
                analyticsClient.trackAdminEvent("feedback.opened", { feedbackSource: "sentry" });
                gameManager.getCurrentGameScene().userInputManager.disableControls("store");
                gameManager.getCurrentGameScene().userInputManager.disableRightClick();
                openedMenuStore.close("profileMenu");
            },
            onFormClose: () => {
                gameManager.getCurrentGameScene().userInputManager.restoreControls("store");
                gameManager.getCurrentGameScene().userInputManager.restoreRightClick();
                form?.close();
            },
            onSubmitSuccess: () => {
                // No hasScreenshot: the form allows one but tells us nothing about it
                // here, and the property is optional precisely so it can be left out
                // rather than guessed.
                analyticsClient.trackAdminEvent("feedback.submitted", { feedbackSource: "sentry" });
                gameManager.getCurrentGameScene().userInputManager.restoreControls("store");
                gameManager.getCurrentGameScene().userInputManager.restoreRightClick();
                form?.close();
            },
        });
        const form = await feedbackIntegrationInstance?.createForm();
        form?.appendToDom();
        form?.open();
    }

    let rightActionBarMenuItemsInBurgerMenu: Readable<RightMenuItem[]> = derived(
        rightActionBarMenuItems,
        ($rightActionBarMenuItems, set) => {
            const theDerived = derived(
                $rightActionBarMenuItems.map((item) => item.fallsInBurgerMenuStore),
                (items) => items,
            );
            const ghostSubscriptionUnsubscribe = theDerived.subscribe(() => {
                set(get(rightActionBarMenuItems).filter((item) => get(item.fallsInBurgerMenuStore)));
            });
            return () => ghostSubscriptionUnsubscribe();
        },
    );

    function openPwaInstallPrompt(): void {
        analyticsClient.trackAdminEvent("pwa.install_from_profile_menu_clicked");
        openedMenuStore.close("profileMenu");
        gameManager.leaveGame(PwaInstallSceneName, new PwaInstallScene());
    }
</script>

<div class="bg-contrast/80 backdrop-blur rounded-md p-1 w-56 text-white select-none" data-testid="profile-menu">
    <div class="p-0 m-0 list-none overflow-y-auto max-h-[calc(100vh-96px)]">
        <ExternalComponents zone="menuTop" />
        <!-- quanta: what the dock had no room for comes first -->
        {#if QUANTA_UI && ($dockFoldedStore.length > 0 || $pageMenuStore.length > 0)}
            <DockFoldedItems />
        {/if}
        <!-- quanta: a class's menu is two rows, and needs no headings between them -->
        {#if entryVisible(QUANTA_UI, "status")}
            <AvailabilityStatusList statusInformation={getStatusInformation(statusToShow)} />
        {/if}
        {#if !QUANTA_UI}
            <HeaderMenuItem label={$LL.menu.sub.profile()} />
        {/if}
        {#if entryVisible(QUANTA_UI, "name", showWokaNameMenuItem())}
            <ActionBarButton
                label={$LL.actionbar.profil()}
                onclick={() => {
                    openEditNameScene();
                    analyticsClient.trackAdminEvent("profile.name_edit_opened");
                }}
            >
                <ProfilIcon />
            </ActionBarButton>
        {/if}
        <ActionBarButton
            label={$LL.actionbar.woka()}
            onclick={() => {
                openEditSkinScene();
                analyticsClient.trackAdminEvent("profile.woka_edit_opened");
            }}
        >
            <Woka userId={-1} placeholderSrc="" customWidth="26px" />
        </ActionBarButton>
        {#if entryVisible(QUANTA_UI, "companion")}
            <ActionBarButton
                label={$LL.actionbar.companion()}
                onclick={() => {
                    openEditCompanionScene();
                    analyticsClient.trackAdminEvent("profile.companion_edit_opened");
                }}
            >
                <Companion
                    userId={-1}
                    placeholderSrc="../static/images/default-companion.png"
                    width="26px"
                    height="26px"
                />
            </ActionBarButton>
        {/if}

        {#if !QUANTA_UI}
            <HeaderMenuItem label={$LL.menu.sub.settings()} />
        {/if}
        <!-- quanta: the dock's device trays replace it -->
        {#if !QUANTA_UI}
            <ActionBarButton label={$LL.actionbar.editCamMic()} onclick={openEnableCameraScene}>
                <CamSettingsIcon />
            </ActionBarButton>
        {/if}

        {#if entryVisible(QUANTA_UI, "issueReport", SENTRY_DSN_FRONT != undefined && !!connectionManager.currentRoom?.isIssueReportEnabled)}
            <ActionBarButton label={$LL.actionbar.issueReport.menuAction()} onclick={openFeedbackScene}>
                <IconBug font-size="22" />
            </ActionBarButton>
        {/if}

        <!-- quanta: the map's zoom, from the corner column that no longer stands over the room (ExplorerMenu.svelte) -->
        {#if QUANTA_UI}
            <ActionBarButton
                label={$QL.zoomIn()}
                dataTestId="quanta-zoom-in"
                onclick={() =>
                    gameManager.getCurrentGameScene().getCameraManager()?.smoothZoomByFactor(BUTTON_ZOOM_STEP_FACTOR)}
            >
                <IconPlus font-size="22" />
            </ActionBarButton>
            <ActionBarButton
                label={$QL.zoomOut()}
                dataTestId="quanta-zoom-out"
                onclick={() =>
                    gameManager
                        .getCurrentGameScene()
                        .getCameraManager()
                        ?.smoothZoomByFactor(1 / BUTTON_ZOOM_STEP_FACTOR)}
            >
                <IconMinus font-size="22" />
            </ActionBarButton>
            <ActionBarButton
                label={$QL.zoomWholeRoom()}
                dataTestId="quanta-zoom-fit"
                onclick={() => {
                    gameManager.getCurrentGameScene().getCameraManager()?.refitRoom(true, true);
                    openedMenuStore.close("profileMenu");
                }}
            >
                <IconZoomInArea font-size="22" />
            </ActionBarButton>
        {/if}

        <!-- quanta: the class screen's layout, each person's own (quanta/layout.ts) -->
        {#if QUANTA_UI}
            <LayoutMenuItems />
        {/if}

        <!-- quanta: the dialog opens on Audio, and devices are what anyone in a class comes here for -->
        <ActionBarButton
            label={QUANTA_UI ? $QL.audioVideoSettings() : $LL.actionbar.allSettings()}
            onclick={() => {
                showMenuItem(SubMenusInterface.settings);
                analyticsClient.trackAdminEvent("menu.opened");
                openedMenuStore.close("profileMenu");
            }}
        >
            <SettingsIcon />
        </ActionBarButton>

        {#if QUANTA_UI && $userIsAdminStore}
            <ActionBarButton
                label={$LL.megaphone.modal.title()}
                dataTestId="quanta-announce"
                onclick={() => {
                    showModalGlobalComminucationVisibilityStore.set(true);
                    openedMenuStore.close("profileMenu");
                }}
            >
                <MegaphoneIcon />
            </ActionBarButton>
        {/if}

        <!-- quanta: the map editor for whoever may edit this room; its usual places (the right bar, Explore) are not in a class -->
        {#if QUANTA_UI && $mapEditorMenuVisibleStore}
            <ActionBarButton
                label={$LL.actionbar.mapEditor()}
                dataTestId="quanta-map-editor"
                onclick={() => {
                    analyticsClient.trackAdminEvent("map_editor.opened");
                    mapEditorModeStore.switchMode(true);
                    gameManager.getCurrentGameScene().getMapEditorModeManager()?.equipTool(EditorToolName.EntityEditor);
                    openedMenuStore.close("profileMenu");
                }}
            >
                <IconMapEditor font-size="22" />
            </ActionBarButton>
        {/if}

        {#if $canViewAsStudentStore}
            <ActionBarButton
                label={$studentViewStore ? $QL.stopStudentView() : $QL.viewAsStudent()}
                dataTestId="quanta-student-view-toggle"
                onclick={() => {
                    // Students can't speak to the class from anywhere, so this view has no button to stop it.
                    if (!$studentViewStore) stopSpeakingToClass();
                    setStudentView(!$studentViewStore);
                    openedMenuStore.close("profileMenu");
                }}
            >
                <IconEye font-size="22" />
            </ActionBarButton>
        {/if}

        {#if showContextualMenuItems}
            <div class="items-center">
                <ContextualMenuItems />
            </div>
        {/if}

        <AdditionalMenuItems menu="profileMenu" />

        <!-- quanta: the right-hand bar's invite, map and participant items are all in Quanta's page or the zoom column -->
        {#if entryVisible(QUANTA_UI, "rightBar")}
            {#each $rightActionBarMenuItemsInBurgerMenu ?? [] as button (button.id)}
                {@const ButtonComponent = button.component}
                <ButtonComponent {...button.props} />
            {/each}
        {/if}

        {#if entryVisible(QUANTA_UI, "installApp", $pwaInstallProfileMenuEligibleStore === true)}
            <button
                data-testid="profile-menu-install-web-app"
                disabled={$pwaInstallProfileMenuEligibleStore !== true}
                onclick={openPwaInstallPrompt}
                class="group flex p-2 gap-2 items-center font-bold text-sm w-full pointer-events-auto text-start rounded transition-all {$pwaInstallProfileMenuEligibleStore ===
                true
                    ? 'hover:bg-white/10 cursor-pointer'
                    : 'opacity-50 cursor-not-allowed'}"
            >
                <div class="transition-all w-6 h-6 aspect-square text-center flex items-center justify-center">
                    <IconFileDownload height="20" width="20" class="text-white" />
                </div>
                <div class="text-start leading-4 text-white flex items-center">
                    {$LL.actionbar.installPwa()}
                </div>
            </button>
        {/if}

        <!-- quanta: Quanta has its own help, and signing out of Quanta signs out of the room -->
        {#if !QUANTA_UI}
            <button
                onclick={() => {
                    onboardingStore.restart();
                    openedMenuStore.close("profileMenu");
                }}
                class="group flex p-2 gap-2 items-center hover:bg-white/10 transition-all cursor-pointer font-bold text-sm w-full pointer-events-auto text-start rounded"
            >
                <div class="transition-all w-6 h-6 aspect-square text-center flex items-center justify-center">
                    <IconHelpCircle height="20" width="20" class="text-white" />
                </div>
                <div class="text-start leading-4 text-white flex items-center">
                    {$LL.menu.profile.helpAndTips()}
                </div>
            </button>

            {#if ENABLE_OPENID && $userIsConnected}
                <button
                    onclick={() => {
                        analyticsClient.trackAdminEvent("auth.logout_clicked");
                        connectionManager.logout();
                    }}
                    class="group flex p-2 gap-2 items-center hover:bg-danger-600 transition-all cursor-pointer font-bold text-sm w-full pointer-events-auto text-start rounded"
                >
                    <div class="transition-all w-6 h-6 aspect-square text-center flex items-center justify-center">
                        <IconLogout height="20" width="20" class="text-danger-800 group-hover:text-white" />
                    </div>
                    <div class="text-start leading-4 text-danger-800 group-hover:text-white flex items-center">
                        {$LL.menu.profile.logout()}
                    </div>
                </button>
            {/if}
        {/if}
    </div>
</div>
