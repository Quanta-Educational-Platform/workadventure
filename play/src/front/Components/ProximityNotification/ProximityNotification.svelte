<script lang="ts">
    import { fade } from "svelte/transition";
    import { onMount } from "svelte";
    import type { ProximityNotification } from "../../Stores/ProximityNotificationStore";
    import { chatNotificationStore } from "../../Stores/ProximityNotificationStore";
    import { chatVisibilityStore } from "../../Stores/ChatStore";
    import { selectedRoomStore } from "../../Chat/Stores/SelectRoomStore";
    import { navChat } from "../../Chat/Stores/ChatStore";
    import LL from "../../../i18n/i18n-svelte";
    import { focusNotificationTarget } from "./NotificationRoomFocus";
    import { QL } from "../../quanta/i18n";

    interface Props {
        notification: ProximityNotification;
    }

    let { notification }: Props = $props();

    let roomType = $derived(notification.room.type);
    let roomName = $derived(notification.room.name);

    const NOTIFICATION_DURATION = 10000; // 10 seconds

    onMount(() => {
        const timeout = setTimeout(() => {
            chatNotificationStore.removeNotification(notification.id);
        }, NOTIFICATION_DURATION);

        return () => {
            clearTimeout(timeout);
        };
    });

    function handleClick() {
        if (notification.onOpen) {
            chatNotificationStore.removeNotification(notification.id);
            notification.onOpen();
            return;
        }
        chatVisibilityStore.set(true);
        navChat.switchToChat();

        if (notification.openRoomOnClick !== false) {
            const room = notification.room;
            chatNotificationStore.clearRoom(room.id);
            room.setTimelineAsRead();
            selectedRoomStore.set(room);
            focusNotificationTarget(room, notification.messageId, notification.sidePanelSection);
        } else {
            chatNotificationStore.clearAll();
            // Open the chat on the main chat panel
            selectedRoomStore.set(undefined);
        }
    }
</script>

<div
    class="proximity-notification bg-contrast/50 rounded backdrop-blur-md flex gap-3 py-3 pl-5 pr-2 shadow-xl pointer-events-auto z-[900] cursor-pointer hover:bg-contrast/90 transition-colors text-white w-[60%] min-w-[300px] max-w-[600px]"
    onclick={handleClick}
    role="button"
    tabindex="0"
    onkeydown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handleClick();
        }
    }}
    out:fade={{ duration: 150 }}
>
    {#if notification.mention}
        <div class="quanta-mention-toast-icon" aria-hidden="true">@</div>
    {:else}
        <div class="mt-1 text-white text-xl flex-shrink-0">💬</div>
    {/if}

    <div class="flex flex-col text-white flex-1 min-w-0 overflow-hidden">
        <div
            class="font-bold mb-1 text-base text-white truncate font-['Roboto_Condensed'] tracking-normal align-middle"
        >
            {notification.userName}
            {#if notification.mention}
                <span class="proximity-notification-room"
                    >{notification.onOpen ? $QL.mentionedYouDirect() : $QL.mentionedYou()}</span
                >
            {:else if $roomType !== "direct"}
                <!-- quanta: the room steps back from the sender's name (quanta-ui.css). -->
                <span class="proximity-notification-room">{$LL.chat.notification.in()} {$roomName}</span>
            {/if}
        </div>
        <div
            data-testid="proximity-notification-message"
            class="font-['Roboto_Condensed'] font-normal text-lg leading-[24px] tracking-normal text-white line-clamp-2"
        >
            {notification.message}
        </div>
    </div>
</div>

<style>
    @keyframes slide-up {
        from {
            transform: translateY(100%);
            opacity: 0;
        }
        to {
            transform: translateY(0);
            opacity: 1;
        }
    }

    .proximity-notification {
        animation: slide-up 0.3s ease-out;
    }

    .quanta-mention-toast-icon {
        flex: none;
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        margin-top: 2px;
        border-radius: 50%;
        background: #f2c14e;
        color: #1b1f26;
        font-size: 16px;
        font-weight: 700;
        line-height: 1;
    }
</style>
