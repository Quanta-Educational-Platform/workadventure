// quanta: the raised hands, in the order they went up, for the participants list of the platform around the room;
// and "Lower all hands" from there. Only inside the platform's frame, and lowering only where the local user may
// (the back checks it too, RaiseHandManager.assertCanModerate).
import { get } from "svelte/store";
import { raisedHandSectionsStore } from "../Stores/PeerStore";
import { userIsAdminStore } from "../Stores/GameStore";
import { sectionRights } from "../Stores/RaisedHandsAdminVisibleStore";

export function startHandsBridge(): () => void {
    if (window.parent === window) return () => {};

    let last = "";
    const unsubscribe = raisedHandSectionsStore.subscribe((sections) => {
        const isAdmin = get(userIsAdminStore);
        // One entry per person (a hand raised in two spaces at once), ordered by when it first went up.
        const raised = new Map<string, { name: string; at: number }>();
        for (const section of sections) {
            for (const hand of section.hands) {
                const seen = raised.get(hand.spaceUserId);
                if (!seen || hand.at < seen.at) raised.set(hand.spaceUserId, { name: hand.name, at: hand.at });
            }
        }
        const hands = [...raised.values()].sort((a, b) => a.at - b.at).map((hand) => hand.name);
        const canLowerAll = sections.some(
            (section) => section.hands.length > 0 && sectionRights(section, isAdmin).canModerate,
        );
        const message = { type: "quanta_wa_hands", hands, canLowerAll };
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
        if (type !== "quanta_wa_lower_all_hands") return;
        const isAdmin = get(userIsAdminStore);
        for (const section of get(raisedHandSectionsStore)) {
            if (!sectionRights(section, isAdmin).canModerate) continue;
            for (const hand of section.hands) {
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
