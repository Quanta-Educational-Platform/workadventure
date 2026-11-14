import * as Phaser from "phaser";
import VirtualJoystick from "phaser4-rex-plugins/plugins/virtualjoystick.js";
import { waScaleManager } from "../Services/WaScaleManager";
import { DEPTH_INGAME_TEXT_INDEX } from "../Game/DepthIndexes";
import { DirtyScene } from "../Game/DirtyScene";
import { roomWindowInsets } from "../../quanta/roomWindow";

import Image = Phaser.GameObjects.Image;

//the assets were found here: https://hannemann.itch.io/virtual-joystick-pack-free
export const joystickBaseKey = "joystickBase";
export const joystickBaseImg = "resources/objects/joystickSplitted.png";
export const joystickThumbKey = "joystickThumb";
export const joystickThumbImg = "resources/objects/smallHandleFilledGrey.png";

const baseSize = 50;
const thumbSize = 25;
const radius = 17.5;

// quanta: on a touch screen the joystick rests in the map's lower-left corner, big enough for a thumb and always in
// sight, so people see they can walk with it; it still jumps to wherever a finger lands, and goes back to rest after.
const REST_BASE_CSS = 104;
const REST_THUMB_CSS = 46;
const REST_TRAVEL_CSS = 40;
const REST_DEAD_ZONE_CSS = 8;
const REST_ALPHA = 0.55;
const ACTIVE_ALPHA = 0.9;

export class MobileJoystick extends VirtualJoystick {
    private readonly joystickScene: Phaser.Scene;
    private readonly joystickBase: Phaser.GameObjects.Arc | Image;
    private readonly joystickThumb: Phaser.GameObjects.Arc | Image;
    private resizeCallback: () => void;

    private setimeout: NodeJS.Timeout | null = null;
    private destroyed: boolean = false;
    private readonly resting: boolean;

    constructor(
        private scene: Phaser.Scene,
        resting = false,
    ) {
        const joystickBase = resting
            ? scene.add.circle(0, 0, 50, 0x101217, 0.45).setStrokeStyle(4, 0xffffff, 0.75)
            : scene.add.image(0, 0, joystickBaseKey);
        joystickBase
            .setDisplaySize(
                (baseSize / waScaleManager.zoomModifier) * window.devicePixelRatio,
                (baseSize / waScaleManager.zoomModifier) * window.devicePixelRatio,
            )
            .setDepth(DEPTH_INGAME_TEXT_INDEX);
        const joystickThumb = resting
            ? scene.add.circle(0, 0, 50, 0xffffff, 0.95)
            : scene.add.image(0, 0, joystickThumbKey);
        joystickThumb
            .setDisplaySize(
                (thumbSize / waScaleManager.zoomModifier) * window.devicePixelRatio,
                (thumbSize / waScaleManager.zoomModifier) * window.devicePixelRatio,
            )
            .setDepth(DEPTH_INGAME_TEXT_INDEX);

        super(scene, {
            x: -1000,
            y: -1000,
            radius: radius * window.devicePixelRatio,
            base: joystickBase,
            thumb: joystickThumb,
            enable: true,
            dir: "8dir",
        });
        this.joystickScene = scene;
        this.joystickBase = joystickBase;
        this.joystickThumb = joystickThumb;
        this.resting = resting;

        // Disable the joystick by default
        this.enable = false;

        if (resting) {
            this.resize();
        } else {
            // Show the joystick at the bottom middle of the screen
            const { width, height } = this.joystickScene.game.canvas;
            this.x = width / 2;
            this.y = height * 0.8;

            // Add opacity
            this.joystickBase.setAlpha(0.3);
            this.joystickThumb.setAlpha(0.3);
        }

        this.resizeCallback = this.resize.bind(this);
        this.joystickScene.scale.on(Phaser.Scale.Events.RESIZE, this.resizeCallback);
    }

    public showAt(x: number, y: number): void {
        // Show the joystick at the given position
        if (this.resting) {
            // quanta: under the finger whatever the camera's zoom (fixedPosition)
            this.resize();
            const fixed = this.fixedPosition(x, y);
            this.x = fixed.x;
            this.y = fixed.y;
        } else {
            this.x = x;
            this.y = y;
        }

        // The joystick is used by the player
        this.enable = true;
        this.visible = true;
        if (this.resting) this.setRestAlpha(ACTIVE_ALPHA);

        if (this.setimeout) clearTimeout(this.setimeout);
    }

    /** quanta: back to its corner, where it waits to be used. */
    public rest(): void {
        this.enable = false;
        if (this.setimeout) clearTimeout(this.setimeout);
        this.setimeout = null;
        this.placeAtRest();
        this.setRestAlpha(REST_ALPHA);
        this.visible = true;
        if (this.scene instanceof DirtyScene) this.scene.markDirty();
    }

    private setRestAlpha(alpha: number): void {
        this.joystickBase.setAlpha(alpha);
        this.joystickThumb.setAlpha(alpha);
    }

    /**
     * Where an object that ignores the camera's scroll must stand to be drawn at screen point (x, y), in game pixels:
     * the camera still zooms it about its origin, and WA draws a phone's map at a whole zoom (2 and up), which put a
     * joystick placed at the finger's raw coordinates (and its touch area) somewhere else entirely.
     */
    private fixedPosition(x: number, y: number): { x: number; y: number } {
        const camera = this.joystickScene.cameras.main;
        const ox = camera.originX * camera.width;
        const oy = camera.originY * camera.height;
        return { x: (x - camera.x - ox) / camera.zoom + ox, y: (y - camera.y - oy) / camera.zoom + oy };
    }

    /** Game pixels per CSS pixel of the canvas. */
    private cssToGame(): number {
        const canvas = this.joystickScene.game.canvas;
        const cssWidth = canvas.getBoundingClientRect().width;
        return cssWidth > 0 ? canvas.width / cssWidth : window.devicePixelRatio / waScaleManager.zoomModifier;
    }

    private placeAtRest(): void {
        const ratio = this.cssToGame();
        const insets = roomWindowInsets(0);
        const canvas = this.joystickScene.game.canvas;
        const cssHeight = canvas.getBoundingClientRect().height || canvas.height / ratio;
        const margin = 14 + REST_BASE_CSS / 2;
        const fixed = this.fixedPosition((insets.left + margin) * ratio, (cssHeight - insets.bottom - margin) * ratio);
        this.x = fixed.x;
        this.y = fixed.y;
    }

    public hide(delay: number): void {
        if (this.resting) {
            this.rest();
            return;
        }
        // The joystick is not used by the player
        this.enable = false;

        // After the timeout, disable the joystick
        if (this.setimeout) clearTimeout(this.setimeout);
        this.setimeout = setTimeout(() => {
            if (this.destroyed) {
                return;
            }
            this.visible = false;
            if (this.scene instanceof DirtyScene) {
                this.scene.markDirty();
            }
        }, delay);
    }

    public resize() {
        if (this.resting) {
            // Sizes and the drag, which rex measures in the camera's unzoomed pixels, are divided by the zoom.
            const unit = this.cssToGame() / (this.joystickScene.cameras.main.zoom || 1);
            this.joystickBase.setDisplaySize(REST_BASE_CSS * unit, REST_BASE_CSS * unit);
            this.joystickThumb.setDisplaySize(REST_THUMB_CSS * unit, REST_THUMB_CSS * unit);
            // rex keeps these out of its typings
            const rex = this as unknown as {
                setRadius(radius: number): void;
                touchCursor?: { setDistanceThreshold(distance: number): void };
            };
            rex.setRadius(REST_TRAVEL_CSS * unit);
            rex.touchCursor?.setDistanceThreshold(REST_DEAD_ZONE_CSS * unit);
            if (!this.enable) this.placeAtRest();
            return;
        }
        // scale the joystick to the current zoom level
        this.joystickBase.setDisplaySize(
            this.getDisplaySizeByElement(baseSize),
            this.getDisplaySizeByElement(baseSize),
        );
        this.joystickThumb.setDisplaySize(
            this.getDisplaySizeByElement(thumbSize),
            this.getDisplaySizeByElement(thumbSize),
        );

        // TODO: change it to apply the good ratio of the canvas
        // Show the joystick at the bottom middle of the screen
        const { width, height } = this.joystickScene.game.canvas;
        this.x = width / 2;
        this.y = height * 0.8;
    }

    private getDisplaySizeByElement(element: number): number {
        return (element / (waScaleManager.zoomModifier * waScaleManager.uiScalingFactor)) * window.devicePixelRatio;
    }

    public destroy() {
        this.joystickScene.scale.removeListener(Phaser.Scale.Events.RESIZE, this.resizeCallback);
        super.destroy();
        this.destroyed = true;
    }
}
