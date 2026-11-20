import * as Phaser from "phaser";
import { asError } from "catch-unknown";

import Sprite = Phaser.GameObjects.Sprite;

export class TexturesHelper {
    public static async getSnapshot(
        scene: Phaser.Scene,
        ...sprites: { sprite: Sprite; frame?: string | number }[]
    ): Promise<string> {
        if (!scene.game.renderer) {
            // In headless mode, we cannot take snapshots.
            // TODO: send a correct PNG????
            // TODO: send a correct PNG????
            // TODO: send a correct PNG????
            // TODO: send a correct PNG????
            // TODO: send a correct PNG????
            // TODO: send a correct PNG????
            return "";
        }
        // quanta: as big as the densest layer (a 2x woka sheet's frames are 64 x 64, drawn at 32 in the room): every
        // layer is drawn at that size for the picture, then put back as it was.
        const size = Math.max(32, ...sprites.map(({ sprite }) => sprite.frame.width));
        const rt = scene.make.renderTexture({ width: size, height: size }, false);
        try {
            for (const { sprite, frame } of sprites) {
                if (frame) {
                    sprite.setFrame(frame);
                }
                const scaleX = sprite.scaleX;
                const scaleY = sprite.scaleY;
                sprite.setScale(size / sprite.frame.width);
                rt.draw(sprite, sprite.displayWidth * 0.5, sprite.displayHeight * 0.5);
                sprite.setScale(scaleX, scaleY);
            }
            rt.render();
            return new Promise<string>((resolve, reject) => {
                try {
                    rt.snapshot(
                        (url) => {
                            if (url instanceof HTMLImageElement) {
                                resolve(url.src);
                            } else {
                                console.error("Unexpected color object received for snapshot", url);
                                resolve("");
                            }
                            rt.destroy();
                        },
                        "image/png",
                        1,
                    );
                } catch (error) {
                    rt.destroy();
                    reject(asError(error));
                }
            });
        } catch (error) {
            rt.destroy();
            throw new Error("Could not get the snapshot", { cause: error });
        }
    }

    public static createRectangleTexture(
        scene: Phaser.Scene,
        textureKey: string,
        width: number,
        height: number,
        color: number,
    ): void {
        const rectangleTexture = scene.add.graphics().fillStyle(color, 1).fillRect(0, 0, width, height);
        rectangleTexture.generateTexture(textureKey, width, height);
        rectangleTexture.destroy();
    }

    public static createCircleTexture(
        scene: Phaser.Scene,
        textureKey: string,
        radius: number,
        color: number,
        outlineColor?: number,
        outlineThickness?: number,
    ): void {
        const circleTexture = scene.add.graphics().fillStyle(color, 1).fillCircle(radius, radius, radius);
        if (outlineColor) {
            circleTexture.lineStyle(outlineThickness ?? 1, outlineColor).strokeCircle(radius, radius, radius);
        }
        circleTexture.generateTexture(textureKey, radius * 2, radius * 2);
        circleTexture.destroy();
    }

    public static async loadEntityImage(scene: Phaser.Scene, key: string, url: string): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            if (scene.textures.exists(key)) {
                resolve();
            }
            scene.load.once(`filecomplete-image-${key}`, () => {
                resolve();
            });
            scene.load.image(key, url);
            scene.load.start();
        });
    }
}
