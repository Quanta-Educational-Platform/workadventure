import { afterEach, expect, it, vi } from "vitest";
import { get, type Writable } from "svelte/store";

vi.mock("./personVolumeStart", () => ({ startPersonVolumes: () => () => {} }));
vi.mock("../Stores/ChatStore", async () => {
    const { writable } = await import("svelte/store");
    return { chatVisibilityStore: writable(false) };
});
vi.mock("../Chat/Stores/ChatStore", () => ({ navChat: { switchToChat: vi.fn() } }));
vi.mock("../Chat/Stores/SelectRoomStore", async () => {
    const { writable } = await import("svelte/store");
    return { selectedRoomStore: writable(undefined) };
});
vi.mock("../Stores/ProximityNotificationStore", () => ({ chatNotificationStore: { clearRoom: vi.fn() } }));
vi.mock("../Stores/CoWebsiteStore", async () => {
    const { writable } = await import("svelte/store");
    return { coWebsites: writable([]) };
});
vi.mock("../Stores/MenuStore", () => ({
    menuVisiblilityStore: { set: vi.fn() },
    activeSubMenuStore: { activateByIndex: vi.fn() },
}));
const roomChat = vi.hoisted(() => ({
    id: "room-chat",
    isJoined: { subscribe: (run: (joined: boolean) => void) => (run(false), () => {}) },
    getCurrentSpace: () => undefined,
    hasUnreadMessages: { set: () => {} },
    unreadMessagesCount: { set: () => {} },
    unreadNotificationCount: { set: () => {} },
}));
vi.mock("../Phaser/Game/GameManager", () => ({
    gameManager: {
        getCurrentGameScene: () => ({
            room: { isChatEnabled: true },
            proximityChatRoomManager: {
                resolveTargetRoom: (space?: string) => (space ? roomChat : undefined),
                getDefaultRoom: () => undefined,
            },
        }),
    },
}));
vi.mock("../Enum/EnvironmentVariable", () => ({ QUANTA_URL: "https://quanta.test" }));
import { chatVisibilityStore } from "../Stores/ChatStore";
import { selectedRoomStore } from "../Chat/Stores/SelectRoomStore";
import { coWebsites as coWebsiteStore } from "../Stores/CoWebsiteStore";
import { showChat, showPeople, sidePanelLayoutStore, startSidePanel } from "./sidePanel";

afterEach(() => {
    vi.unstubAllGlobals();
    chatVisibilityStore.set(false);
});

it("follows the platform's column: opens and closes the chat, takes its layout, gives way to the people list", () => {
    const parent = { postMessage: vi.fn() };
    const events = new EventTarget();
    vi.stubGlobal("window", {
        parent,
        innerWidth: 1280,
        matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        dispatchEvent: events.dispatchEvent.bind(events),
    });
    const send = (data: Record<string, unknown>, origin = "https://quanta.test", source: unknown = parent) => {
        const event = new Event("message");
        Object.assign(event, { source, origin, data });
        events.dispatchEvent(event);
    };
    const stop = startSidePanel();
    expect(parent.postMessage.mock.lastCall).toEqual([
        { type: "quanta_wa_chat_panel", open: false, available: true, drawn: true, start: true },
        "https://quanta.test",
    ]);

    const column = { width: 300, margin: 12, radius: 16, cover: false };
    send({ type: "quanta_wa_side_panel", chat: true, ...column }, "https://evil.test");
    expect(get(chatVisibilityStore)).toBe(false);

    const before = parent.postMessage.mock.calls.length;
    send({ type: "quanta_wa_side_panel", chat: true, ...column });
    expect(get(chatVisibilityStore)).toBe(true);
    // The first word from the platform is answered with the state after applying it, never the one before.
    expect(parent.postMessage.mock.calls.slice(before).map(([message]) => message.open)).toEqual([true]);
    expect(get(sidePanelLayoutStore)).toEqual({ ...column, tabs: true });
    expect(parent.postMessage.mock.lastCall?.[0]).toEqual({
        type: "quanta_wa_chat_panel",
        open: true,
        available: true,
        drawn: true,
    });
    expect(document.documentElement.style.getPropertyValue("--quanta-chat-map")).toBe("312px");

    // Entering a zone selects its chat; the column keeps showing the room's.
    selectedRoomStore.set({ id: "zone-chat" } as never);
    expect(get(selectedRoomStore)).toBe(roomChat);
    const thread = { id: "thread", parentRoom: roomChat };
    selectedRoomStore.set(thread as never);
    expect(get(selectedRoomStore)).toBe(thread);

    send({ type: "quanta_wa_side_panel", chat: true, ...column, width: 5000 });
    expect(get(sidePanelLayoutStore).width).toBe(300);

    // Beside the page the open column widens the frame: the camera fits the room without that share.
    send({ type: "quanta_wa_side_panel", chat: true, ...column, widens: 208 });
    expect(document.documentElement.style.getPropertyValue("--quanta-side-widens")).toBe("208px");

    showPeople();
    expect(parent.postMessage.mock.lastCall).toEqual([{ type: "quanta_wa_show_people" }, "https://quanta.test"]);

    // The platform's people list takes the chat's place over the same space: the map keeps it free.
    const reports = parent.postMessage.mock.calls.length;
    send({ type: "quanta_wa_people_panel", open: true });
    expect(get(chatVisibilityStore)).toBe(false);
    expect(document.documentElement.style.getPropertyValue("--quanta-chat-map")).toBe("312px");
    // Closed at the platform's word: nothing goes back.
    expect(parent.postMessage.mock.calls.length).toBe(reports);
    send({ type: "quanta_wa_people_panel", open: false });
    expect(document.documentElement.style.getPropertyValue("--quanta-chat-map")).toBe("0px");
    expect(document.documentElement.style.getPropertyValue("--quanta-side-widens")).toBe("0px");

    stop();
    send({ type: "quanta_wa_side_panel", chat: true, ...column });
    expect(get(chatVisibilityStore)).toBe(false);
});

function embed() {
    const parent = { postMessage: vi.fn() };
    const events = new EventTarget();
    vi.stubGlobal("window", {
        parent,
        innerWidth: 1280,
        matchMedia: () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
        dispatchEvent: events.dispatchEvent.bind(events),
    });
    const send = (data: Record<string, unknown>) => {
        const event = new Event("message");
        Object.assign(event, { source: parent, origin: "https://quanta.test", data });
        events.dispatchEvent(event);
    };
    const reports = () =>
        parent.postMessage.mock.calls
            .map(([message]) => message as Record<string, unknown>)
            .filter((message) => message.type === "quanta_wa_chat_panel");
    return { parent, send, reports };
}

const column = { width: 300, margin: 12, radius: 16, cover: false };

it("reports only its own changes, with the platform's last word applied, and never answers one the platform asked for", () => {
    const { send, reports } = embed();
    const stop = startSidePanel();
    send({ type: "quanta_wa_side_panel", chat: false, seq: 1, ...column });
    expect(reports().at(-1)).toEqual({
        type: "quanta_wa_chat_panel",
        open: false,
        available: true,
        drawn: true,
        seq: 1,
    });
    const before = reports().length;
    send({ type: "quanta_wa_side_panel", chat: true, seq: 2, ...column });
    send({ type: "quanta_wa_side_panel", chat: false, seq: 3, ...column });
    expect(reports().length).toBe(before);
    // The dock's Chat button: the room's own change.
    showChat();
    expect(reports().at(-1)).toEqual({
        type: "quanta_wa_chat_panel",
        open: true,
        available: true,
        drawn: true,
        seq: 3,
    });
    stop();
});

it("closes the chat only as an older platform's people list opens, not each time it says so again with hands", () => {
    const { send, reports } = embed();
    const stop = startSidePanel();
    send({ type: "quanta_wa_side_panel", ...column });
    send({ type: "quanta_wa_people_panel", open: true });
    // The dock's Chat button over the open list; the platform, not yet caught up, repeats that People is open.
    showChat();
    expect(reports().at(-1)?.open).toBe(true);
    send({ type: "quanta_wa_people_panel", open: true });
    expect(get(chatVisibilityStore)).toBe(true);
    send({ type: "quanta_wa_people_panel", open: false });
    send({ type: "quanta_wa_people_panel", open: true });
    expect(get(chatVisibilityStore)).toBe(false);
    stop();
});

it("leaves the chat to a platform that numbers its words when its people list opens", () => {
    const { send } = embed();
    const stop = startSidePanel();
    send({ type: "quanta_wa_side_panel", chat: true, seq: 1, ...column });
    send({ type: "quanta_wa_people_panel", open: true });
    expect(get(chatVisibilityStore)).toBe(true);
    send({ type: "quanta_wa_side_panel", chat: false, seq: 2, ...column });
    expect(get(chatVisibilityStore)).toBe(false);
    stop();
});

it("settles with a platform that answers every report, when the dock's Chat button crosses the platform's People", () => {
    // The platform as deployed before numbering: it follows each report and tells the room the chat state back,
    // and says People is open again with every hands report. Both sides' words in flight are delivered at once.
    const { parent, send } = embed();
    const stop = startSidePanel();
    const page = { panel: null as "people" | "chat" | null, said: null as boolean | null };
    const outbox: Record<string, unknown>[] = [];
    const render = (panel: typeof page.panel) => {
        const people = page.panel === "people";
        page.panel = panel;
        if (people !== (panel === "people")) outbox.push({ type: "quanta_wa_people_panel", open: panel === "people" });
        const chat = panel === "chat";
        outbox.push({ type: "quanta_wa_side_panel", ...column, ...(page.said !== chat ? { chat } : {}) });
        page.said = chat;
    };
    render(null);
    let seen = parent.postMessage.mock.calls.length;
    const exchange = () => {
        const toRoom = outbox.splice(0);
        const toPage = parent.postMessage.mock.calls.slice(seen).map(([message]) => message as Record<string, unknown>);
        seen = parent.postMessage.mock.calls.length;
        for (const message of toRoom) send(message);
        for (const message of toPage) {
            if (message.type !== "quanta_wa_chat_panel") continue;
            if (message.open === true && page.panel !== "chat") render("chat");
            if (message.open === false && page.panel === "chat") render(null);
        }
        return toRoom.length + toPage.length;
    };
    let rounds = 0;
    while (exchange() > 0 && rounds < 30) rounds++;
    let toggles = 0;
    const unsubscribe = chatVisibilityStore.subscribe(() => toggles++);
    showChat();
    render("people");
    rounds = 0;
    while (exchange() > 0 && rounds < 30) rounds++;
    unsubscribe();
    expect(rounds).toBeLessThan(6);
    expect(toggles).toBeLessThanOrEqual(4);
    expect(get(chatVisibilityStore)).toBe(page.panel === "chat");
    stop();
});

it("swaps People and Chat in place only for the swap itself: the chat's next close slides again", async () => {
    vi.useFakeTimers();
    const { send } = embed();
    const stop = startSidePanel();
    send({ type: "quanta_wa_side_panel", chat: false, seq: 1, ...column });
    send({ type: "quanta_wa_people_panel", open: true });
    // People's Chat tab: the platform's word carries the swap.
    send({ type: "quanta_wa_side_panel", chat: true, seq: 2, ...column, instant: true });
    expect(get(chatVisibilityStore)).toBe(true);
    expect(get(sidePanelLayoutStore).instant).toBe(true);
    vi.advanceTimersByTime(0);
    expect(get(sidePanelLayoutStore).instant).toBe(false);
    // The platform repeating the layout it sent with the swap changes nothing later.
    send({ type: "quanta_wa_side_panel", ...column, instant: true });
    vi.advanceTimersByTime(0);
    expect(get(sidePanelLayoutStore).instant).toBe(false);
    // The dock's Chat button over People swaps too, once.
    chatVisibilityStore.set(false);
    showChat();
    expect(get(sidePanelLayoutStore).instant).toBe(true);
    vi.advanceTimersByTime(0);
    expect(get(sidePanelLayoutStore).instant).toBe(false);
    stop();
    vi.useRealTimers();
});

it("answers each numbered word once the frame after it is drawn", () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    const { parent, send } = embed();
    const drawn = () =>
        parent.postMessage.mock.calls
            .map(([message]) => message as Record<string, unknown>)
            .filter((message) => message.type === "quanta_wa_chat_drawn");
    const stop = startSidePanel();
    send({ type: "quanta_wa_side_panel", chat: true, seq: 4, ...column });
    send({ type: "quanta_wa_side_panel", ...column });
    expect(drawn()).toEqual([]);
    vi.advanceTimersByTime(0);
    expect(drawn()).toEqual([]);
    // One frame is not enough: the room's frame can reach the screen a frame after the page's.
    for (const frame of frames.splice(0)) frame(0);
    vi.advanceTimersByTime(0);
    expect(drawn()).toEqual([]);
    for (const frame of frames.splice(0)) frame(0);
    vi.advanceTimersByTime(0);
    expect(drawn()).toEqual([{ type: "quanta_wa_chat_drawn", seq: 4, open: true }]);
    // The dock gone before the next frame (an error screen): no answer for a chat no longer there.
    send({ type: "quanta_wa_side_panel", chat: false, seq: 5, ...column });
    stop();
    for (const frame of frames.splice(0)) frame(0);
    for (const frame of frames.splice(0)) frame(0);
    vi.advanceTimersByTime(0);
    expect(drawn()).toHaveLength(1);
    vi.useRealTimers();
});

it("asks the platform to close the column when a board opens beside it too narrow to use", () => {
    vi.useFakeTimers();
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    const { parent, send } = embed();
    const hides = () =>
        parent.postMessage.mock.calls.filter(([message]) => message.type === "quanta_wa_hide_side_panel").length;
    const website = document.createElement("div");
    const container = document.createElement("div");
    container.id = "cowebsites-container";
    container.append(website);
    document.body.append(container);
    let width = 130;
    website.getBoundingClientRect = () => ({ width }) as DOMRect;
    const painted = () => {
        for (let i = 0; i < 2; i++) for (const frame of frames.splice(0)) frame(0);
        vi.advanceTimersByTime(0);
    };
    // Mocked as a plain writable above.
    const coWebsites = coWebsiteStore as unknown as Writable<unknown[]>;
    const stop = startSidePanel();
    send({ type: "quanta_wa_side_panel", ...column });
    send({ type: "quanta_wa_people_panel", open: true });

    coWebsites.set([{ id: "board" }]);
    painted();
    expect(hides()).toBe(1);

    // Wide enough, or no column open: it stays.
    coWebsites.set([]);
    width = 600;
    coWebsites.set([{ id: "board" }]);
    painted();
    expect(hides()).toBe(1);
    coWebsites.set([]);
    send({ type: "quanta_wa_people_panel", open: false });
    width = 130;
    coWebsites.set([{ id: "board" }]);
    painted();
    expect(hides()).toBe(1);

    stop();
    coWebsites.set([]);
    container.remove();
    vi.useRealTimers();
});
