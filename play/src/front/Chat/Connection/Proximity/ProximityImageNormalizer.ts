// iPhone photos are HEIC, which only Safari displays: sent as is they reach most of the class as a file
// they have to save and cannot open. A browser that can decode one re-encodes it as JPEG before sending.
const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
const HEIC_EXTENSION = /\.(heic|heif)$/i;
// iOS Safari draws nothing on a canvas above ~16.7 million pixels: 4096 px on the long side stays under it.
const MAX_EDGE = 4096;
const JPEG_QUALITY = 0.9;

export interface ImageCodec {
    decode(file: File): Promise<ImageBitmap>;
    encodeJpeg(bitmap: ImageBitmap, width: number, height: number): Promise<Blob>;
}

export function isHeicImage(file: File): boolean {
    const type = file.type.toLowerCase();
    return HEIC_TYPES.has(type) || (type === "" && HEIC_EXTENSION.test(file.name));
}

const browserCodec: ImageCodec = {
    decode: (file) => createImageBitmap(file),
    encodeJpeg: (bitmap, width, height) =>
        new Promise<Blob>((resolve, reject) => {
            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext("2d");
            if (!context) {
                reject(new Error("No 2D canvas context"));
                return;
            }
            context.drawImage(bitmap, 0, 0, width, height);
            canvas.toBlob(
                (blob) => (blob ? resolve(blob) : reject(new Error("The image could not be encoded"))),
                "image/jpeg",
                JPEG_QUALITY,
            );
        }),
};

/** The file to send for `file`: a HEIC photo as JPEG when this browser can decode it, anything else unchanged. */
export async function normalizeChatImage(file: File, codec: ImageCodec = browserCodec): Promise<File> {
    if (!isHeicImage(file) || (codec === browserCodec && typeof createImageBitmap !== "function")) {
        return file;
    }
    let bitmap: ImageBitmap | undefined;
    try {
        bitmap = await codec.decode(file);
        const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
        const blob = await codec.encodeJpeg(
            bitmap,
            Math.max(1, Math.round(bitmap.width * scale)),
            Math.max(1, Math.round(bitmap.height * scale)),
        );
        return new File([blob], `${file.name.replace(HEIC_EXTENSION, "")}.jpg`, {
            type: "image/jpeg",
            lastModified: file.lastModified,
        });
    } catch {
        // Chrome and Firefox cannot decode HEIC: it goes as a file to save.
        return file;
    } finally {
        bitmap?.close();
    }
}
