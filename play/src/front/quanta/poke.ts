// quanta: a teacher's nudge from the person menu (moderationBridge.pokePerson), as the room's server delivers it to this
// student alone: a toast that names the teacher and what they ask, and a sound.
import { z } from "zod";
import { get } from "svelte/store";
import { LONG_NOTIFICATION_MS, notificationPlayingStore } from "../Stores/NotificationStore";
import { gameManager } from "../Phaser/Game/GameManager";
import { POKE_PRESETS, type PokePreset } from "./moderationBridge";
import { fullNamesStore, shownName } from "./fullNames";
import { QL, type QLStrings } from "./i18n";

const pokeUpdate = z.object({
    quanta: z.literal(1),
    poke: z.object({ from: z.string(), name: z.string().max(64), preset: z.enum(POKE_PRESETS) }),
});

export function pokeText(strings: QLStrings, preset: PokePreset): string {
    switch (preset) {
        case "answer":
            return strings.pokeAnswer();
        case "microphone":
            return strings.pokeMicrophone();
        case "camera":
            return strings.pokeCamera();
        default:
            return strings.pokeAttention();
    }
}

/** True when the update was a poke, shown here. */
export function receivePoke(update: unknown): boolean {
    const parsed = pokeUpdate.safeParse(update);
    if (!parsed.success) return false;
    const { from, name, preset } = parsed.data.poke;
    const strings = get(QL);
    const teacher = shownName(get(fullNamesStore), from, name);
    notificationPlayingStore.playNotification(
        pokeText(strings, preset),
        preset === "microphone"
            ? "quanta-mic"
            : preset === "camera"
              ? "quanta-camera"
              : preset === "answer"
                ? "megaphone"
                : "quanta-attention",
        `quanta-poke-${from}`,
        LONG_NOTIFICATION_MS,
        { lead: teacher, tone: "action" },
    );
    try {
        gameManager.getCurrentGameScene().playSound("new-message", 0.5);
    } catch {
        /* No scene: nothing to play the sound in. */
    }
    return true;
}
