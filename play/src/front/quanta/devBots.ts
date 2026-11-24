// quanta: dev tools on staging (DevBotsPanel.svelte): fake students for whoever runs the room, to try and show a
// class. The page holds them (DEV only, the web app's use-room-dev-bots.ts): each is the student's own whole Quanta
// page, on an address and sign-in of its own, with the course's room open in it (botMode.ts) doing what it is told
// (botControl.ts). Their room frames are on this origin, so they are driven from here directly; the page makes,
// shows and removes them. "Play as" has the page lay that student's page over this one, header and board included.
import { derived, get, writable } from "svelte/store";
import { gameManager } from "../Phaser/Game/GameManager";
import { BOT, BOT_MARKER } from "./botMode";
import type { BotApi, BotState } from "./botControl";

const STAGING_HOST = "wa-dev.qed.world";

/** On staging, for the person running the room, and never inside a bot. */
export const devToolsAvailable = !BOT && window.location.hostname === STAGING_HOST;

export interface DevBot {
    userId: string;
    name: string;
    state: BotState | null;
    joinedAt: number;
}

export const devBotsStore = writable<DevBot[]>([]);
export const devBotsPanelOpenStore = writable(false);
/** Folded to its pill (still open). */
export const devBotsPanelFoldedStore = writable(false);
/** Their voices stay out of this person's ears (they still talk to everyone else, and still show as talking). */
export const devBotsMutedForMeStore = writable(true);
/** The bot whose page is up over this one. */
export const playingAsStore = writable<string | null>(null);
export const devBotsErrorStore = writable<string | null>(null);
export const devBotsBusyStore = writable(false);

/** User ids of the bots muted for this person now. */
export const mutedBotIdsStore = derived([devBotsStore, devBotsMutedForMeStore], ([$bots, $muted]) =>
    $muted ? new Set($bots.map((bot) => bot.userId)) : new Set<string>(),
);

const botIds = () => get(devBotsStore).map((bot) => bot.userId);

/**
 * The bot's room: inside its page, one of the frames beside this room's on the page. Found afresh each time, as the
 * bot's page may have reloaded it.
 */
function api(userId: string): BotApi | undefined {
    const prefix = `${BOT_MARKER}${userId}:`;
    const pages = window.parent.frames;
    for (let page = 0; page < pages.length; page++) {
        try {
            const frames = pages[page].frames;
            for (let index = 0; index < frames.length; index++) {
                try {
                    const room = frames[index];
                    if (room.name.startsWith(prefix)) return room.quantaBot;
                } catch {
                    // Another origin's frame: not a bot's room.
                }
            }
        } catch {
            // Gone while looking.
        }
    }
    return undefined;
}

const tellPage = (message: object) => window.parent.postMessage(message, "*");

let requests = 0;
/** Asks the page for the first `count` bots; it answers with every bot it holds. */
function askPage(count: number): Promise<Array<{ userId: string; name: string }>> {
    const requestId = `bots-${Date.now()}-${++requests}`;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            window.removeEventListener("message", onMessage);
            reject(new Error("The page did not answer. Is this the Quanta page on DEV?"));
        }, 60_000);
        function onMessage(event: MessageEvent) {
            if (event.source !== window.parent) return;
            const data = event.data as { type?: unknown; requestId?: unknown; bots?: unknown; error?: unknown } | null;
            if (data?.type !== "quanta_dev_bots" || data.requestId !== requestId) return;
            clearTimeout(timer);
            window.removeEventListener("message", onMessage);
            if (Array.isArray(data.bots)) resolve(data.bots as Array<{ userId: string; name: string }>);
            else reject(new Error(typeof data.error === "string" ? data.error : "No bots"));
        }
        window.addEventListener("message", onMessage);
        tellPage({ type: "quanta_dev_bots_wanted", requestId, count });
    });
}

/** Brings `count` more bots in (the same people each time: those already here stay). */
export async function addBots(count: number): Promise<void> {
    devBotsErrorStore.set(null);
    devBotsBusyStore.set(true);
    try {
        const held = await askPage(get(devBotsStore).length + count);
        const before = new Map(get(devBotsStore).map((bot) => [bot.userId, bot]));
        devBotsStore.set(
            held.map((bot) => before.get(bot.userId) ?? { userId: bot.userId, name: bot.name, state: null, joinedAt: Date.now() }),
        );
    } catch (error) {
        devBotsErrorStore.set(error instanceof Error ? error.message : String(error));
    } finally {
        devBotsBusyStore.set(false);
    }
}

export function removeBot(userId: string): void {
    if (get(playingAsStore) === userId) playingAsStore.set(null);
    tellPage({ type: "quanta_dev_bots_remove", userId });
    devBotsStore.update((bots) => bots.filter((bot) => bot.userId !== userId));
}

export function removeAllBots(): void {
    for (const userId of botIds()) removeBot(userId);
}

/** Tells one bot, or every bot. */
export function tell(userId: string | "all", order: (bot: BotApi, index: number) => void): void {
    const ids = userId === "all" ? botIds() : [userId];
    ids.forEach((id, index) => {
        const bot = api(id);
        if (bot) order(bot, index);
    });
    refresh();
}

/** Every bot around this person, in a ring. */
export function comeToMe(): void {
    let me: { x: number; y: number } | undefined;
    try {
        const player = gameManager.getCurrentGameScene().CurrentPlayer;
        me = { x: player.x, y: player.y };
    } catch {
        return;
    }
    const ids = botIds();
    tell("all", (bot, index) => {
        const angle = (index / Math.max(ids.length, 1)) * Math.PI * 2;
        void bot.walkTo(me!.x + Math.cos(angle) * 56, me!.y + Math.sin(angle) * 40);
    });
}

/** The page lays the bot's whole page over this one, with its own way back (which it reports). */
export function playAs(userId: string | null): void {
    playingAsStore.set(userId);
    tellPage({ type: "quanta_dev_bots_play_as", userId });
}

function refresh(): void {
    devBotsStore.update((bots) =>
        bots.map((bot) => {
            try {
                return { ...bot, state: api(bot.userId)?.state() ?? null };
            } catch {
                return { ...bot, state: null };
            }
        }),
    );
}

// Each bot's state while any are here, for the panel; and the page's word that the person came back from playing one.
let poll: ReturnType<typeof setInterval> | undefined;
if (devToolsAvailable) {
    // Lives as long as the page.
    // eslint-disable-next-line svelte/no-ignored-unsubscribe
    devBotsStore.subscribe((bots) => {
        if (bots.length > 0 && poll === undefined) poll = setInterval(refresh, 1000);
        else if (bots.length === 0 && poll !== undefined) {
            clearInterval(poll);
            poll = undefined;
        }
    });
    window.addEventListener("message", (event: MessageEvent) => {
        if (event.source !== window.parent) return;
        const data = event.data as { type?: unknown; userId?: unknown } | null;
        if (data?.type === "quanta_dev_bots_playing" && data.userId === null) playingAsStore.set(null);
    });
}
