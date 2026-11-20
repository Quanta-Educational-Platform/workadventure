import * as Phaser from "phaser";
import { coWebsiteManager } from "../../Stores/CoWebsiteStore";
import type { Game } from "../Game/Game";
import { ResizableScene } from "../Login/ResizableScene";
import { setWokaTexturesZoom } from "../Player/WokaSheet";
import { wokaBaker } from "../Entity/WokaBaker";
import { HdpiManager } from "./HdpiManager";

import ScaleManager = Phaser.Scale.ScaleManager;
import Camera = Phaser.Cameras.Scene2D.Camera;

export enum WaScaleManagerEvent {
    RefreshFocusOnTarget = "wa-scale-manager:refresh-focus-on-target",
    ZoomChanged = "wa-scale-manager:zoom-changed",
}

export type WaScaleManagerFocusTarget = { x: number; y: number; width?: number; height?: number };

export class WaScaleManager {
    private hdpiManager: HdpiManager;
    private scaleManager: ScaleManager | undefined;
    private game!: Game;
    private actualZoom = 1;
    private _saveZoom = 1;
    private lastEmittedZoomModifier: number | undefined;
    private lastEmittedActualZoom: number | undefined;

    private focusTarget?: WaScaleManagerFocusTarget;

    private applying = false;
    private pendingApply: { camera?: Camera; animating: boolean } | undefined;

    public constructor(
        private minGamePixelsNumber: number,
        private absoluteMinPixelNumber: number,
    ) {
        this.hdpiManager = new HdpiManager(minGamePixelsNumber, absoluteMinPixelNumber);
    }

    private emitZoomChangedIfNeeded(): void {
        const zoomModifier = this.hdpiManager.zoomModifier;
        // We emit on actualZoom changes too, not only zoomModifier: DOM overlays whose CSS scale
        // compensates for the parent's on-screen zoom (e.g. the Woka username) depend on actualZoom,
        // which changes on resize or when the window moves to a screen with a different device pixel
        // ratio while zoomModifier stays constant.
        if (this.lastEmittedZoomModifier === zoomModifier && this.lastEmittedActualZoom === this.actualZoom) {
            return;
        }

        this.lastEmittedZoomModifier = zoomModifier;
        this.lastEmittedActualZoom = this.actualZoom;
        this.game.events.emit(WaScaleManagerEvent.ZoomChanged, zoomModifier);
    }

    public setGame(game: Game): void {
        this.scaleManager = game.scale;
        this.game = game;
        this.lastEmittedZoomModifier = this.hdpiManager.zoomModifier;
    }

    public applyNewSize(camera?: Camera, animating = false): void {
        if (this.scaleManager === undefined) {
            return;
        }
        // Phaser's resize emits RESIZE synchronously and the scenes' onResize may set a new zoom from inside this
        // call; finishing the outer call afterwards would apply its stale zoom over the inner call's canvas size.
        // The nested request is deferred and run once the current one has finished.
        if (this.applying) {
            this.pendingApply = { camera: camera ?? this.pendingApply?.camera, animating };
            return;
        }
        this.applying = true;
        try {
            this.doApplyNewSize(camera, animating);
            for (let pass = 0; this.pendingApply && pass < 3; pass++) {
                const next = this.pendingApply;
                this.pendingApply = undefined;
                this.doApplyNewSize(next.camera, next.animating);
            }
        } finally {
            this.applying = false;
            this.pendingApply = undefined;
        }
    }

    private doApplyNewSize(camera: Camera | undefined, animating: boolean): void {
        if (this.scaleManager === undefined) {
            return;
        }
        const { width, height } = coWebsiteManager.getGameSize();
        const devicePixelRatio = window.devicePixelRatio ?? 1;
        const { game: gameSize, real: realSize } = this.hdpiManager.getOptimalGameSize({
            width: width * devicePixelRatio,
            height: height * devicePixelRatio,
        });

        if (realSize.width !== 0 && gameSize.width !== 0 && devicePixelRatio !== 0) {
            this.actualZoom = realSize.width / gameSize.width / devicePixelRatio;
        }

        // The performance shows us that having a game size bigger than its real size causes many lags and bad game performance.
        // So we apply this condition: if the game size is greater than the real size, we don't zoom through the canvas.
        // To zoom in and out, we use the camera. The zoom is calculated using the optimal zoom level.
        // If the game size is smaller than the real size, we set the Phaser zoom level to 1 and we resize the canvas pixel size.
        // It's more efficient to keep the canvas as small as possible.
        // One exception: during camera zoom animations. The this.scaleManager.resize costs a lot of resources. So we don't
        // want to do this in a loop when zooming. If we are in the middle of an animation, we scale the canvas number of pixels
        // to the browser viewport and we use the Phaser camera zoom.
        if (!animating) {
            // "Sharp bilinear": the exact zoom the layout asks for (so the room fills its pane and resizes smoothly)
            // is drawn at the next whole zoom with crisp pixels, then the browser smoothly shrinks the canvas to the
            // exact size. Every map pixel is an identical block in the canvas, so nothing pulses while the camera
            // moves; drawing straight at a fractional zoom makes each map pixel 4 or 5 device pixels by turns.
            const exactZoom =
                gameSize.width <= realSize.width && gameSize.height <= realSize.height
                    ? realSize.width / gameSize.width
                    : this.hdpiManager.zoomModifier *
                      this.hdpiManager.getOptimalZoomLevel(realSize.width * realSize.height);
            let drawnZoom = Math.max(1, Math.ceil(exactZoom - 0.01));
            // Below 2x the next whole zoom can nearly double the canvas; enlarge slightly instead.
            if (drawnZoom / exactZoom > 1.5) drawnZoom = Math.max(1, Math.floor(exactZoom));
            this.actualZoom = exactZoom / devicePixelRatio;
            // The camera's zoom goes with the canvas size: set first, as the resize tells the scenes at once
            // (Game.ts) and their camera bounds read both; set after, the frame is drawn with bounds made from the
            // new width and the old zoom, the room off by up to a hundred pixels until the next frame.
            camera?.setZoom(drawnZoom);
            setWokaTexturesZoom(drawnZoom);
            wokaBaker.setDrawnZoom(drawnZoom);
            this.scaleManager.resize(
                Math.ceil((realSize.width * drawnZoom) / exactZoom),
                Math.ceil((realSize.height * drawnZoom) / exactZoom),
            );
            this.scaleManager.setZoom(exactZoom / drawnZoom / devicePixelRatio);
            // Phaser marks the canvas crisp (antialias off); the shrink must be smooth unless the zoom is whole.
            if (this.game.canvas) {
                this.game.canvas.style.imageRendering = Math.abs(drawnZoom - exactZoom) < 0.001 ? "pixelated" : "auto";
            }
        } else {
            // During zoom animations: canvas at device resolution, camera zoom follows the animation.
            const zoom =
                this.hdpiManager.zoomModifier * this.hdpiManager.getOptimalZoomLevel(realSize.width * realSize.height);
            camera?.setZoom(zoom);
            setWokaTexturesZoom(zoom);
            if (this.scaleManager.width !== realSize.width || this.scaleManager.height !== realSize.height) {
                this.scaleManager.resize(realSize.width, realSize.height);
            }
            this.scaleManager.setZoom(1 / devicePixelRatio);
        }

        // Note: onResize will be called twice (once here and once in Game.ts), but we have no better way.
        for (const scene of this.game.scene.getScenes(true)) {
            if (scene instanceof ResizableScene) {
                // We are delaying the call to the "render" event because otherwise, the "camera" coordinates are not correctly updated.
                scene.events.once(Phaser.Scenes.Events.RENDER, () => scene.onResize());
            }
        }

        this.emitZoomChangedIfNeeded();
        this.game.markDirty();
    }

    /**
     * Use this in case of resizing while focusing on something
     */
    public refreshFocusOnTarget(camera?: Camera): void {
        if (!this.focusTarget) {
            return;
        }
        if (this.focusTarget.width && this.focusTarget.height) {
            this.setZoomModifier(
                this.getTargetZoomModifierFor(this.focusTarget.width, this.focusTarget.height),
                camera,
            );
        }

        this.game.events.emit(WaScaleManagerEvent.RefreshFocusOnTarget, this.focusTarget);
    }

    public setFocusTarget(targetDimensions?: WaScaleManagerFocusTarget): void {
        this.focusTarget = targetDimensions;
    }

    public getTargetZoomModifierFor(viewportWidth: number, viewportHeight: number) {
        const { width: gameWidth, height: gameHeight } = coWebsiteManager.getGameSize();
        const devicePixelRatio = window.devicePixelRatio ?? this.hdpiManager.maxZoomOut;

        const { real: realSize } = this.hdpiManager.getOptimalGameSize({
            width: gameWidth * devicePixelRatio,
            height: gameHeight * devicePixelRatio,
        });
        const desiredZoom = Math.min(realSize.width / viewportWidth, realSize.height / viewportHeight);
        const realPixelNumber = gameWidth * devicePixelRatio * gameHeight * devicePixelRatio;
        return desiredZoom / (this.hdpiManager.getOptimalZoomLevel(realPixelNumber) || 1);
    }

    public get zoomModifier(): number {
        return this.hdpiManager.zoomModifier;
    }

    public set zoomModifier(zoomModifier: number) {
        let camera = undefined;
        // Let's attempt to get the camera
        for (const scene of this.game.scene.getScenes(true)) {
            if (scene.cameras.main) {
                camera = scene.cameras.main;
            }
        }

        this.setZoomModifier(zoomModifier, camera);
    }

    public setZoomModifier(zoomModifier: number, camera?: Camera, animating = false): void {
        this.hdpiManager.zoomModifier = zoomModifier;
        this.applyNewSize(camera, animating);
    }

    public getFocusTarget(): WaScaleManagerFocusTarget | undefined {
        return this.focusTarget;
    }

    public saveZoom(): void {
        this._saveZoom = this.hdpiManager.zoomModifier;
    }

    public getSaveZoom(): number {
        return this._saveZoom;
    }

    public restoreZoom(): void {
        this.hdpiManager.zoomModifier = this._saveZoom;
        this.applyNewSize();
    }

    public getActualZoom(): number {
        return this.actualZoom;
    }

    /**
     * This is used to scale back the ui components to counter-act the zoom.
     */
    public get uiScalingFactor(): number {
        return this.actualZoom > 1 ? 1 : 1.2;
    }

    public set maxZoomOut(maxZoomOut: number) {
        this.hdpiManager.maxZoomOut = maxZoomOut;
    }
    public get maxZoomOut(): number {
        return this.hdpiManager.maxZoomOut;
    }

    public get isMaximumZoomOutReached(): boolean {
        return this.hdpiManager.isMaximumZoomReached;
    }

    public get isMaximumZoomInReached(): boolean {
        return this.hdpiManager.isMaximumZoomInReached;
    }
}

export const waScaleManager = new WaScaleManager(640 * 480, 196 * 196);
