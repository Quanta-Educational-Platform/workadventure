<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { frameSizeOf, pictureCell } from "../../Phaser/Player/WokaSheet";
    import { WOKA_V3_LAYERS } from "../../quanta/wokaV3";
    import type { WokaData, WokaTexture } from "./WokaTypes";

    interface Props {
        selectedTextures: Record<string, string>;
        wokaData?: WokaData | null;
        canvasSize?: number;
        direction?: number;
        getTextureUrl?: (url: string) => string;
        classList?: string;
        /** quanta: part of the frame only (in room pixels: twice as many texels on a 2x sheet), drawn `scale` times;
         * the canvas fits it. */
        crop?: { x: number; y: number; w: number; h: number };
        scale?: number;
    }

    let {
        selectedTextures,
        wokaData = null,
        canvasSize = 64,
        direction = 0,
        getTextureUrl = (url) => url,
        classList = "",
        crop = undefined,
        scale = 2,
    }: Props = $props();

    // quanta: Quanta's own parts (v3) after WA's, in the order they are drawn.
    const bodyPartOrder = [
        "body",
        "eyes",
        "hair",
        "clothes",
        "hat",
        "accessory",
        "woka",
        ...WOKA_V3_LAYERS.map((layer) => layer.key),
    ];
    const width = $derived(crop ? crop.w * scale : canvasSize);
    const height = $derived(crop ? crop.h * scale : canvasSize);

    let canvas: HTMLCanvasElement;
    let ctx: CanvasRenderingContext2D;
    let images: Record<string, HTMLImageElement> = {};
    let frame: number = 0;

    let raf: number;

    function findTextureUrl(bodyPart: string): string | null {
        const textureId = selectedTextures?.[bodyPart];
        if (!textureId || !wokaData?.[bodyPart]?.collections) return null;
        for (const collection of wokaData[bodyPart].collections) {
            const texture = collection.textures.find((t: WokaTexture) => t.id === textureId);
            if (texture) return getTextureUrl(texture.url);
        }
        return null;
    }

    function loadImages() {
        images = {};
        for (const part of bodyPartOrder) {
            const url = findTextureUrl(part);
            if (url) {
                const img = new window.Image();
                img.src = url;
                // Load image with CORS headers to populate the cache with CORS headers
                img.crossOrigin = "user-credentials";
                images[part] = img;
            }
        }
    }

    // quanta: the canvas has a pixel per device pixel, so a 2x sheet's texels show; they stay crisp where each covers a
    // whole number of pixels and are smoothed where not (a 1x screen showing a 2x sheet at an odd scale).
    const density = Math.max(1, Math.round(window.devicePixelRatio || 1));

    function draw() {
        if (canvas.width !== width * density) canvas.width = width * density;
        if (canvas.height !== height * density) canvas.height = height * density;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const part of bodyPartOrder) {
            const img = images[part];
            if (img && img.complete && img.naturalWidth) {
                const size = frameSizeOf(img.naturalWidth);
                const k = size / 32;
                const cell = pictureCell(img.naturalWidth, direction, frame);
                const area = crop ?? { x: 0, y: 0, w: 32, h: 32 };
                ctx.imageSmoothingEnabled = !Number.isInteger(canvas.width / (area.w * k));
                ctx.imageSmoothingQuality = "high";
                ctx.drawImage(
                    img,
                    cell.column * size + area.x * k,
                    cell.row * size + area.y * k,
                    area.w * k,
                    area.h * k,
                    0,
                    0,
                    canvas.width,
                    canvas.height,
                );
            }
        }
    }

    function animate() {
        draw();
        raf = requestAnimationFrame(animate);
    }

    $effect(() => {
        if (selectedTextures) {
            loadImages();
        }
    });

    onMount(() => {
        const context = canvas.getContext("2d");
        if (!context) return;
        ctx = context;
        loadImages();
        animate();
    });
    onDestroy(() => {
        cancelAnimationFrame(raf);
    });
</script>

<canvas
    bind:this={canvas}
    width={width * density}
    height={height * density}
    style="image-rendering: pixelated; width: {width}px; height: {height}px;"
    class={classList}
></canvas>
