// quanta: what a fake student (botMode.ts) does when the dev tools (devBots.ts) tell it: its microphone, camera and
// voice, a hand, a shared screen, a chat line now and then, and where it walks. The dev tools call these directly: the
// bot's frame is the room's own origin, inside the room of whoever started it.
import { get } from "svelte/store";
import { requestedCameraState, requestedMicrophoneState } from "../Stores/MediaStore";
import { requestedScreenSharingState } from "../Stores/ScreenSharingStore";
import { requestedHandRaiseState } from "../Stores/RaiseHandStore";
import { raiseHandSpacesStore } from "../Stores/RaiseHandAvailabilityStore";
import { gameManager } from "../Phaser/Game/GameManager";
import { BOT } from "./botMode";
import { fakeTalk, fakeVoiceState } from "./fakeMedia";
import { walkQuietlyTo } from "./goTo";
import { comeBackFromSpot, goToNearestSpot } from "./spotTrip";
import { classChatRoom } from "./chatAudience";

const LINES = [
    "Is it 16?",
    "I got 8 twos",
    "Can you show that again?",
    "Done!",
    "I think the answer is 2",
    "Wait, why does it stay even?",
    "Can I share my screen?",
    "Ready",
    "Is this on the test?",
    "Got it, thanks",
];

export interface BotState {
    ready: boolean;
    mic: boolean;
    camera: boolean;
    talking: boolean;
    hand: boolean;
    sharing: boolean;
    chatEvery: number | null;
    /** The voice's audio, once made: "suspended" means the browser holds it back. */
    voice: AudioContextState | null;
}

let talking = false;
let wantsHand = false;

function raiseIfWanted(): void {
    const space = get(raiseHandSpacesStore)[0];
    if (wantsHand && space && get(requestedHandRaiseState).size === 0) requestedHandRaiseState.toggle(space.getName());
}
let chatTimer: ReturnType<typeof setInterval> | undefined;
let chatEvery: number | null = null;

function scene() {
    try {
        return gameManager.getCurrentGameScene();
    } catch {
        return undefined;
    }
}

function say(text?: string): void {
    const line = text ?? LINES[Math.floor(Math.random() * LINES.length)];
    classChatRoom()?.sendMessage(line);
}

export const botApi = {
    state(): BotState {
        return {
            ready: !!scene()?.CurrentPlayer,
            mic: get(requestedMicrophoneState),
            camera: get(requestedCameraState),
            talking,
            hand: get(requestedHandRaiseState).size > 0,
            sharing: get(requestedScreenSharingState),
            chatEvery,
            voice: fakeVoiceState(),
        };
    },
    mic(on: boolean): void {
        if (on) requestedMicrophoneState.enableMicrophone();
        else requestedMicrophoneState.disableMicrophone();
    },
    camera(on: boolean): void {
        if (on) requestedCameraState.enableWebcam();
        else requestedCameraState.disableWebcam();
    },
    /** Talks (the microphone turns on with it) or falls quiet. */
    talk(on: boolean): void {
        talking = on;
        if (on) requestedMicrophoneState.enableMicrophone();
        fakeTalk(on);
    },
    /** Raises a hand (as soon as the bot is somewhere a hand can be raised) or lowers it. */
    hand(on: boolean): void {
        wantsHand = on;
        if (!on) requestedHandRaiseState.lowerAll();
        else raiseIfWanted();
    },
    share(on: boolean): void {
        if (on) requestedScreenSharingState.enableScreenSharing();
        else requestedScreenSharingState.disableScreenSharing();
    },
    say,
    /** A chat line every `seconds` (null stops). */
    chatEvery(seconds: number | null): void {
        clearInterval(chatTimer);
        chatEvery = seconds;
        if (seconds) chatTimer = setInterval(() => say(), seconds * 1000);
    },
    /** Walks to a point on the map (pixels). */
    walkTo(x: number, y: number): Promise<void> {
        const current = scene();
        return current ? walkQuietlyTo(current, { x, y }) : Promise.resolve();
    },
    position(): { x: number; y: number } | null {
        const player = scene()?.CurrentPlayer;
        return player ? { x: player.x, y: player.y } : null;
    },
    goToSpot(): void {
        requestedMicrophoneState.enableMicrophone();
        goToNearestSpot();
    },
    leaveSpot(): void {
        comeBackFromSpot();
    },
};

export type BotApi = typeof botApi;

declare global {
    interface Window {
        quantaBot?: BotApi;
    }
}

export function startBotControl(): void {
    if (!BOT) return;
    window.quantaBot = botApi;
    // A hand asked for before the bot was in a call goes up when it is.
    // Lives as long as the bot.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    raiseHandSpacesStore.subscribe(() => raiseIfWanted());
}
