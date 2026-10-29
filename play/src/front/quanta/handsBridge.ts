import { derived, get } from "svelte/store";
import { raisedHandSectionsStore } from "../Stores/PeerStore";
import { userIsAdminStore } from "../Stores/GameStore";
import { sectionRights } from "../Stores/RaisedHandsAdminVisibleStore";

export function startHandsBridge(): () => void {
    if (window.parent === window) return () => {};

    let last = "";
    const unsubscribe = derived([raisedHandSectionsStore, userIsAdminStore], ([sections, isAdmin]) => ({
        sections,
        isAdmin,
    })).subscribe(({ sections, isAdmin }) => {
        // One entry per person (a hand raised in two spaces at once), ordered by when it first went up.
        const raised = new Map<string, { id: string; name: string; at: number; self: boolean }>();
        for (const section of sections) {
            for (const hand of section.hands) {
                const seen = raised.get(hand.spaceUserId);
                if (!seen || hand.at < seen.at)
                    raised.set(hand.spaceUserId, {
                        id: hand.spaceUserId,
                        name: hand.name,
                        at: hand.at,
                        self: hand.spaceUserId === section.space.mySpaceUserId,
                    });
            }
        }
        const queue = [...raised.values()].sort((a, b) => a.at - b.at);
        const hands = queue.map((hand) => hand.name);
        const canLowerAll = sections.some(
            (section) => section.hands.length > 0 && sectionRights(section, isAdmin).canModerate,
        );
        const message = { type: "quanta_wa_hands", hands, queue, canLowerAll };
        const key = JSON.stringify(message);
        if (key === last) return;
        last = key;
        window.parent.postMessage(message, "*");
    });

    const onMessage = (event: MessageEvent) => {
        if (event.source !== window.parent) return;
        const type = (event.data as { type?: unknown } | null)?.type;
        // The platform asks again once the frame has loaded (it clears its list then): answer even if unchanged.
        if (type === "quanta_wa_hands_request") {
            if (last) window.parent.postMessage(JSON.parse(last), "*");
            return;
        }
        // The platform's people list shows the same queue: its own card over the map would repeat it while open.
        if (type === "quanta_wa_people_panel") {
            document.documentElement.classList.toggle(
                "quanta-people-open",
                (event.data as { open?: unknown }).open === true,
            );
            return;
        }
        if (type !== "quanta_wa_lower_all_hands" && type !== "quanta_wa_lower_hand") return;
        const target = (event.data as { id?: unknown }).id;
        const isAdmin = get(userIsAdminStore);
        for (const section of get(raisedHandSectionsStore)) {
            if (!sectionRights(section, isAdmin).canModerate) continue;
            for (const hand of section.hands) {
                if (type === "quanta_wa_lower_hand" && hand.spaceUserId !== target) continue;
                section.space.state.lowerHand(hand.spaceUserId).catch((error) => console.error(error));
            }
        }
    };
    window.addEventListener("message", onMessage);

    return () => {
        unsubscribe();
        window.removeEventListener("message", onMessage);
    };
}
