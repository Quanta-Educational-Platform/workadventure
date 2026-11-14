<script lang="ts">
    import { fly } from "svelte/transition";
    import type { Notification } from "../../Stores/NotificationStore";
    import { notificationPlayingStore } from "../../Stores/NotificationStore";
    import microphoneOffImg from "../images/mic.svg";
    import cameraOffImg from "../images/cam.svg";
    import jistiImg from "../images/jitsi.png";
    import waImg from "../images/icon-workadventure-white.png";
    import AreaToolImg from "../images/icon-tool-area.png";
    import { QUANTA_UI } from "../../Enum/EnvironmentVariable";
    import Notice from "../../quanta/Notice.svelte";
    import { notificationLook } from "../../quanta/noticeLook";
    import megaphoneImg from "./images/megaphone.svg";
    import recordingStopImg from "./images/recording-stop.svg";
    import recordingStartImg from "./images/recording-start.svg";

    const icons = new Map<string, string>([
        ["microphone-off.png", microphoneOffImg],
        ["camera-off.png", cameraOffImg],
        ["jitsi.png", jistiImg],
        ["icon-tool-area.png", AreaToolImg],
        ["megaphone", megaphoneImg],
        ["recording-stop", recordingStopImg],
        ["recording-start", recordingStartImg],
    ]);

    interface Props {
        notification: Notification;
        /** quanta: the room's notice stack reads it out itself. */
        live?: "polite" | "assertive" | "off";
    }

    let { notification, live = "polite" }: Props = $props();

    // quanta: the room's line icon and the kind of notice it is (noticeLook.ts).
    let quanta = $derived(notificationLook(notification));

    // Cleared after 5 seconds, or as long as it asked for, by the store (NotificationStore.ts): a notice the room's
    // stack keeps out of sight still goes on time.
</script>

{#if QUANTA_UI}
    <div class="quanta-notice-slot" transition:fly={{ y: 12, duration: 200 }}>
        <Notice
            tone={notification.tone ?? quanta.tone}
            icon={quanta.icon}
            lead={notification.lead}
            text={notification.text}
            {live}
            ondismiss={() => notificationPlayingStore.removeNotification(notification)}
            testid="quanta-notice"
        />
    </div>
{:else}
    <div
        class="notification-playing bg-contrast/80 p-1 backdrop-blur rounded-lg mr-3"
        transition:fly={{ x: 210, duration: 500 }}
    >
        <img
            src={notification.icon ? (icons.get(notification.icon) ?? notification.icon) : waImg}
            alt="Audio playing"
            class="bg-white/10 rounded-md h-12"
            draggable="false"
        />
        <p>{notification.text}</p>
    </div>
{/if}

<style>
    /*audio html when audio message playing*/
    .notification-playing {
        top: 40px;
        transition: all 0.1s ease-out;
        display: inline-flex;
        align-items: center;
        z-index: 750;

        img {
            padding: 5px;
        }

        p {
            color: white;
            margin-left: 10px;
            margin-top: 14px;
            margin-right: 10px;
        }
    }
</style>
