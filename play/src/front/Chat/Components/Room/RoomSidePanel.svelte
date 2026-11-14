<script lang="ts">
    import LL from "../../../../i18n/i18n-svelte";
    import type {
        ChatRoom,
        ChatRoomMembershipManagement,
        ChatRoomModeration,
        ChatRoomNotificationControl,
        ChatRoomSettingsManagement,
        ProximityChatSidePanelRoom,
    } from "../../Connection/ChatConnection";
    import { hasProximityChatSidePanel } from "../../Connection/ChatConnection";
    import { roomSidePanelStore, type RoomSidePanelSection } from "../../Stores/RoomSidePanelStore";
    import ThreadPanel from "./ThreadPanel.svelte";
    import RoomSidePanelParticipants from "./RoomSidePanelParticipants.svelte";
    import RoomSidePanelPolls from "./RoomSidePanelPolls.svelte";
    import RoomSidePanelHome from "./RoomSidePanelHome.svelte";
    import RoomSidePanelSettings from "./RoomSidePanelSettings.svelte";
    import ProximityRoomSidePanelHome from "./ProximityRoomSidePanelHome.svelte";
    import ProximityRoomSidePanelParticipants from "./ProximityRoomSidePanelParticipants.svelte";
    import ProximityRoomSidePanelQuestions from "./ProximityRoomSidePanelQuestions.svelte";
    import { IconChevronLeft } from "@wa-icons";

    type MatrixSidePanelRoom = ChatRoom &
        ChatRoomMembershipManagement &
        ChatRoomModeration &
        ChatRoomNotificationControl &
        ChatRoomSettingsManagement;
    type SidePanelRoom = MatrixSidePanelRoom | ProximityChatSidePanelRoom;
    type ProximityRoomSidePanelSection = "home" | "participants" | "polls" | "questions";

    interface Props {
        room: SidePanelRoom;
        showCloseButton?: boolean;
        closeOnTimelineFocus?: boolean;
    }

    let { room, showCloseButton = false, closeOnTimelineFocus = false }: Props = $props();

    function isProximityRoomSidePanelSection(section: RoomSidePanelSection): section is ProximityRoomSidePanelSection {
        return section === "home" || section === "participants" || section === "polls" || section === "questions";
    }

    function getMatrixSidePanelRoom(currentRoom: SidePanelRoom): MatrixSidePanelRoom | undefined {
        if (hasProximityChatSidePanel(currentRoom)) {
            return undefined;
        }

        return currentRoom;
    }

    let proximityRoom = $derived(hasProximityChatSidePanel(room) ? room : undefined);
    let matrixRoom = $derived(getMatrixSidePanelRoom(room));
    let isProximityRoom = $derived(proximityRoom !== undefined);
    let activeSection = $derived($roomSidePanelStore.activeSection);
    let displayedSection = $derived(
        isProximityRoom && !isProximityRoomSidePanelSection(activeSection) ? "home" : activeSection,
    );
    let shouldShowCloseButton = $derived(showCloseButton || (!isProximityRoom && activeSection === "settings"));
    $effect(() => {
        if (!isProximityRoom || displayedSection === activeSection) {
            return;
        }
        roomSidePanelStore.setActiveSection("home");
    });
    // quanta: a room's chat has no hub to come back to: people have their own tab, polls and questions are in the chat.
    $effect(() => {
        if (isProximityRoom && (displayedSection === "home" || displayedSection === "participants")) {
            roomSidePanelStore.close();
        }
    });
</script>

<div class="flex h-full min-h-0 flex-col" data-testid="roomSidePanel">
    {#if displayedSection !== "home" || shouldShowCloseButton}
        <div class="quanta-panel-head">
            <button
                type="button"
                class="quanta-card-action"
                data-testid="roomSidePanelBackButton"
                title={$LL.chat.roomPanel.back()}
                aria-label={$LL.chat.roomPanel.back()}
                onclick={() => roomSidePanelStore.close()}
            >
                <IconChevronLeft font-size={18} />
            </button>
            <div class="quanta-panel-title">
                {#if displayedSection === "threads"}
                    {$LL.chat.roomPanel.sections.threads()}
                {:else if displayedSection === "polls"}
                    {$LL.chat.roomPanel.sections.polls()}
                {:else if displayedSection === "participants"}
                    {$LL.chat.roomPanel.sections.participants()}
                {:else if displayedSection === "questions"}
                    {$LL.chat.question.title()}
                {:else if displayedSection === "settings"}
                    {$LL.chat.roomPanel.sections.settings()}
                {/if}
            </div>
        </div>
    {/if}

    <div class="min-h-0 flex-1 overflow-hidden">
        {#key `${room.id}-${displayedSection}`}
            {#if proximityRoom}
                {#if displayedSection === "participants"}
                    <ProximityRoomSidePanelParticipants room={proximityRoom} />
                {:else if displayedSection === "polls"}
                    <RoomSidePanelPolls room={proximityRoom} {closeOnTimelineFocus} />
                {:else if displayedSection === "questions"}
                    <ProximityRoomSidePanelQuestions room={proximityRoom} />
                {:else}
                    <ProximityRoomSidePanelHome room={proximityRoom} />
                {/if}
            {:else if matrixRoom}
                {#if displayedSection === "home"}
                    <RoomSidePanelHome room={matrixRoom} />
                {:else if displayedSection === "threads"}
                    <ThreadPanel room={matrixRoom} />
                {:else if displayedSection === "participants"}
                    <RoomSidePanelParticipants room={matrixRoom} />
                {:else if displayedSection === "polls"}
                    <RoomSidePanelPolls room={matrixRoom} {closeOnTimelineFocus} />
                {:else}
                    <RoomSidePanelSettings room={matrixRoom} />
                {/if}
            {/if}
        {/key}
    </div>
</div>
