// quanta: Phaser draws some things over the map as HTML (players' names, speech bubbles) in its DOM layer, which
// quanta-ui.css's rounded window for the map canvas does not clip: a name near the map's edge showed on the
// backdrop. The layer gets the same window. Phaser scales the layer with the game's zoom (a CSS transform), so its
// clip, in the layer's own pixels, is the window divided by that scale, and follows it.
import type { Game } from "../Phaser/Game/Game";

const WINDOW = { top: 12, right: 12, bottom: 108, left: 12, radius: 16 };
// The dock is shorter on phones (QuantaDock.svelte, quanta-ui.css).
const PHONE_WINDOW = { top: 8, right: 8, bottom: 92, left: 8, radius: 14 };
const phone = window.matchMedia("(max-width: 480px)");

export function clipDomLayer(game: Game): () => void {
    let observer: MutationObserver | undefined;
    let applied = "";
    const apply = () => {
        const layer = game.domContainer;
        if (!layer) return;
        const scale = layer.offsetWidth ? layer.getBoundingClientRect().width / layer.offsetWidth : 1;
        if (!scale) return;
        const w = phone.matches ? PHONE_WINDOW : WINDOW;
        const px = (value: number) => `${(value / scale).toFixed(2)}px`;
        const clip = `inset(${px(w.top)} ${px(w.right)} ${px(w.bottom)} ${px(w.left)} round ${px(w.radius)})`;
        // Only on a change (the browser may write it back normalized): setting it is itself a style change the
        // observer below sees. Again if Phaser ever wipes the layer's style.
        if (clip === applied && layer.style.clipPath) return;
        applied = clip;
        layer.style.clipPath = clip;
    };
    const start = () => {
        if (!game.domContainer) return;
        apply();
        // Phaser rewrites the layer's size and transform on every resize and zoom.
        observer = new MutationObserver(apply);
        observer.observe(game.domContainer, { attributes: true, attributeFilter: ["style"] });
    };
    phone.addEventListener("change", apply);
    if (game.domContainer) start();
    else game.events.once("ready", start);
    return () => {
        observer?.disconnect();
        phone.removeEventListener("change", apply);
        game.events.off("ready", start);
    };
}
