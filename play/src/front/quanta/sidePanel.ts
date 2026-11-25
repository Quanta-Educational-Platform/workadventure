// quanta: the chat in the platform's side column, where its people list opens: the same width, margin and corners
// (the platform sends them), one of the two open at a time, with tabs between them. The map, the dock and the camera
// make room for it as they do for the column.
import { derived, get, writable } from "svelte/store";
import { z } from "zod";
import { chatVisibilityStore } from "../Stores/ChatStore";
import { navChat } from "../Chat/Stores/ChatStore";
import { selectedRoomStore } from "../Chat/Stores/SelectRoomStore";
import { chatNotificationStore } from "../Stores/ProximityNotificationStore";
import { coWebsites } from "../Stores/CoWebsiteStore";
import { gameManager } from "../Phaser/Game/GameManager";
import { activeSubMenuStore, menuVisiblilityStore } from "../Stores/MenuStore";
import { QUANTA_ROOM_CHAT_SPACE } from "./roomChatSpace";
import { fromPlatform, onPlatformOriginLearned, platformOrigin } from "./platformOrigin";
import { tableChatStore } from "./chatAudience";
import { closeDirect, openDirectWithAccount } from "./directMessages";
import { startPersonVolumes } from "./personVolumeStart";
import { setStudentView } from "./studentView";
import { dockLiftStore, railRowStore, roomLayoutStore } from "./layout";
import { PHONE_WINDOW, WINDOW, phoneWindow } from "./roomWindow";
import { setSideSlide, sideSlideActive, sideSlideGained, sideSlideShown, sideSlideSpace } from "./sideSlide";

const layout = z.object({
    width: z.number().min(160).max(640),
    margin: z.number().min(0).max(24),
    radius: z.number().min(0).max(24),
    cover: z.boolean(),
    // Switching between People and Chat swaps the column at once; only opening and closing it slide. It concerns
    // the change made with it, never a later one (swapInPlace).
    instant: z.boolean().optional(),
    // Beside the page the open column widens the room's frame by this much (the platform takes it from the page):
    // the room is fitted to the frame without it, so opening and closing the column keeps the map's zoom.
    widens: z.number().min(0).max(4000).optional(),
    // On an upright screen the column is a band below the class's stage instead, this tall, above the dock (layout B).
    below: z.number().min(0).max(2000).optional(),
});
export type SidePanelLayout = z.infer<typeof layout> & { tabs: boolean };

/**
 * How much of the window's right side the side column holds now, in CSS pixels: what the map's window, the dock and
 * the camera leave free for it. Beside the page the column widens the frame as the platform slides the room open
 * (about 400 ms): meanwhile the column holds only what the frame has gained, so the map's window keeps its size the
 * whole way and the column comes in from the edge with the frame, rather than the map being squeezed and refitted.
 */
export const sideColumnShownStore = writable(0);

/** A slide longer than this is over, whatever the frame did (a resize mid-way, a platform that never widened it). */
const FRAME_SLIDE_MAX_MS = 900;

/** A board narrower than this beside the side column can't be drawn on. */
export const WEBSITE_MIN_WIDTH = 400;

// Until the platform says otherwise (or under one that doesn't), the column the people list would have.
function ownLayout(): SidePanelLayout {
    const phone = window.innerWidth <= 480;
    const margin = phone ? 8 : 12;
    return { width: 320, margin, radius: phone ? 14 : 16, cover: window.innerWidth - 320 - margin < 320, tabs: false };
}

export const sidePanelLayoutStore = writable<SidePanelLayout>({
    width: 320,
    margin: 12,
    radius: 16,
    cover: false,
    tabs: false,
});

/**
 * The chat change made right after this swaps the column in place (People and Chat): drawn at once, with no slide.
 * Only that change: the chat reads it as it is drawn (a microtask later), and the next task clears it, so the
 * chat's next close slides out again.
 */
function swapInPlace(): void {
    sidePanelLayoutStore.update((layout) => ({ ...layout, instant: true }));
    setTimeout(() =>
        sidePanelLayoutStore.update((layout) => (layout.instant ? { ...layout, instant: false } : layout)),
    );
}

/** Opens the room's chat as the dock's Chat button does. */
export function showChat(): void {
    const scene = gameManager.getCurrentGameScene();
    closeDirect();
    if (get(peopleOpenStore)) swapInPlace();
    if (!get(chatVisibilityStore)) {
        menuVisiblilityStore.set(false);
        activeSubMenuStore.activateByIndex(0);
    }
    navChat.switchToChat();
    chatVisibilityStore.set(true);
    // The room-wide chat, never the chat of the zone the player happens to stand in (the lecture's, a bubble's).
    const room =
        scene.proximityChatRoomManager.resolveTargetRoom(QUANTA_ROOM_CHAT_SPACE) ??
        (scene.room.isChatEnabled ? undefined : scene.proximityChatRoomManager.resolveTargetRoom());
    if (!room) return;
    selectedRoomStore.set(room);
    room.hasUnreadMessages.set(false);
    room.unreadMessagesCount.set(0);
    chatNotificationStore.clearRoom(room.id);
    room.unreadNotificationCount.set(0);
}

// The platform's people column is open: opening the chat (the dock's button) swaps it in at once.
const peopleOpenStore = writable(false);

/** People or Chat is open in the side column: layout A's rail keeps it room to read under its cards (RailColumn). */
export const sidePanelOpenStore = derived([chatVisibilityStore, peopleOpenStore], ([chat, people]) => chat || people);

/**
 * Layout A beside the stage: the column holds the room and the call above People or Chat, so it stays whether or not
 * either is open (rail.ts). On an upright screen it is a band under the stage instead, and phones' cover too.
 */
export const railColumnStore = derived(
    [roomLayoutStore, sidePanelLayoutStore],
    ([$layout, side]) => $layout === "a" && side.tabs && !side.cover && !side.below,
);

/**
 * The side column (People or Chat) takes the map's right side. The platform draws People over the room, so both tabs
 * leave the map, the camera and the dock where they are: switching moves nothing.
 */
export const sidePanelReservedStore = derived(
    [chatVisibilityStore, peopleOpenStore, sidePanelLayoutStore, railColumnStore],
    ([chat, people, side, rail]) => ((chat || (people && side.tabs)) && !side.cover) || rail,
);

/** From the chat's People tab: the platform opens its list, which closes the chat. */
export function showPeople(): void {
    const parentOrigin = platformOrigin();
    if (parentOrigin) window.parent.postMessage({ type: "quanta_wa_show_people" }, parentOrigin);
}

/**
 * Runs `then` once the frames drawn after the current changes are on screen; returns what cancels it. Two frames: the
 * room is a cross-origin frame whose drawing can reach the screen a frame after the page's.
 */
function afterPaint(then: () => void): () => void {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = requestAnimationFrame(() => {
        if (cancelled) return;
        frame = requestAnimationFrame(() => {
            if (!cancelled) timer = setTimeout(() => !cancelled && then());
        });
    });
    return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
        clearTimeout(timer);
    };
}

export function startSidePanel(): () => void {
    if (window.parent === window) return () => {};
    const root = document.documentElement;
    const portrait = window.matchMedia("(orientation: portrait)");
    sidePanelLayoutStore.set(ownLayout());

    // The frame sliding open or shut beside the page (sideColumnShownStore, sideSlide.ts): followed every frame until
    // the frame has grown by the column or given it back. Resize events come less often than frames.
    let slideTimer: ReturnType<typeof setTimeout> | undefined;
    let slideFrame = 0;
    let slideWidth = 0;
    let lastSpace = 0;
    let lastWidens = 0;
    // The frame's width without the column: where a closing slide ends and an opening one starts. The platform resizes
    // the frame before its word that the column opened or closed arrives, so it is followed here as the frame changes,
    // never worked out from the width at the moment the word lands (a closed column was held for the slide's whole
    // timeout, the map squeezed beside an empty strip).
    let restWidth = window.innerWidth;
    let trackedWidth = window.innerWidth;
    let resizedAhead = false;
    const track = () => {
        const w = window.innerWidth;
        if (w === trackedWidth) return;
        if (!sideSlideActive()) {
            const widens = lastSpace > 0 ? lastWidens : (get(sidePanelLayoutStore).widens ?? 0);
            // Open, the frame gave the column back; closed, it grew by it: the word follows.
            const ahead =
                widens > 0 && Math.abs((lastSpace > 0 ? trackedWidth - w : w - trackedWidth) - widens) <= 1;
            if (ahead && !resizedAhead) {
                resizedAhead = true;
                // No word came after all (the window itself was resized by that much): back to plain following.
                setTimeout(() => {
                    if (!resizedAhead) return;
                    resizedAhead = false;
                    restWidth = lastSpace > 0 ? window.innerWidth - lastWidens : window.innerWidth;
                }, FRAME_SLIDE_MAX_MS);
            }
            if (lastSpace > 0) restWidth = resizedAhead ? w : w - lastWidens;
            else if (!resizedAhead) restWidth = w;
        }
        trackedWidth = w;
    };
    const endSlide = () => {
        clearTimeout(slideTimer);
        cancelAnimationFrame(slideFrame);
        slideTimer = undefined;
        setSideSlide(undefined);
    };
    const follow = () => {
        if (!sideSlideActive()) return;
        if (window.innerWidth !== slideWidth) reserve();
        if (sideSlideActive()) slideFrame = requestAnimationFrame(follow);
    };

    // What the map (quanta-ui.css, domLayerClip.ts) and the co-website leave free on the right for the open chat.
    // Beside a co-website (landscape) the chat sits over the website's side, not the map's.
    const reserve = () => {
        track();
        const open = get(chatVisibilityStore);
        const { width, margin, cover, widens, below } = get(sidePanelLayoutStore);
        const reserved = get(sidePanelReservedStore);
        // Layout A's row of tiles sits above the band, under the stage: the map ends above both.
        const band = (reserved && below ? below + margin : 0) + get(railRowStore);
        const space = reserved && !below ? width + margin : 0;
        const besideWebsite = get(coWebsites).length > 0 && !portrait.matches;
        // Opening or closing beside the page, the frame is about to slide by the column's width: from here on the
        // column holds what the frame has gained (opening) or not yet given back (closing).
        const sliding = !cover && !below && (space > 0 ? (widens ?? 0) > 0 : lastWidens > 0);
        if (sliding && space > 0 !== lastSpace > 0) {
            endSlide();
            const opening = space > 0;
            setSideSlide({
                base: restWidth,
                space: Math.max(space, lastSpace),
                widens: opening ? (widens ?? 0) : lastWidens,
            });
            resizedAhead = false;
            slideTimer = setTimeout(() => (endSlide(), reserve()), FRAME_SLIDE_MAX_MS);
            slideFrame = requestAnimationFrame(follow);
        }
        lastSpace = space;
        lastWidens = space > 0 ? (widens ?? 0) : 0;
        slideWidth = window.innerWidth;
        let shown = space;
        if (sideSlideActive()) {
            const gained = sideSlideGained();
            // There: the frame has grown by all it will, or given it all back.
            if ((space > 0 && gained >= (widens ?? 0) - 1) || (space === 0 && gained <= 0)) endSlide();
            // A frame that grows by less than the column (the page short of room) leaves the map that much less.
            else shown = sideSlideShown();
        }
        sideColumnShownStore.set(shown);
        // How far out the column is drawn: shut, it stays where it stood and the shrinking frame cuts it away.
        root.style.setProperty(
            "--quanta-chat-slide",
            `${Math.max(0, (sideSlideActive() ? sideSlideSpace() : space) - shown)}px`,
        );
        root.style.setProperty("--quanta-chat-map", `${besideWebsite ? 0 : shown}px`);
        root.style.setProperty("--quanta-chat-below", `${band}px`);
        // Layouts A and C stand the dock's notices on what sits under the stage (layout.ts): its foot, from the window's.
        const lift =
            get(roomLayoutStore) !== "b" && band > 0 ? (phoneWindow.matches ? PHONE_WINDOW : WINDOW).bottom + band : 0;
        root.toggleAttribute("data-quanta-lifted", lift > 0);
        dockLiftStore.set(lift);
        root.style.setProperty("--quanta-chat-website", `${get(coWebsites).length > 0 ? space : 0}px`);
        root.style.setProperty(
            "--quanta-side-widens",
            `${sideSlideActive() ? sideSlideGained() : space ? (widens ?? 0) : 0}px`,
        );
        root.classList.toggle("quanta-chat-cover", open && cover);
        root.classList.toggle("quanta-platform-panel", get(sidePanelLayoutStore).tabs);
        window.dispatchEvent(new Event("quanta-chat-reserve"));
    };

    // Also tells the platform this room can show its chat in the column: it offers the Chat tab only then, and only
    // where the room has a chat at all.
    const available = gameManager.getCurrentGameScene().room.isChatEnabled;
    // The last numbered word from the platform applied here: a report carries it, so the platform can tell a report
    // made before its latest word reached the room (and ignore it) from one made after.
    let seq: number | undefined;
    let started = false;
    const tell = () => {
        const parentOrigin = platformOrigin();
        if (!parentOrigin) return;
        window.parent.postMessage(
            {
                type: "quanta_wa_chat_panel",
                open: get(chatVisibilityStore),
                available,
                // Each numbered word is answered once drawn (quanta_wa_chat_drawn): People stays up until then.
                drawn: true,
                ...(seq !== undefined ? { seq } : {}),
                // Said again after a reconnect inside the same frame: the platform sends its layout again.
                ...(started ? {} : { start: true }),
            },
            parentOrigin,
        );
        started = true;
    };
    // Only the room's own changes are reported. One the platform asked for is never answered: answering it, when
    // it crossed a change made here, made each side undo the other's without end.
    let applying = false;
    const fromPlatformWord = (apply: () => void) => {
        applying = true;
        try {
            apply();
        } finally {
            applying = false;
        }
    };
    let lastOpen: boolean | undefined;
    const unsubscribeChat = chatVisibilityStore.subscribe((open) => {
        reserve();
        if (open === lastOpen) return;
        lastOpen = open;
        if (!applying) tell();
    });
    // Said before the platform's origin was known (Firefox, after signing in): said again to the right one.
    const unsubscribeOrigin = onPlatformOriginLearned(tell);
    // The column shows the class's chat, or the table's while the player is at one (chatAudience.ts), each labelled.
    // WA switches the chat on screen to a zone's (the lecture's) or a bubble's when the player enters one, and a
    // notification or shortcut can too: anything else goes back to the class's, and leaving the table does too.
    const unsubscribeRoomChat = derived(
        [chatVisibilityStore, selectedRoomStore, tableChatStore],
        (all) => all,
    ).subscribe(([open, selected, table]) => {
        if (!open) return;
        const room = gameManager
            .getCurrentGameScene()
            .proximityChatRoomManager.resolveTargetRoom(QUANTA_ROOM_CHAT_SPACE);
        if (!room || selected === room || selected?.parentRoom === room) return;
        if (table && selected === table.room) return;
        selectedRoomStore.set(room);
    });
    // The people list's volume for each person, the same as on their tile.
    const stopVolumes = startPersonVolumes();
    const unsubscribeLayout = sidePanelLayoutStore.subscribe(reserve);
    const unsubscribePeople = peopleOpenStore.subscribe(reserve);
    const unsubscribeRail = derived([railColumnStore, railRowStore, roomLayoutStore], (values) => values).subscribe(
        reserve,
    );
    // A website (a board) opened beside the column, which takes its side: left narrower than this, the column
    // closes (the platform closes it, chat or People), since the person opened the website to use it.
    let websitesOpen = get(coWebsites).length;
    let measuring: (() => void) | undefined;
    const unsubscribeWebsites = coWebsites.subscribe((sites) => {
        reserve();
        const opened = sites.length > websitesOpen;
        websitesOpen = sites.length;
        if (!opened || !get(sidePanelReservedStore)) return;
        measuring?.();
        measuring = afterPaint(() => {
            measuring = undefined;
            const website = document.querySelector("#cowebsites-container > div:first-child");
            const parentOrigin = platformOrigin();
            if (!website || !parentOrigin || !get(sidePanelReservedStore)) return;
            if (website.getBoundingClientRect().width < WEBSITE_MIN_WIDTH)
                window.parent.postMessage({ type: "quanta_wa_hide_side_panel" }, parentOrigin);
        });
    });
    portrait.addEventListener("change", reserve);

    const onResize = () => {
        track();
        if (!get(sidePanelLayoutStore).tabs) sidePanelLayoutStore.set(ownLayout());
        // Each step of the frame's slide reveals or hides that much more of the column.
        else if (sideSlideActive()) reserve();
    };
    window.addEventListener("resize", onResize);

    const onMessage = (event: MessageEvent) => {
        if (!fromPlatform(event)) return;
        const data = event.data as { type?: unknown; open?: unknown; chat?: unknown; seq?: unknown } | null;
        // Opening its people list closes the chat, a swap, so at once; only as it opens (the platform says it again
        // with every hands report), and only for a platform that doesn't number its words (those close it themselves).
        if (data?.type === "quanta_wa_people_panel") {
            const opening = data.open === true && !get(peopleOpenStore);
            peopleOpenStore.set(data.open === true);
            if (opening && seq === undefined && get(chatVisibilityStore))
                fromPlatformWord(() => {
                    swapInPlace();
                    chatVisibilityStore.set(false);
                });
            return;
        }
        // The platform's people list covering the room shows the student view's way out, the room's being under it.
        if (data?.type === "quanta_wa_student_view") {
            setStudentView((data as { on?: unknown }).on === true);
            return;
        }
        // Staff message one person from the platform's people list: their private conversation opens in the column.
        if (data?.type === "quanta_wa_direct") {
            const target = data as { id?: unknown; name?: unknown };
            // The list knows people by account; the room's server, by their id in the room.
            if (typeof target.id === "string" && target.id && typeof target.name === "string")
                openDirectWithAccount(target.id, target.name.slice(0, 120));
            return;
        }
        if (data?.type !== "quanta_wa_side_panel") return;
        const parsed = layout.safeParse(data);
        if (parsed.success) {
            const { instant, ...rest } = parsed.data;
            sidePanelLayoutStore.update((current) => ({ ...rest, tabs: true, instant: current.instant }));
            if (instant) swapInPlace();
        }
        // What the platform asks for is applied first: answering with the state from before it would read as the
        // room closing the chat the platform just opened.
        if (typeof data.seq === "number" && Number.isFinite(data.seq)) seq = data.seq;
        const before = get(chatVisibilityStore);
        fromPlatformWord(() => {
            if (data.chat === true && !before) showChat();
            if (data.chat === false && before) chatVisibilityStore.set(false);
        });
        // Answered once the chat is on screen: the platform keeps People over the column until then.
        if (typeof data.seq === "number" && Number.isFinite(data.seq)) {
            const answer = drawn(data.seq);
            const cancel = afterPaint(() => {
                painting.delete(cancel);
                answer();
            });
            painting.add(cancel);
        }
        // The platform's listener may have missed the announcement at start: its first word gets an answer, with
        // the state after applying it.
        if (!answered) {
            answered = true;
            tell();
        }
    };
    let answered = false;
    // A dock gone (an error screen, a reconnect) before the frame is drawn must not answer for a chat no longer there.
    const painting = new Set<() => void>();
    const drawn = (word: number) => () => {
        const parentOrigin = platformOrigin();
        if (parentOrigin)
            window.parent.postMessage(
                { type: "quanta_wa_chat_drawn", seq: word, open: get(chatVisibilityStore) },
                parentOrigin,
            );
    };
    window.addEventListener("message", onMessage);

    return () => {
        for (const cancel of painting) cancel();
        painting.clear();
        unsubscribeChat();
        unsubscribeOrigin();
        unsubscribeRoomChat();
        stopVolumes();
        unsubscribeLayout();
        unsubscribePeople();
        unsubscribeRail();
        peopleOpenStore.set(false);
        unsubscribeWebsites();
        measuring?.();
        portrait.removeEventListener("change", reserve);
        window.removeEventListener("resize", onResize);
        window.removeEventListener("message", onMessage);
        root.style.removeProperty("--quanta-chat-map");
        root.style.removeProperty("--quanta-chat-below");
        root.style.removeProperty("--quanta-chat-website");
        root.style.removeProperty("--quanta-side-widens");
        root.style.removeProperty("--quanta-chat-slide");
        endSlide();
        sideColumnShownStore.set(0);
        root.removeAttribute("data-quanta-lifted");
        dockLiftStore.set(0);
        root.classList.remove("quanta-chat-cover");
        root.classList.remove("quanta-platform-panel");
    };
}
