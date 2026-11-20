// quanta: a woka's layers composited once into one sprite sheet per look, so the room draws one sprite and holds one
// texture per look instead of one per layer. A look is shared by every woka wearing it, counted, and freed a while
// after the last one goes. It is baked at the density the room is drawn at: the layers' 64 x 64 frames at a drawn zoom
// of 2 or more, their 2 x 2 average (32 x 32) at zoom 1, where filtering would average them anyway; a look whose sheet
// is the same at both (WA's 3 x 4, 1x layers only) is one texture at both. A few looks are decoded at a time, sharing
// layer bitmaps, and composed within a per-frame budget. Pictures of a woka (people list, chat, own avatar) are drawn
// from the same layer files on a canvas, without the GPU.
import * as Phaser from "phaser";
import { asError } from "catch-unknown";
import { WOKA_BAKE } from "../../Enum/EnvironmentVariable";
import type { BakedSheetData } from "../Player/WokaSheet";
import { forgetWokaTexture, frameSizeOf, setFilterInPlace, wokaAnimationKeys } from "../Player/WokaSheet";
import type { WokaTextureDescriptionInterface } from "./PlayerTextures";

import WebGLRenderer = Phaser.Renderer.WebGL.WebGLRenderer;

export type WokaBakeMode = "auto" | "2x" | "1x" | "off";
type Scale = 1 | 2;
type LayerImage = ImageBitmap | HTMLImageElement;
type LayerFile = { blob: Blob; width: number; height: number };
/** What a look's files say before any is decoded: its grid, its layers' densest frame, its sheet's size at that. */
type Plan = { grid: "new" | "old"; native: number; width: number; height: number };
type Composed = { sheet: HTMLCanvasElement; frameSize: number; seated: number; picture: HTMLCanvasElement };
type Decoded = { url: string; image: Promise<LayerImage>; refs: number; bytes: number };
type FrameJob = { megapixels: number; run: () => void };

const MODES: readonly string[] = ["auto", "2x", "1x", "off"];
const MODE_STORAGE_KEY = "quanta.wokaBake";
const COLUMNS = 8;
const ROWS = 9;
const SEATED_ROW = 8;
// Narrower sheets are WA's own 3 x 4 of 32 x 32.
const NEW_SHEET_WIDTH = COLUMNS * 32;
const OLD_FRAME = 32;
const NEAREST = 1;
// A look nobody shows is kept this long: people walking out of view and back, a scene restart or reconnect.
const LINGER_MS = 30_000;
// A look at a density the room left is kept only through a quick zoom back.
const STALE_LINGER_MS = 3000;
// Looks nobody shows are let go sooner, oldest first, past this much texture memory.
const LINGER_BYTES = 32 * 1048576;
// The drawn zoom must hold this long before the looks are baked again at the other density.
const RESCALE_DELAY_MS = 1000;
// Main-thread time a frame may spend composing and uploading looks.
const BUDGET_MS = 8;
// Looks decoded at once: each holds its layers' full-size bitmaps until it is composed.
const BAKES_IN_FLIGHT = 3;
// Decoded layers kept for the looks still waiting (they share bodies, eyes, clothes), let go when the queue empties.
const IDLE_DECODED_BYTES = 16 * 1048576;
const PICTURES_IN_FLIGHT = 4;
const PICTURES_KEPT = 300;
const PLANS_KEPT = 1000;
// Composing cost assumed until this browser's is measured.
const START_MS_PER_MEGAPIXEL = 4;
const DEFAULT_LAYERS: WokaTextureDescriptionInterface[] = [
    { id: "color_22", url: "resources/customisation/character_color/character_color21.png" },
    { id: "eyes_23", url: "resources/customisation/character_eyes/character_eyes23.png" },
];

export type WokaBakerStats = {
    mode: WokaBakeMode;
    scale: Scale;
    drawnZoom: number | undefined;
    looks: number;
    lingering: number;
    wokas: number;
    wokaTextureMB: number;
    lingeringMB: number;
    decodedLayers: number;
    decodedMB: number;
    bakesRunning: number;
    bakesWaiting: number;
    framesQueued: number;
    msPerMegapixel: number;
    bakes: number;
    rebakes: number;
    skipped: number;
    failures: number;
    refusedLooks: number;
    layersCached: number;
    picturesCached: number;
    allTextures: number;
};

declare global {
    interface Window {
        __quantaWokas?: () => WokaBakerStats;
    }
}

/** A look that can never be baked (old and new grids mixed): drawn by layers at once, for everyone wearing it. */
class BakeRefused extends Error {}

/** Everybody let go of the look before it was baked. */
class NotWanted extends Error {
    constructor() {
        super("woka baker: look no longer wanted");
    }
}

function isMode(value: unknown): value is WokaBakeMode {
    return typeof value === "string" && MODES.includes(value);
}

/** WOKA_BAKE, unless this browser picked its own for a check: ?wokaBake=off|1x|2x|auto, kept until ?wokaBake=default. */
function readMode(): WokaBakeMode {
    try {
        const asked = new URLSearchParams(window.location.search).get("wokaBake");
        if (asked === "default") localStorage.removeItem(MODE_STORAGE_KEY);
        else if (isMode(asked)) localStorage.setItem(MODE_STORAGE_KEY, asked);
        const kept = localStorage.getItem(MODE_STORAGE_KEY);
        if (isMode(kept)) return kept;
    } catch {
        // Storage blocked: the server's switch.
    }
    return isMode(WOKA_BAKE) ? WOKA_BAKE : "auto";
}

function idsOf(layers: WokaTextureDescriptionInterface[]): string {
    return layers.map((layer) => layer.id).join("+");
}

/** The frame size a look's sheet has at a density: what its texture is keyed by. */
function frameFor(plan: Plan, scale: Scale): number {
    return scale === 2 ? plan.native : OLD_FRAME;
}

function megabytes(bytes: number): number {
    return Math.round((bytes / 1048576) * 100) / 100;
}

/** A layer's own frame size from its width: 64 on a 2x sheet, 32 on every other (ours at 1x, WA's 3 x 4). */
function layerFrameOf(width: number): number {
    return width >= NEW_SHEET_WIDTH ? frameSizeOf(width) : OLD_FRAME;
}

function imageOf(blob: Blob): Promise<HTMLImageElement> {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.src = url;
    return image
        .decode()
        .then(() => image)
        .finally(() => URL.revokeObjectURL(url));
}

function decodeImage(blob: Blob): Promise<LayerImage> {
    return typeof createImageBitmap === "function" ? createImageBitmap(blob) : imageOf(blob);
}

function closeImage(image: LayerImage): void {
    if ("close" in image) image.close();
}

/** A PNG's size from its header; any other file is decoded once for it. */
async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
    const head = new DataView(await blob.slice(0, 24).arrayBuffer());
    // The signature, then the IHDR chunk, which starts with the width and height.
    if (head.byteLength >= 24 && head.getUint32(0) === 0x89504e47 && head.getUint32(12) === 0x49484452) {
        return { width: head.getUint32(16), height: head.getUint32(20) };
    }
    const image = await decodeImage(blob);
    try {
        return { width: image.width, height: image.height };
    } finally {
        closeImage(image);
    }
}

const layerFiles = new Map<string, Promise<LayerFile>>();

/** A layer's file, fetched once: looks baked again (zoom, lost context) and pictures read it from memory. */
function layerFile(url: string): Promise<LayerFile> {
    let file = layerFiles.get(url);
    if (!file) {
        file = fetch(url)
            .then((response) => {
                if (!response.ok) throw new Error(`woka layer ${url}: HTTP ${response.status}`);
                return response.blob();
            })
            .then(async (blob) => ({ blob, ...(await imageSize(blob)) }));
        layerFiles.set(url, file);
        file.catch(() => layerFiles.delete(url));
    }
    return file;
}

function planFor(files: LayerFile[]): Plan {
    const first = files[0];
    if (!first) throw new BakeRefused("woka look without layers");
    if (files.every((file) => file.width >= NEW_SHEET_WIDTH)) {
        const native = Math.max(...files.map((file) => layerFrameOf(file.width)));
        return { grid: "new", native, width: COLUMNS * native, height: ROWS * native };
    }
    const sameOldGrid = files.every(
        (file) => file.width < NEW_SHEET_WIDTH && file.width === first.width && file.height === first.height,
    );
    if (!sameOldGrid) throw new BakeRefused("woka baker: old and new sheets in one look");
    return { grid: "old", native: OLD_FRAME, width: first.width, height: first.height };
}

function context2d(canvas: HTMLCanvasElement, willReadFrequently = false): CanvasRenderingContext2D {
    const context = canvas.getContext("2d", { willReadFrequently });
    if (!context) throw new Error("woka baker: no 2d canvas");
    return context;
}

/**
 * A canvas's pixels are let go once uploaded (a lost context bakes the look again). The texture's source is then a
 * 1 x 1 canvas: nothing may upload it again or read pixels from it (Phaser's setFilter, setFlipY, source.update,
 * getBase64, getPixel); filters are set with setFilterInPlace.
 */
function freeCanvas(canvas: HTMLCanvasElement): void {
    canvas.width = 1;
    canvas.height = 1;
}

/**
 * Each 2 x 2 block's average, its colours weighted by alpha as filtering weighs premultiplied colour. Done here, not by
 * the canvas, so the 1x sheet is the same in every browser (their downscalers differ).
 */
function halveInto(source: ImageData, target: ImageData): void {
    const from = source.data;
    const to = target.data;
    const row = source.width * 4;
    for (let y = 0; y < target.height; y++) {
        for (let x = 0; x < target.width; x++) {
            const a = (y * 2 * source.width + x * 2) * 4;
            const b = a + 4;
            const c = a + row;
            const d = c + 4;
            const alpha = from[a + 3] + from[b + 3] + from[c + 3] + from[d + 3];
            if (alpha === 0) continue;
            const o = (y * target.width + x) * 4;
            for (let channel = 0; channel < 3; channel++) {
                to[o + channel] =
                    (from[a + channel] * from[a + 3] +
                        from[b + channel] * from[b + 3] +
                        from[c + channel] * from[c + 3] +
                        from[d + channel] * from[d + 3]) /
                    alpha;
            }
            to[o + 3] = alpha / 4;
        }
    }
}

/**
 * The look's sheet: every layer drawn over the one before at the densest layer's size (a 1x layer among 2x ones
 * doubled, texel for texel, as the room draws it), then halved for a 1x bake. Also which seated frames the bottom layer
 * has (Character reads them from it) and the front still for its picture.
 */
function compose(images: LayerImage[], plan: Plan, frameSize: number, scratch: HTMLCanvasElement): Composed {
    const { native, width, height } = plan;
    const halve = frameSize !== native;
    if (halve && native !== frameSize * 2) throw new Error(`woka baker: ${native} to ${frameSize} frames`);
    // Kept at the layers' density, the look is drawn straight onto its sheet; halved, through the scratch canvas.
    const canvas = halve ? scratch : document.createElement("canvas");
    // Setting the size clears the canvas and its context's settings, even when it is unchanged.
    canvas.width = width;
    canvas.height = height;
    const context = context2d(canvas, true);
    context.imageSmoothingEnabled = false;
    let seated = 0;
    images.forEach((image, index) => {
        const k = native / layerFrameOf(image.width);
        context.drawImage(image, 0, 0, image.width * k, image.height * k);
        if (index === 0 && plan.grid === "new") {
            const alpha = context.getImageData(0, SEATED_ROW * native, width, native).data;
            for (let i = 3; i < alpha.length; i += 4)
                if (alpha[i] > 0) seated |= 1 << Math.floor(((i >> 2) % width) / native);
        }
    });

    const picture = document.createElement("canvas");
    picture.width = native;
    picture.height = native;
    context2d(picture).drawImage(canvas, native, 0, native, native, 0, 0, native, native);
    if (!halve) return { sheet: canvas, frameSize, seated, picture };

    const sheet = document.createElement("canvas");
    sheet.width = width / 2;
    sheet.height = height / 2;
    const out = context2d(sheet);
    const halved = out.createImageData(sheet.width, sheet.height);
    halveInto(context.getImageData(0, 0, width, height), halved);
    out.putImageData(halved, 0, 0);
    return { sheet, frameSize, seated, picture };
}

/** Only a layer's front still, decoded from its file: a bitmap of that frame, or the whole image where unsupported. */
async function decodeFrame(blob: Blob, frame: number): Promise<{ image: LayerImage; sx: number }> {
    if (typeof createImageBitmap === "function") {
        return { image: await createImageBitmap(blob, frame, 0, frame, frame), sx: 0 };
    }
    return { image: await imageOf(blob), sx: frame };
}

/** The front still of every layer, at the densest layer's size: what a woka picture shows. */
async function drawPicture(layers: WokaTextureDescriptionInterface[]): Promise<string> {
    if (layers.length === 0) throw new Error("woka picture without layers");
    const files = await Promise.all(layers.map((layer) => layerFile(layer.url)));
    const size = Math.max(...files.map((file) => layerFrameOf(file.width)));
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = context2d(canvas);
    context.imageSmoothingEnabled = false;
    // One at a time: a single frame is held decoded.
    for (const file of files) {
        const frame = layerFrameOf(file.width);
        const { image, sx } = await decodeFrame(file.blob, frame);
        try {
            context.drawImage(image, sx, 0, frame, frame, 0, 0, size, size);
        } finally {
            closeImage(image);
        }
    }
    return canvas.toDataURL("image/png");
}

/**
 * Phaser's TextureSource gives a new texture its filter by uploading it a second time when the game is not
 * antialiased. The renderer reads its own copy of the setting, so the texture is still created nearest, uploaded once.
 */
function withoutRefilter<T>(game: Phaser.Game, make: () => T): T {
    const config: { antialias: boolean } = game.config;
    const antialias = config.antialias;
    config.antialias = true;
    try {
        return make();
    } finally {
        config.antialias = antialias;
    }
}

/** At most `size` tasks at once, the rest in order of arrival. */
class Slots {
    private running = 0;
    private readonly queue: (() => void)[] = [];

    constructor(
        private readonly size: number,
        private readonly onIdle?: () => void,
    ) {}

    get active(): number {
        return this.running;
    }

    get waiting(): number {
        return this.queue.length;
    }

    async run<T>(task: () => Promise<T>): Promise<T> {
        if (this.running < this.size) this.running++;
        else await new Promise<void>((resolve) => this.queue.push(resolve));
        try {
            return await task();
        } finally {
            // The slot passes straight to the next task.
            const next = this.queue.shift();
            if (next) next();
            else if (--this.running === 0) this.onIdle?.();
        }
    }
}

export interface WokaLeaseHolder {
    /**
     * Shows `to` (the same look at the room's new density) in place of `from`. False when it would not (nothing was
     * touched, `to` is let go); true when it shows `to` and holds it from then on (`from` is let go).
     */
    swapWokaLease(from: WokaLease, to: WokaLease): boolean;
}

export class BakedLook {
    refs = 0;
    state: "baking" | "ready" | "failed" = "baking";
    ready: Promise<void> = Promise.resolve();
    texture: Phaser.Textures.Texture | undefined;
    bytes = 0;
    picture: HTMLCanvasElement | undefined;
    pictureUrl: string | undefined;
    linger: ReturnType<typeof setTimeout> | undefined;

    constructor(
        readonly key: string,
        readonly ids: string,
        readonly layers: WokaTextureDescriptionInterface[],
        readonly plan: Plan,
        readonly frameSize: number,
    ) {}
}

/** One woka's hold on a baked look; which look it is is known once the look's files are read. */
export class WokaLease {
    holder: WokaLeaseHolder | undefined;
    look: BakedLook | undefined;
    released = false;
    moving = false;
    ready: Promise<void> = Promise.resolve();

    constructor(private readonly baker: WokaBaker) {}

    get key(): string {
        return this.look?.key ?? "";
    }

    whenReady(): Promise<string> {
        return this.ready.then(() => this.key);
    }

    adopt(holder: WokaLeaseHolder): void {
        this.holder = holder;
        this.baker.adopted(this);
    }

    /** The look's front still as a PNG data URL. */
    picture(): string | undefined {
        return this.look ? this.baker.pictureOf(this.look) : undefined;
    }

    release(): void {
        if (this.released) return;
        this.released = true;
        this.baker.unref(this);
    }

    /** Let go when no woka took it over (its woka was destroyed before the look was ready). */
    dropIfUnadopted(): void {
        if (!this.holder) this.release();
    }
}

export class WokaBaker {
    readonly mode = readMode();
    private game: Phaser.Game | undefined;
    private renderer: WebGLRenderer | undefined;
    private redraw: (() => void) | undefined;
    private readonly looks = new Map<string, BakedLook>();
    private readonly leases = new Set<WokaLease>();
    // Ready looks nobody shows, oldest first.
    private readonly lingering = new Set<BakedLook>();
    private readonly plans = new Map<string, Promise<Plan>>();
    private readonly pictures = new Map<string, Promise<string>>();
    private readonly decoded = new Map<string, Decoded>();
    private readonly idleDecoded = new Set<Decoded>();
    private idleDecodedBytes = 0;
    private readonly bakeSlots = new Slots(BAKES_IN_FLIGHT, () => this.onBakesDone());
    private readonly pictureSlots = new Slots(PICTURES_IN_FLIGHT);
    private readonly frameJobs: FrameJob[] = [];
    private frameRequested = false;
    private msPerMegapixel = START_MS_PER_MEGAPIXEL;
    // Until the room reports its zoom: today's density.
    private scale: Scale = this.mode === "1x" ? 1 : 2;
    private drawnZoom: number | undefined;
    private rescaleTimer: ReturnType<typeof setTimeout> | undefined;
    private scratch: HTMLCanvasElement | undefined;
    private bakes = 0;
    private rebakes = 0;
    private skipped = 0;
    private failures = 0;
    private refusedLooks = 0;

    /**
     * Holds the look `layers` make, baked at the room's density, or undefined where it is drawn by layers (switched off,
     * or a renderer without WebGL, which draws from the very image a bake lets go of).
     */
    lease(game: Phaser.Game, layers: WokaTextureDescriptionInterface[], redraw: () => void): WokaLease | undefined {
        if (this.mode === "off" || layers.length === 0) return undefined;
        const renderer = game.renderer;
        if (!(renderer instanceof WebGLRenderer)) return undefined;
        this.attach(game, renderer);
        this.redraw = redraw;
        return this.leaseOf(layers);
    }

    /** The settled zoom the room is drawn at (not during zoom animations). */
    setDrawnZoom(zoom: number): void {
        this.drawnZoom = zoom;
        if (this.mode !== "auto") return;
        const target: Scale = zoom >= 2 ? 2 : 1;
        if (target === this.scale) {
            clearTimeout(this.rescaleTimer);
            this.rescaleTimer = undefined;
            return;
        }
        if (this.leases.size === 0) {
            this.rescale(target);
            return;
        }
        clearTimeout(this.rescaleTimer);
        this.rescaleTimer = setTimeout(() => {
            this.rescaleTimer = undefined;
            this.rescale(target);
        }, RESCALE_DELAY_MS);
    }

    /** A picture of a woka for the interface, drawn on a canvas from its layers' files: no GPU texture. */
    picture(layers: WokaTextureDescriptionInterface[]): Promise<string> {
        const ids = idsOf(layers);
        const known = this.pictures.get(ids);
        if (known) {
            // Most recently used last: the oldest are let go first.
            this.remember(ids, known);
            return known;
        }
        for (const look of this.looks.values()) {
            if (look.ids !== ids) continue;
            const baked = this.pictureOf(look);
            if (baked) return Promise.resolve(baked);
        }
        const picture = this.pictureSlots.run(() => drawPicture(layers));
        this.remember(ids, picture);
        picture.catch(() => {
            if (this.pictures.get(ids) === picture) this.pictures.delete(ids);
        });
        return picture;
    }

    pictureOf(look: BakedLook): string | undefined {
        if (look.pictureUrl || !look.picture) return look.pictureUrl;
        look.pictureUrl = look.picture.toDataURL("image/png");
        look.picture = undefined;
        this.remember(look.ids, Promise.resolve(look.pictureUrl));
        return look.pictureUrl;
    }

    stats(): WokaBakerStats {
        let bytes = 0;
        for (const look of this.looks.values()) bytes += look.bytes;
        let lingeringBytes = 0;
        for (const look of this.lingering) lingeringBytes += look.bytes;
        let decodedBytes = 0;
        for (const entry of this.decoded.values()) decodedBytes += entry.bytes;
        return {
            mode: this.mode,
            scale: this.scale,
            drawnZoom: this.drawnZoom,
            looks: this.looks.size,
            lingering: this.lingering.size,
            wokas: [...this.leases].filter((lease) => lease.holder).length,
            wokaTextureMB: megabytes(bytes),
            lingeringMB: megabytes(lingeringBytes),
            decodedLayers: this.decoded.size,
            decodedMB: megabytes(decodedBytes),
            bakesRunning: this.bakeSlots.active,
            bakesWaiting: this.bakeSlots.waiting,
            framesQueued: this.frameJobs.length,
            msPerMegapixel: Math.round(this.msPerMegapixel * 100) / 100,
            bakes: this.bakes,
            rebakes: this.rebakes,
            skipped: this.skipped,
            failures: this.failures,
            refusedLooks: this.refusedLooks,
            layersCached: layerFiles.size,
            picturesCached: this.pictures.size,
            allTextures: this.game?.textures.getTextureKeys().length ?? 0,
        };
    }

    adopted(lease: WokaLease): void {
        // Baked before the room's density changed: moved now, as the others were.
        if (!this.rescaleTimer) this.moveIfStale(lease);
    }

    unref(lease: WokaLease): void {
        this.leases.delete(lease);
        const look = lease.look;
        if (!look) return;
        look.refs--;
        if (look.refs <= 0 && look.state === "ready" && this.looks.get(look.key) === look) this.linger(look);
    }

    private attach(game: Phaser.Game, renderer: WebGLRenderer): void {
        if (this.game === game) return;
        this.detach();
        this.game = game;
        this.renderer = renderer;
        renderer.on(Phaser.Renderer.Events.RESTORE_WEBGL, this.onContextRestored);
        game.events.once(Phaser.Core.Events.DESTROY, this.detach);
        document.addEventListener("visibilitychange", this.onVisibilityChange);
    }

    private readonly detach = (): void => {
        this.renderer?.off(Phaser.Renderer.Events.RESTORE_WEBGL, this.onContextRestored);
        this.game?.events.off(Phaser.Core.Events.DESTROY, this.detach);
        document.removeEventListener("visibilitychange", this.onVisibilityChange);
        this.game = undefined;
        this.renderer = undefined;
        clearTimeout(this.rescaleTimer);
        this.rescaleTimer = undefined;
        for (const look of this.looks.values()) clearTimeout(look.linger);
        // Work already queued finds its look gone and stops.
        this.looks.clear();
        this.lingering.clear();
        this.leases.clear();
    };

    /** A hold on the look `layers` make at the room's density: known once its files are read, at once after that. */
    private leaseOf(layers: WokaTextureDescriptionInterface[]): WokaLease {
        const lease = new WokaLease(this);
        this.leases.add(lease);
        lease.ready = this.planOf(layers).then((plan) => {
            if (lease.released) throw new NotWanted();
            const look = this.hold(layers, plan, frameFor(plan, this.scale));
            lease.look = look;
            return look.ready;
        });
        // Read by whoever holds the lease; this only keeps a failure from being reported as unhandled.
        lease.ready.catch(() => {});
        return lease;
    }

    /** Read from the layers' file headers, nothing decoded. A look that cannot be baked stays refused. */
    private planOf(layers: WokaTextureDescriptionInterface[]): Promise<Plan> {
        const ids = idsOf(layers);
        const known = this.plans.get(ids);
        if (known) return known;
        const plan = Promise.all(layers.map((layer) => layerFile(layer.url))).then(planFor);
        this.plans.set(ids, plan);
        plan.catch((e: unknown) => {
            if (e instanceof BakeRefused) this.refusedLooks++;
            // A file that did not load is tried again by the next woka wearing it.
            else if (this.plans.get(ids) === plan) this.plans.delete(ids);
        });
        while (this.plans.size > PLANS_KEPT) {
            const oldest = this.plans.keys().next().value;
            if (oldest === undefined) break;
            this.plans.delete(oldest);
        }
        return plan;
    }

    /** One more hold on the look at `frameSize`, baked if new. */
    private hold(layers: WokaTextureDescriptionInterface[], plan: Plan, frameSize: number): BakedLook {
        const ids = idsOf(layers);
        const key = `woka@${frameSize}:${ids}`;
        let look = this.looks.get(key);
        if (look) {
            clearTimeout(look.linger);
            look.linger = undefined;
            this.lingering.delete(look);
            look.refs++;
            return look;
        }
        look = new BakedLook(key, ids, layers, plan, frameSize);
        this.looks.set(key, look);
        // Before baking: a free slot checks the look is wanted at once.
        look.refs++;
        this.bake(look);
        return look;
    }

    private bake(look: BakedLook): void {
        look.ready = this.bakeSlots
            .run(async () => {
                this.ensureWanted(look);
                await this.withLayers(look.layers, (images) =>
                    this.inFrame(this.megapixels(look), () => {
                        this.ensureWanted(look);
                        this.upload(look, compose(images, look.plan, look.frameSize, this.scratchCanvas()));
                    }),
                );
            })
            .then(
                () => {
                    look.state = "ready";
                    this.bakes++;
                    if (look.refs <= 0 && this.looks.get(look.key) === look) this.linger(look);
                },
                (e: unknown) => {
                    look.state = "failed";
                    if (this.looks.get(look.key) === look) this.looks.delete(look.key);
                    if (e instanceof NotWanted) this.skipped++;
                    else this.failures++;
                    throw asError(e);
                },
            );
        // Read by whoever holds the look; this only keeps a failure from being reported as unhandled.
        look.ready.catch(() => {});
    }

    /** A look everybody let go of before its turn is not baked: dropped now, so a later hold starts a fresh one. */
    private ensureWanted(look: BakedLook): void {
        const current = this.looks.get(look.key) === look;
        if (this.game && current && look.refs > 0) return;
        if (current) this.looks.delete(look.key);
        look.state = "failed";
        throw new NotWanted();
    }

    private megapixels(look: BakedLook): number {
        // Every layer drawn, the seated row and the picture read, the sheet halved or uploaded.
        return ((look.layers.length + 2) * look.plan.width * look.plan.height) / 1e6;
    }

    /** Every layer of a look decoded, shared with the other looks in flight, for as long as `use` runs. */
    private async withLayers<T>(
        layers: WokaTextureDescriptionInterface[],
        use: (images: LayerImage[]) => Promise<T>,
    ): Promise<T> {
        const held = layers.map((layer) => this.holdDecoded(layer.url));
        try {
            return await use(await Promise.all(held.map((entry) => entry.image)));
        } finally {
            for (const entry of held) this.letGoDecoded(entry);
        }
    }

    private holdDecoded(url: string): Decoded {
        let entry = this.decoded.get(url);
        if (!entry) {
            const fresh: Decoded = {
                url,
                refs: 0,
                bytes: 0,
                image: layerFile(url).then((file) => decodeImage(file.blob)),
            };
            fresh.image.then(
                (image) => {
                    fresh.bytes = image.width * image.height * 4;
                },
                () => {
                    if (this.idleDecoded.delete(fresh)) this.idleDecodedBytes -= fresh.bytes;
                    if (this.decoded.get(url) === fresh) this.decoded.delete(url);
                },
            );
            this.decoded.set(url, fresh);
            entry = fresh;
        }
        if (this.idleDecoded.delete(entry)) this.idleDecodedBytes -= entry.bytes;
        entry.refs++;
        return entry;
    }

    private letGoDecoded(entry: Decoded): void {
        entry.refs--;
        if (entry.refs > 0) return;
        const waited = this.bakeSlots.active + this.bakeSlots.waiting > 1;
        if (!waited || entry.bytes === 0 || this.decoded.get(entry.url) !== entry) {
            this.dropDecoded(entry);
            return;
        }
        this.idleDecoded.add(entry);
        this.idleDecodedBytes += entry.bytes;
        for (const idle of this.idleDecoded) {
            if (this.idleDecodedBytes <= IDLE_DECODED_BYTES) break;
            this.dropDecoded(idle);
        }
    }

    private dropDecoded(entry: Decoded): void {
        if (this.idleDecoded.delete(entry)) this.idleDecodedBytes -= entry.bytes;
        if (this.decoded.get(entry.url) === entry) this.decoded.delete(entry.url);
        // Closed once decoded, if it still is decoding.
        entry.image.then(closeImage, () => {});
    }

    private onBakesDone(): void {
        for (const entry of this.idleDecoded) this.dropDecoded(entry);
        if (this.scratch) freeCanvas(this.scratch);
    }

    private upload(look: BakedLook, composed: Composed): void {
        const game = this.game;
        if (!game) throw new NotWanted();
        const textures = game.textures;
        const { sheet, frameSize, seated, picture } = composed;
        const texture = withoutRefilter(game, () => textures.create(look.key, sheet));
        if (!texture) throw new Error(`woka baker: texture key taken: ${look.key}`);
        texture.add("__BASE", 0, 0, 0, sheet.width, sheet.height);
        let index = 0;
        for (let y = 0; y + frameSize <= sheet.height; y += frameSize)
            for (let x = 0; x + frameSize <= sheet.width; x += frameSize)
                texture.add(index++, 0, x, y, frameSize, frameSize);
        const data: BakedSheetData = { wokaFrameSize: frameSize, wokaSeatedColumns: seated };
        texture.customData = data;
        // Created nearest; sliceWokaSheet filters a 2x sheet for the zoom.
        setFilterInPlace(texture, NEAREST);
        look.texture = texture;
        look.bytes = sheet.width * sheet.height * 4;
        look.picture = picture;
        freeCanvas(sheet);
    }

    private isCurrent(look: BakedLook): boolean {
        return look.frameSize === frameFor(look.plan, this.scale);
    }

    private rescale(scale: Scale): void {
        this.scale = scale;
        // Looks nobody shows at the density the room left go soon (and back at it, stay); those a woka shows are baked
        // again and swapped.
        for (const look of [...this.lingering]) this.linger(look);
        for (const lease of [...this.leases]) this.moveIfStale(lease);
    }

    private linger(look: BakedLook): void {
        clearTimeout(look.linger);
        look.linger = setTimeout(
            () => {
                look.linger = undefined;
                if (look.refs <= 0) this.forget(look);
            },
            this.isCurrent(look) ? LINGER_MS : STALE_LINGER_MS,
        );
        this.lingering.delete(look);
        this.lingering.add(look);
        let bytes = 0;
        for (const idle of this.lingering) bytes += idle.bytes;
        for (const idle of this.lingering) {
            if (bytes <= LINGER_BYTES) break;
            bytes -= idle.bytes;
            this.forget(idle);
        }
    }

    private forget(look: BakedLook): void {
        clearTimeout(look.linger);
        look.linger = undefined;
        this.lingering.delete(look);
        if (this.looks.get(look.key) === look) this.looks.delete(look.key);
        const game = this.game;
        const texture = look.texture;
        look.texture = undefined;
        look.picture = undefined;
        look.pictureUrl = undefined;
        look.bytes = 0;
        if (!game || !texture) return;
        for (const key of wokaAnimationKeys(look.key)) game.anims.remove(key);
        forgetWokaTexture(texture);
        if (game.textures.exists(look.key) && game.textures.get(look.key) === texture) game.textures.remove(texture);
    }

    /** Swaps a woka's look for the same look at the room's density, once that is baked. */
    private moveIfStale(lease: WokaLease): void {
        const holder = lease.holder;
        const look = lease.look;
        if (!holder || !look || lease.released || lease.moving || this.isCurrent(look)) return;
        lease.moving = true;
        const next = this.leaseOf(look.layers);
        next.ready
            .then(
                () => {
                    lease.moving = false;
                    let swapped = false;
                    if (!lease.released && lease.holder === holder && next.look !== look) {
                        try {
                            swapped = holder.swapWokaLease(lease, next);
                        } catch (e) {
                            // Thrown before the sprite was touched: the woka still shows `lease`.
                            console.warn("quanta: woka look not swapped", asError(e));
                        }
                    }
                    if (!swapped) {
                        next.release();
                        return;
                    }
                    // The woka shows `next` now: from here on it is let go only when the woka goes.
                    next.holder = holder;
                    lease.release();
                    this.redraw?.();
                    // The density changed again while it was baking.
                    if (!this.rescaleTimer) this.moveIfStale(next);
                },
                (e: unknown) => {
                    lease.moving = false;
                    next.release();
                    if (!(e instanceof NotWanted)) console.warn("quanta: woka look not baked again", asError(e));
                },
            )
            .catch((e: unknown) => console.warn("quanta: woka look swapped, not tidied", asError(e)));
    }

    /** After a lost context every texture is made again from its kept image; a baked look kept none. */
    private readonly onContextRestored = (): void => {
        for (const look of this.looks.values()) {
            const texture = look.texture;
            if (look.state !== "ready" || !texture) continue;
            this.bakeSlots
                .run(async () => {
                    if (look.texture !== texture) return;
                    await this.withLayers(look.layers, (images) =>
                        this.inFrame(this.megapixels(look), () => {
                            const wrapper = texture.source[0]?.glTexture;
                            if (!this.game || look.texture !== texture || !wrapper) return;
                            const { sheet } = compose(images, look.plan, look.frameSize, this.scratchCanvas());
                            wrapper.update(
                                sheet,
                                sheet.width,
                                sheet.height,
                                wrapper.flipY,
                                wrapper.wrapS,
                                wrapper.wrapT,
                                wrapper.minFilter,
                                wrapper.magFilter,
                                wrapper.format,
                            );
                            freeCanvas(sheet);
                            this.rebakes++;
                        }),
                    );
                })
                .then(() => this.redraw?.())
                .catch((e: unknown) => console.warn("quanta: woka look not restored", look.key, asError(e)));
        }
    };

    private scratchCanvas(): HTMLCanvasElement {
        return (this.scratch ??= document.createElement("canvas"));
    }

    /** Runs `job` in a coming frame's budget; `megapixels` says how heavy it is. */
    private inFrame(megapixels: number, job: () => void): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const run = (): void => {
                try {
                    job();
                    resolve();
                } catch (e) {
                    reject(asError(e));
                }
            };
            // A hidden tab draws no frames, so none would come: at once.
            if (document.hidden) {
                run();
                return;
            }
            this.frameJobs.push({ megapixels, run });
            this.requestFrame();
        });
    }

    private requestFrame(): void {
        if (this.frameRequested) return;
        this.frameRequested = true;
        requestAnimationFrame(this.runFrame);
    }

    private readonly runFrame = (): void => {
        this.frameRequested = false;
        this.runFrameJobs(BUDGET_MS);
        if (this.frameJobs.length > 0) this.requestFrame();
    };

    private readonly onVisibilityChange = (): void => {
        // Frames stop in a hidden tab: what waits for one runs now.
        if (document.hidden) this.runFrameJobs(Infinity);
    };

    private runFrameJobs(budget: number): void {
        const start = performance.now();
        let ran = 0;
        while (this.frameJobs.length > 0) {
            const job = this.frameJobs[0];
            // Not started when it would likely end past the budget, unless nothing ran yet: a slow device moves on.
            if (ran > 0 && performance.now() - start + job.megapixels * this.msPerMegapixel > budget) break;
            this.frameJobs.shift();
            const began = performance.now();
            job.run();
            if (job.megapixels > 0) {
                const measured = (performance.now() - began) / job.megapixels;
                this.msPerMegapixel = this.msPerMegapixel * 0.7 + measured * 0.3;
            }
            ran++;
        }
    }

    private remember(ids: string, picture: Promise<string>): void {
        this.pictures.delete(ids);
        this.pictures.set(ids, picture);
        while (this.pictures.size > PICTURES_KEPT) {
            const oldest = this.pictures.keys().next().value;
            if (oldest === undefined) break;
            this.pictures.delete(oldest);
        }
    }
}

export const wokaBaker = new WokaBaker();

const leasesByTextures = new WeakMap<string[], WokaLease>();

/** The texture list a baked look is handed out as; the woka that shows it takes the lease over (adoptWokaLease). */
export function bakedTextureList(lease: WokaLease): string[] {
    const textures = [lease.key];
    leasesByTextures.set(textures, lease);
    return textures;
}

/** The baked look a texture list stands for, now held by `holder` (which releases it when it goes). */
export function adoptWokaLease(textures: string[], holder: WokaLeaseHolder): WokaLease | undefined {
    const lease = leasesByTextures.get(textures);
    if (!lease || lease.released) return undefined;
    leasesByTextures.delete(textures);
    lease.adopt(holder);
    return lease;
}

/** A woka picture from its layers on a canvas, or WA's default woka's when they cannot be read. */
export function wokaPicture(layers: WokaTextureDescriptionInterface[]): Promise<string> {
    return wokaBaker.picture(layers).catch((e: unknown) => {
        console.warn("quanta: woka picture from the default woka", asError(e).message);
        return wokaBaker.picture(DEFAULT_LAYERS);
    });
}

window.__quantaWokas = () => wokaBaker.stats();
