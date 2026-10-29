import { afterEach, expect, it, vi } from "vitest";
import { writable } from "svelte/store";
import type { RaisedHandSection } from "../Space/SpaceInterface";

vi.mock("../Stores/PeerStore", async () => {
    const { writable } = await import("svelte/store");
    return { raisedHandSectionsStore: writable([]) };
});
vi.mock("../Stores/GameStore", async () => {
    const { writable } = await import("svelte/store");
    return { userIsAdminStore: writable(false) };
});
vi.mock("../Stores/RaisedHandsAdminVisibleStore", () => ({
    sectionRights: (_section: unknown, admin: boolean) => ({ canModerate: admin }),
}));
import { raisedHandSectionsStore } from "../Stores/PeerStore";
import { userIsAdminStore } from "../Stores/GameStore";
import { startHandsBridge } from "./handsBridge";

afterEach(() => {
    vi.unstubAllGlobals();
    userIsAdminStore.set(false);
});

it("reports order, identity and self; gates lower-one and lower-all and cleans up", () => {
    const parent = { postMessage: vi.fn() };
    const events = new EventTarget();
    vi.stubGlobal("window", {
        parent,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
    });
    const lowerHand = vi.fn().mockResolvedValue(undefined);
    const sections = raisedHandSectionsStore as unknown as ReturnType<typeof writable<RaisedHandSection[]>>;
    sections.set([
        {
            space: { mySpaceUserId: "b", state: { lowerHand } },
            hands: [
                { spaceUserId: "b", name: "Same", at: 2 },
                { spaceUserId: "a", name: "Same", at: 1 },
            ],
            speakers: [],
            onAirHere: false,
        } as unknown as RaisedHandSection,
    ]);
    const stop = startHandsBridge();
    expect(parent.postMessage.mock.lastCall?.[0]).toMatchObject({
        hands: ["Same", "Same"],
        canLowerAll: false,
        queue: [
            { id: "a", self: false },
            { id: "b", self: true },
        ],
    });
    const send = (type: string, id?: string, source = parent) => {
        const event = new Event("message");
        Object.assign(event, { source, data: { type, id } });
        events.dispatchEvent(event);
    };
    send("quanta_wa_lower_hand", "a");
    send("quanta_wa_lower_all_hands");
    expect(lowerHand).not.toHaveBeenCalled();
    userIsAdminStore.set(true);
    expect(parent.postMessage.mock.lastCall?.[0].canLowerAll).toBe(true);
    send("quanta_wa_lower_hand", "a");
    expect(lowerHand.mock.calls).toEqual([["a"]]);
    lowerHand.mockClear();
    send("quanta_wa_lower_all_hands");
    expect(lowerHand.mock.calls).toEqual([["b"], ["a"]]);
    stop();
    lowerHand.mockClear();
    send("quanta_wa_lower_all_hands");
    expect(lowerHand).not.toHaveBeenCalled();
});

it("hides the room's own hands card only while the platform's people list is open", () => {
    const parent = { postMessage: vi.fn() };
    const events = new EventTarget();
    const classes = new Set<string>();
    vi.stubGlobal("window", {
        parent,
        addEventListener: events.addEventListener.bind(events),
        removeEventListener: events.removeEventListener.bind(events),
    });
    vi.stubGlobal("document", {
        documentElement: {
            classList: { toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)) },
        },
    });
    const stop = startHandsBridge();
    const send = (data: unknown, source: unknown = parent) => {
        const event = new Event("message");
        Object.assign(event, { source, data });
        events.dispatchEvent(event);
    };
    send({ type: "quanta_wa_people_panel", open: true }, {});
    expect(classes.has("quanta-people-open")).toBe(false);
    send({ type: "quanta_wa_people_panel", open: true });
    expect(classes.has("quanta-people-open")).toBe(true);
    send({ type: "quanta_wa_people_panel", open: "yes" });
    expect(classes.has("quanta-people-open")).toBe(false);
    stop();
});
