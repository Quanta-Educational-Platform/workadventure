import { describe, expect, it, vi } from "vitest";
import { isHeicImage, normalizeChatImage, type ImageCodec } from "../ProximityImageNormalizer";

function bitmap(width: number, height: number) {
    const close = vi.fn();
    return { decoded: { width, height, close } as unknown as ImageBitmap, close };
}

function codec(decoded: ImageBitmap | Error): ImageCodec & { encodeJpeg: ReturnType<typeof vi.fn> } {
    return {
        decode: () => (decoded instanceof Error ? Promise.reject(decoded) : Promise.resolve(decoded)),
        encodeJpeg: vi.fn().mockResolvedValue(new Blob(["jpeg"], { type: "image/jpeg" })),
    };
}

describe("isHeicImage", () => {
    it("recognises HEIC by type, or by name when the browser gives no type", () => {
        expect(isHeicImage(new File([""], "IMG_1.HEIC", { type: "image/heic" }))).toBe(true);
        expect(isHeicImage(new File([""], "IMG_1.heif", { type: "" }))).toBe(true);
        expect(isHeicImage(new File([""], "photo.jpg", { type: "image/jpeg" }))).toBe(false);
        expect(isHeicImage(new File([""], "notes.heic.txt", { type: "text/plain" }))).toBe(false);
    });
});

describe("normalizeChatImage", () => {
    it("sends a HEIC photo as JPEG when the browser decodes it", async () => {
        const { decoded, close } = bitmap(4032, 3024);
        const jpegCodec = codec(decoded);

        const result = await normalizeChatImage(new File(["heic"], "IMG_1.HEIC", { type: "image/heic" }), jpegCodec);

        expect(result.name).toBe("IMG_1.jpg");
        expect(result.type).toBe("image/jpeg");
        expect(jpegCodec.encodeJpeg).toHaveBeenCalledWith(decoded, 4032, 3024);
        expect(close).toHaveBeenCalled();
    });

    it("scales a very large photo under what a phone's canvas can draw", async () => {
        const jpegCodec = codec(bitmap(8064, 6048).decoded);

        await normalizeChatImage(new File(["heic"], "big.heic", { type: "image/heic" }), jpegCodec);

        expect(jpegCodec.encodeJpeg).toHaveBeenCalledWith(expect.anything(), 4096, 3072);
    });

    it("keeps the original when the browser cannot decode HEIC", async () => {
        const original = new File(["heic"], "IMG_1.HEIC", { type: "image/heic" });

        expect(await normalizeChatImage(original, codec(new Error("unsupported")))).toBe(original);
    });

    it("leaves every other file alone", async () => {
        const original = new File(["png"], "screen.png", { type: "image/png" });
        const jpegCodec = codec(bitmap(10, 10).decoded);

        expect(await normalizeChatImage(original, jpegCodec)).toBe(original);
        expect(jpegCodec.encodeJpeg).not.toHaveBeenCalled();
    });
});
