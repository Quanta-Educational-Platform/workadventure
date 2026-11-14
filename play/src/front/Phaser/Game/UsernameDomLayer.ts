import type * as Phaser from "phaser";
import { DEPTH_INGAME_TEXT_INDEX } from "./DepthIndexes";
import type { GameScene } from "./GameScene";
import { QUANTA_UI } from "../../Enum/EnvironmentVariable";

// Side of the square probe used to measure the ancestor scale. Large enough that sub-pixel rounding
// on the measured on-screen size is negligible.
const SCALE_PROBE_SIZE = 100;

export class UsernameDomLayer {
    private readonly container: HTMLDivElement;
    private readonly domElement: Phaser.GameObjects.DOMElement;
    // A hidden, fixed-size element living in the same container as the usernames. Phaser scales this
    // container to follow the camera, so the probe's measured on-screen width divided by its layout
    // width gives the exact scale the DOM layer applies on screen (`ancestorScale`). We measure it
    // rather than derive it from zoomModifier/actualZoom because the real value depends on the camera
    // zoom AND devicePixelRatio in a way those numbers do not capture (see UsernameDisplay).
    private readonly scaleProbe: HTMLDivElement;
    private ancestorScale = 1;
    private ancestorScaleStale = true;

    constructor(scene: GameScene) {
        this.container = document.createElement("div");
        this.container.style.position = "relative";
        this.container.style.pointerEvents = "none";
        this.container.style.overflow = "visible";

        this.scaleProbe = document.createElement("div");
        this.scaleProbe.style.position = "absolute";
        this.scaleProbe.style.top = "0";
        this.scaleProbe.style.left = "0";
        this.scaleProbe.style.width = `${SCALE_PROBE_SIZE}px`;
        this.scaleProbe.style.height = `${SCALE_PROBE_SIZE}px`;
        this.scaleProbe.style.visibility = "hidden";
        this.scaleProbe.style.pointerEvents = "none";
        this.container.appendChild(this.scaleProbe);

        this.domElement = scene.add.dom(0, 0, this.container).setOrigin(0, 0).setDepth(DEPTH_INGAME_TEXT_INDEX);

        this.domElement.pointerEvents = "none";
        // quanta: two people side by side (someone came to them, a seat pair) would have their names drawn over each
        // other; the one further back steps up just clear of the nearer one, and back down once they part.
        if (QUANTA_UI) this.unstackTimer = setInterval(() => this.unstackNames(), 250);
    }

    private unstackTimer: ReturnType<typeof setInterval> | undefined;
    private readonly lifts = new WeakMap<HTMLElement, number>();

    private unstackNames(): void {
        const scale = this.getAncestorScale() || 1;
        const labels: { el: HTMLElement; left: number; right: number; top: number; bottom: number; lift: number }[] =
            [];
        for (const child of this.container.children) {
            if (!(child instanceof HTMLElement) || child === this.scaleProbe) continue;
            const r = child.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            // Where it would stand without its lift (screen pixels).
            const was = (this.lifts.get(child) ?? 0) * scale;
            labels.push({ el: child, left: r.left, right: r.right, top: r.top + was, bottom: r.bottom + was, lift: 0 });
        }
        if (labels.length < 2 && labels.every((l) => !this.lifts.get(l.el))) return;
        // Nearest (lowest on screen) first: it keeps its place. Two side by side (a seat pair) are level within a pixel
        // or two of rounding: the one already down stays down, or the two would swap places on every check.
        const liftOf = (el: HTMLElement) => this.lifts.get(el) ?? 0;
        labels.sort((a, b) =>
            Math.abs(a.bottom - b.bottom) < 3 ? liftOf(a.el) - liftOf(b.el) || a.left - b.left : b.bottom - a.bottom,
        );
        const placed: typeof labels = [];
        for (const label of labels) {
            for (let tries = 0; tries < 6; tries++) {
                const hit = placed.find(
                    (p) =>
                        label.left < p.right - 1 &&
                        label.right > p.left + 1 &&
                        label.top - label.lift < p.bottom - p.lift &&
                        label.bottom - label.lift > p.top - p.lift,
                );
                if (!hit) break;
                label.lift = label.bottom - (hit.top - hit.lift) + 1;
            }
            placed.push(label);
            const lift = Math.round(label.lift / scale);
            if ((this.lifts.get(label.el) ?? 0) !== lift) {
                this.lifts.set(label.el, lift);
                label.el.style.transition = "translate 0.15s ease-out";
                label.el.style.translate = lift ? `0 ${-lift}px` : "";
            }
        }
    }

    /**
     * Calls `listener` when the window is resized or its device pixel ratio changes (browser zoom, a move to a screen
     * of another density): the DOM layer's on-screen scale can change without the camera zoom changing.
     */
    public onDisplayChange(listener: () => void): () => void {
        let query: MediaQueryList | undefined;
        const changed = () => {
            this.invalidateAncestorScale();
            listener();
            watch();
        };
        const watch = () => {
            query?.removeEventListener("change", changed);
            query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
            query.addEventListener("change", changed, { once: true });
        };
        const resized = () => {
            this.invalidateAncestorScale();
            listener();
        };
        watch();
        window.addEventListener("resize", resized);
        return () => {
            query?.removeEventListener("change", changed);
            window.removeEventListener("resize", resized);
        };
    }

    public setVisible(visible: boolean): void {
        this.domElement.setVisible(visible);
    }

    public addUsername(usernameDisplayElement: HTMLDivElement): void {
        this.container.appendChild(usernameDisplayElement);
    }

    /**
     * Marks the measured ancestor scale as stale so it is re-measured on the next read. Call this
     * whenever the camera zoom or the display (resize, device pixel ratio change) may have changed.
     */
    public invalidateAncestorScale(): void {
        this.ancestorScaleStale = true;
    }

    /**
     * The scale the DOM layer currently applies to its children on screen, measured from the probe.
     * Measurement is lazy and cached: the (potentially layout-forcing) `getBoundingClientRect` runs
     * at most once per invalidation, shared by every username. Read it at render time, once Phaser
     * has applied the layer's transform for the current frame.
     */
    public getAncestorScale(): number {
        if (this.ancestorScaleStale) {
            const width = this.scaleProbe.getBoundingClientRect().width;
            // Guard against a 0 measurement (layer not laid out yet): keep the previous value and
            // stay stale so we re-measure later.
            if (width > 0) {
                this.ancestorScale = width / SCALE_PROBE_SIZE;
                this.ancestorScaleStale = false;
            }
        }
        return this.ancestorScale;
    }

    public destroy(): void {
        if (this.unstackTimer !== undefined) clearInterval(this.unstackTimer);
        this.domElement.destroy();
    }
}
