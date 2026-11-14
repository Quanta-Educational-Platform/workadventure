<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { pictureCell } from "../../Phaser/Player/WokaSheet";
    import { WOKA_V3_LAYERS } from "../../quanta/wokaV3";
    import type { WokaData, WokaTexture } from "./WokaTypes";

    interface Props {
        selectedTextures: Record<string, string>;
        wokaData?: WokaData | null;
        canvasSize?: number;
        direction?: number;
        getTextureUrl?: (url: string) => string;
        classList?: string;
        /** quanta: part of the frame only (in sheet pixels), drawn `scale` times; the canvas fits it. */
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

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (const part of bodyPartOrder) {
            const img = images[part];
            ctx.imageSmoothingEnabled = false;
            if (img && img.complete) {
                const cell = pictureCell(img.naturalWidth, direction, frame);
                if (crop) {
                    ctx.drawImage(
                        img,
                        cell.column * 32 + crop.x,
                        cell.row * 32 + crop.y,
                        crop.w,
                        crop.h,
                        0,
                        0,
                        width,
                        height,
                    );
                } else {
                    ctx.drawImage(img, cell.column * 32, cell.row * 32, 32, 32, 0, 0, canvasSize, canvasSize);
                }
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

<canvas bind:this={canvas} {width} {height} style="image-rendering: pixelated;" class={classList}></canvas>
