// quanta: who has the room hidden, for the platform's people list. Staff only; a short look at another tab isn't reported.
import { AvailabilityStatus } from "@workadventure/messages";
import { get } from "svelte/store";
import { gameManager } from "../Phaser/Game/GameManager";
import { userIsAdminStore } from "../Stores/GameStore";

const CHECK_MS = 5000;
const AWAY_AFTER_MS = 30000;

export function startAwayBridge(): () => void {
    if (window.parent === window) return () => {};
    let since = new Map<string, number>();
    let last = "";
    const report = () => {
        const now = Date.now();
        const seen = new Map<string, number>();
        if (get(userIsAdminStore)) {
            try {
                for (const player of gameManager.getCurrentGameScene().MapPlayersByKey.values())
                    if (player.getAvailabilityStatus() === AvailabilityStatus.AWAY)
                        seen.set(player.userUuid, since.get(player.userUuid) ?? now);
            } catch {
                // Not in the room yet, or already out of it: nobody to report.
            }
        }
        since = seen;
        const away = [...seen]
            .filter(([, at]) => now - at >= AWAY_AFTER_MS)
            .map(([uuid, at]) => ({ uuid, since: at }));
        const key = JSON.stringify(away);
        if (key === last) return;
        last = key;
        window.parent.postMessage({ type: "quanta_wa_away", away }, "*");
    };
    const timer = setInterval(report, CHECK_MS);
    return () => clearInterval(timer);
}
