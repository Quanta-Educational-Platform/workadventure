import * as Phaser from "phaser";
import { get } from "svelte/store";
import { mapEditorModeStore } from "../../Stores/MapEditorStore";
import { coWebsiteManager } from "../../Stores/CoWebsiteStore";
import { type Insets, NO_INSETS, roomBounds, roomFitScale, type Size, windowView } from "../../quanta/roomFit";
import { chatColumnWidth, roomWindowInsets, sideColumnFrameShare, withRoomMargin } from "../../quanta/roomWindow";
import { Easing } from "../../types";
import { HtmlUtils } from "../../WebRtc/HtmlUtils";
import type { Box } from "../../WebRtc/LayoutManager";
import type { Character } from "../Entity/Character";
import { hasMovedEventName, type Player } from "../Player/Player";
import type { WaScaleManager, WaScaleManagerFocusTarget } from "../Services/WaScaleManager";
import { WaScaleManagerEvent } from "../Services/WaScaleManager";
import type { ActiveEventList } from "../UserInput/UserInputManager";
import { UserInputEvent } from "../UserInput/UserInputManager";
import type { RemotePlayer } from "../Entity/RemotePlayer";
import { QUANTA_UI } from "../../Enum/EnvironmentVariable";
import { touchScreenManager } from "../../Touch/TouchScreenManager";
import {
    SMOOTH_BUTTON_ZOOM_DURATION,
    SMOOTH_BUTTON_ZOOM_TARGET_EPSILON,
    getContinuousButtonZoomFactor,
    getRetargetedButtonZoomModifier,
    getSmoothButtonZoomModifier,
} from "./CameraZoomUtils";
import type { GameScene } from "./GameScene";

import Clamp = Phaser.Math.Clamp;
import EventEmitter = Phaser.Events.EventEmitter;
import Camera = Phaser.Cameras.Scene2D.Camera;
import Tween = Phaser.Tweens.Tween;

// quanta: how long the room's size must hold still before it glides to the new fit, and how long that glide takes.
const REFIT_SETTLE_MS = 90;
const REFIT_GLIDE_MS = 280;
// quanta: a settled frame whose fit is within this share of the last fit keeps the zoom on screen: a frame that
// wavers by a few pixels never zooms the map out and back in.
const REFIT_HYSTERESIS = 0.03;

function sameInsets(a: Insets, b: Insets): boolean {
    return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

function viewKey(screen: Size, insets: Insets): string {
    return [screen.width, screen.height, insets.top, insets.right, insets.bottom, insets.left].join(",");
}

function mixInsets(from: Insets, to: Insets, progress: number): Insets {
    const mix = (a: number, b: number) => a + (b - a) * progress;
    return {
        top: mix(from.top, to.top),
        right: mix(from.right, to.right),
        bottom: mix(from.bottom, to.bottom),
        left: mix(from.left, to.left),
    };
}

export enum CameraManagerEvent {
    CameraUpdate = "CameraUpdate",
}

export interface CameraManagerEventCameraUpdateData {
    x: number;
    y: number;
    width: number;
    height: number;
    zoom: number;
}

type FocusCameraAnimation = {
    type: "focus";
    onInterrupt: () => void;
};

type SpeedCameraAnimation = {
    type: "speed";
    speedX: number;
    speedY: number;
    onComplete: () => void;
    onInterrupt: () => void;
};

type CameraAnimation = FocusCameraAnimation | SpeedCameraAnimation;

type ZoomAnimation = {
    onInterrupt: () => void;
    // quanta: a glide of the camera's bounds only, the zoom left alone.
    boundsOnly?: boolean;
};

/** quanta: layout A (rail.ts): the call's rail beside the room. */
const railLayout = (): boolean => document.documentElement.dataset.quantaLayout === "a";

/**
 * The CameraManager is responsible for managing the camera in the game.
 * It allows to set the camera to follow the player, to focus on a specific point or to be in exploration mode.
 *
 * The CameraManager handles the transitions / animations between the different camera modes.
 * It also handles the smooth zoom in and out of the camera.
 */
export class CameraManager extends EventEmitter {
    private camera: Camera;
    private waScaleManager: WaScaleManager;

    private cameraAnimation: CameraAnimation | undefined;
    private zoomAnimation: ZoomAnimation | undefined;

    // Button zoom is kept separate from the regular tween-based zoom so repeated clicks can retarget
    // the current destination without recreating a Phaser tween on every press.
    private buttonZoomAnimation: ZoomAnimation | undefined;
    private smoothButtonZoomStartModifier: number | undefined;
    private smoothButtonZoomTargetModifier: number | undefined;
    private smoothButtonZoomElapsedMs = 0;
    private continuousButtonZoomFactorPerSecond: number | undefined;

    private playerToFollow?: Player | RemotePlayer;
    private zoomLocked: boolean;

    private readonly EDITOR_MODE_SCROLL_SPEED: number = 5;

    private readonly unsubscribeMapEditorModeStore: () => void;

    private _resistanceEndZoomLevel = 0.3;

    // The point of the scene the explorer mode is focusing on.
    private explorerFocusOn: { x: number; y: number } = { x: 0, y: 0 };
    // quanta: the map dragged away from the player; their next step brings the camera back (panBy).
    private panned = false;

    // The tween for the camera offset
    private cameraOffsetCurrentTween?: Tween;

    // The box we should center the camera on (expressed in screen pixels, not game pixels).
    private cameraOffsetBox: Box | undefined;

    // Target follow offset for the camera, expressed in game pixels.
    private targetFollowOffset: { x: number; y: number } | undefined;

    // quanta: set for a room fitted to its window (quanta/roomFit.ts); the frame size it was last fitted to and the
    // map's part of the frame last shown.
    private fittedRoom: { tileWidth: number; key?: string; shown?: string; scale?: number } | undefined;
    // quanta: CSS pixels per map pixel last shown, kept while the window changes; the window insets the camera's
    // bounds use (moving with a glide); the pending glide to the fit and the window it waits on.
    private shownZoom: number | undefined;
    private fitCheckTimer: ReturnType<typeof setTimeout> | undefined;
    private boundsInsets: Insets = NO_INSETS;
    private boundsTarget: Insets = NO_INSETS;
    private refitTimer: ReturnType<typeof setTimeout> | undefined;
    private refitHeldFor: string | undefined;
    // quanta: the person asked for the whole room (menu): shown whole, without filling the window, until the frame resizes.
    private showWhole = false;

    constructor(
        private scene: GameScene,
        private mapSize: { width: number; height: number },
        waScaleManager: WaScaleManager,
    ) {
        super();

        this.camera = scene.cameras.main;
        this.zoomLocked = false;

        this.waScaleManager = waScaleManager;

        this.initCamera();

        this.bindEventHandlers();

        // TODO: we need to improve this with a big derived (a store containing the mapEditorModeStore,
        // one store containing if we are in a focus mode or not (and if we can exit the focus mode by
        // moving the avatar), one listening to the zoom level

        // Subscribe to map editor mode store to change camera bounds when the map editor is opened or closed
        this.unsubscribeMapEditorModeStore = mapEditorModeStore.subscribe((isOpened) => {
            // Define new bounds for camera if the map editor is opened
            if (isOpened) {
                //this.camera.setBounds(0, 0, this.mapSize.width * 2, this.mapSize.height);
                this.camera.setBounds(
                    -this.mapSize.width,
                    -this.mapSize.height,
                    this.mapSize.width * 3,
                    this.mapSize.height * 3,
                );
            } else {
                // We set the bounds back after a call to start following the player
                this.camera.setBounds(0, 0, this.mapSize.width, this.mapSize.height);
                this.updateRoomBounds();
            }
        });

        // Set zoom out to the maximum possible value
        this.waScaleManager.maxZoomOut = this.waScaleManager.getTargetZoomModifierFor(
            this.mapSize.width,
            this.mapSize.height,
        );

        this.scene.game.events.on(WaScaleManagerEvent.ZoomChanged, this.onZoomChanged);
        // quanta: the chat column opening or closing narrows or widens the room's window.
        if (QUANTA_UI) window.addEventListener("quanta-chat-reserve", this.onWindowInsetsChanged);
    }

    private readonly onZoomChanged = (): void => {
        // quanta: a canvas resized before onScreenResized ran (a board opening) is drawn once at the old zoom modifier,
        // which its smaller pixel count scales by another optimal zoom level: a scale nobody chose. The scale to keep is
        // the one shown before the canvas changed.
        if (!this.fittedRoom?.shown || this.fittedRoom.shown === this.shownKey()) {
            this.shownZoom = this.waScaleManager.getActualZoom();
        }
        this.updateRoomBounds();
        this.doUpdateCameraOffset(true);
    };

    /** quanta: shows the room whole and centred in its window, or fills the width on a screen too small for that. */
    public fitRoom(tileWidth: number): void {
        this.fittedRoom = { tileWidth };
        this.refitRoom();
    }

    /** quanta: fits the room again at once when its own window changed size since it was last fitted. */
    public refitRoom(force = false, whole = false): void {
        if (!this.fittedRoom) return;
        const screen = coWebsiteManager.getGameSize();
        if (!screen.width || !screen.height) return;
        const insets = this.windowInsets();
        const key = this.fitKey();
        if (!force && !this.refitTimer && key === this.fittedRoom.key) return;
        this.showWhole = whole;
        this.cancelRefitGlide();
        this.fittedRoom.key = key;
        this.fittedRoom.shown = viewKey(screen, insets);
        this.fittedRoom.scale = this.fitScale();

        this.zoomAnimation?.onInterrupt();
        this.zoomAnimation = undefined;
        this.boundsInsets = insets;
        this.boundsTarget = insets;
        this.waScaleManager.maxZoomOut = this.wholeRoomZoomModifier(screen, insets);
        this.waScaleManager.setZoomModifier(this.fittedZoomModifier(screen), this.camera);
        this.updateRoomBounds();
    }

    /**
     * quanta: the map's part of the frame changed. A board or the chat column opening or closing beside the map keeps
     * the room's on-screen scale (the map shows less or more of it, panning to its new window); only the frame itself
     * changing size refits: the room keeps its scale while the size moves, then glides to the new fit once it has held
     * still for a moment, so a resize is one smooth zoom rather than a jump per frame.
     */
    public onScreenResized(): void {
        this.updateRoomBounds();
        if (!this.fittedRoom) return;
        const screen = coWebsiteManager.getGameSize();
        if (!screen.width || !screen.height) return;
        const insets = this.windowInsets();
        const key = this.fitKey();
        const shown = viewKey(screen, insets);
        const resized = key !== this.fittedRoom.key;
        if (resized) this.showWhole = false;
        if (!resized && !this.refitTimer && shown === this.fittedRoom.shown) return;
        if (this.refitTimer && key === this.refitHeldFor && shown === this.fittedRoom.shown) return;
        const shownZoom = this.shownZoom;
        // Nothing on screen to keep yet, or editing the map: fit straight away.
        if (!this.fittedRoom.key || !shownZoom || get(mapEditorModeStore)) {
            this.refitRoom();
            return;
        }
        this.fittedRoom.shown = shown;
        // The person is zooming: their zoom goes on, in the new window.
        if (this.buttonZoomAnimation) {
            if (resized) this.refitRoom();
            else this.glideBounds(insets);
            return;
        }

        // A glide of the bounds alone may go on; one of the zoom was for the previous window.
        if (!this.zoomAnimation?.boundsOnly) {
            // Cut short, it leaves the room between two scales: the next settle glides to the fit, however near the
            // last one, rather than keeping the room cropped or shrunk.
            if (this.zoomAnimation) this.fittedRoom.scale = undefined;
            this.zoomAnimation?.onInterrupt();
            this.zoomAnimation = undefined;
        }
        const keep = this.zoomModifierForScale(screen, shownZoom);
        this.waScaleManager.maxZoomOut = Math.min(this.wholeRoomZoomModifier(screen, insets), keep);
        if (!resized && !this.refitTimer) {
            this.waScaleManager.setZoomModifier(keep, this.camera);
            this.glideBounds(insets);
            return;
        }
        this.zoomAnimation?.onInterrupt();
        this.zoomAnimation = undefined;
        this.waScaleManager.setZoomModifier(keep, this.camera, true);
        this.updateRoomBounds();
        this.refitHeldFor = key;
        if (this.refitTimer) clearTimeout(this.refitTimer);
        this.refitTimer = setTimeout(() => this.glideToFit(), REFIT_SETTLE_MS);
    }

    private readonly onWindowInsetsChanged = (): void => this.onScreenResized();

    private glideToFit(): void {
        this.refitTimer = undefined;
        this.refitHeldFor = undefined;
        if (!this.fittedRoom) return;
        const screen = coWebsiteManager.getGameSize();
        if (!screen.width || !screen.height) return;
        const insets = this.windowInsets();
        this.fittedRoom.key = this.fitKey();
        this.fittedRoom.shown = viewKey(screen, insets);
        // The person took the zoom into their own hands meanwhile.
        if (this.buttonZoomAnimation) return;
        const scale = this.fitScale();
        // Against what is drawn now, not the last fit worked out: steps of a pane's resize can leave the zoom between
        // two fits (a glide cut short, a step's own refit), and only the room as drawn says whether it is right.
        const drawn = this.waScaleManager.zoomModifier;
        const fitted = this.fittedZoomModifier(screen);
        this.checkFitAfterGlide();
        if (drawn && Math.abs(fitted / drawn - 1) < REFIT_HYSTERESIS) {
            // Kept while the frame moved, drawn for an animation: drawn at rest again, only the bounds gliding.
            this.waScaleManager.setZoomModifier(this.waScaleManager.zoomModifier, this.camera, false);
            this.glideBounds(insets);
            return;
        }
        this.fittedRoom.scale = scale;
        this.glide(this.fittedZoomModifier(screen), insets, this.wholeRoomZoomModifier(screen, insets));
    }

    /**
     * quanta: once the glide has had its time, a pane that changed again meanwhile without telling (the frame's last
     * step, the side column's reserve arriving after it) is fitted again: nothing is left waiting for another change.
     */
    private checkFitAfterGlide(): void {
        if (this.fitCheckTimer) clearTimeout(this.fitCheckTimer);
        this.fitCheckTimer = setTimeout(() => {
            this.fitCheckTimer = undefined;
            if (!this.fittedRoom || this.refitTimer || this.buttonZoomAnimation) return;
            if (this.fitKey() !== this.fittedRoom.key || this.shownKey() !== this.fittedRoom.shown)
                this.onScreenResized();
        }, REFIT_GLIDE_MS + REFIT_SETTLE_MS);
    }

    /** quanta: the camera's bounds move to a new window without a jump, the zoom staying as it is. */
    private glideBounds(insets: Insets): void {
        const screen = coWebsiteManager.getGameSize();
        if (sameInsets(insets, this.boundsTarget)) {
            this.updateRoomBounds();
            return;
        }
        if (this.buttonZoomAnimation) {
            this.boundsInsets = insets;
            this.boundsTarget = insets;
            this.updateRoomBounds();
            return;
        }
        this.glide(
            this.waScaleManager.zoomModifier,
            insets,
            Math.min(this.wholeRoomZoomModifier(screen, insets), this.waScaleManager.zoomModifier),
        );
    }

    /** quanta: the zoom moves by a constant ratio per step to `target`, and the room's window to `insets`. */
    private glide(target: number, insets: Insets, maxZoomOut: number): void {
        const from = this.waScaleManager.zoomModifier;
        const fromInsets = { ...this.boundsInsets };
        this.boundsTarget = insets;
        this.zoomAnimation?.onInterrupt();
        this.waScaleManager.maxZoomOut = Math.min(maxZoomOut, target, from);
        const zooming = Math.abs(target / from - 1) > 0.001;
        const tween = this.scene.tweens.addCounter({
            from: 0,
            to: 1,
            duration: REFIT_GLIDE_MS,
            ease: Easing.CubicEaseOut,
            onUpdate: (t: Tween) => {
                const progress = t.getValue() ?? 0;
                this.boundsInsets = mixInsets(fromInsets, insets, progress);
                if (zooming) {
                    this.waScaleManager.setZoomModifier(from * Math.pow(target / from, progress), this.camera, true);
                }
                this.updateRoomBounds();
            },
            onComplete: () => {
                this.zoomAnimation = undefined;
                this.boundsInsets = insets;
                this.waScaleManager.maxZoomOut = maxZoomOut;
                if (zooming) this.waScaleManager.setZoomModifier(target, this.camera, false);
                this.updateRoomBounds();
            },
        });
        this.zoomAnimation = {
            boundsOnly: !zooming,
            onInterrupt: () => {
                tween.stop();
                tween.destroy();
                this.boundsInsets = insets;
                this.waScaleManager.maxZoomOut = maxZoomOut;
            },
        };
    }

    private cancelRefitGlide(): void {
        if (this.fitCheckTimer) clearTimeout(this.fitCheckTimer);
        this.fitCheckTimer = undefined;
        if (this.refitTimer) clearTimeout(this.refitTimer);
        this.refitTimer = undefined;
        this.refitHeldFor = undefined;
    }

    private shownKey(): string {
        return viewKey(coWebsiteManager.getGameSize(), this.windowInsets());
    }

    private windowInsets(): Insets {
        return QUANTA_UI ? roomWindowInsets() : NO_INSETS;
    }

    /**
     * quanta: the room's own window, which its fit is for: the whole frame, without a board or the chat beside it, and
     * without what the open side column adds to it beside the page.
     */
    private fitWindow(): { screen: Size; insets: Insets } {
        return {
            screen: {
                width: Math.max(1, window.innerWidth - sideColumnFrameShare()),
                height: window.innerHeight,
            },
            // Layout A's rail stands beside the room for good (unlike the chat column, which opens over it): the room
            // fits the space left of it.
            insets: QUANTA_UI ? withRoomMargin(roomWindowInsets(railLayout() ? chatColumnWidth() : 0, 0)) : NO_INSETS,
        };
    }

    private fitKey(): string {
        const { screen, insets } = this.fitWindow();
        return viewKey(screen, insets);
    }

    /** The zoom modifier showing `scale` CSS pixels per map pixel on a canvas of `screen` CSS pixels. */
    private zoomModifierForScale(screen: Size, scale: number): number {
        return this.waScaleManager.getTargetZoomModifierFor(screen.width / scale, screen.height / scale);
    }

    /** The zoom modifier at which the whole room fits its window: as far out as zooming goes. */
    private wholeRoomZoomModifier(screen: Size, insets: Insets): number {
        const view = windowView(this.mapSize, screen, withRoomMargin(insets));
        return this.waScaleManager.getTargetZoomModifierFor(view.width, view.height);
    }

    private fittedZoomModifier(screen: Size): number {
        if (!this.fittedRoom) return this.waScaleManager.zoomModifier;
        return this.zoomModifierForScale(screen, this.fitScale());
    }

    /** quanta: the room's on-screen scale fitted to its own window. */
    private fitScale(): number {
        if (!this.fittedRoom) return 0;
        const fit = this.fitWindow();
        return roomFitScale(
            fit.screen,
            fit.insets,
            this.mapSize,
            this.fittedRoom.tileWidth,
            touchScreenManager.primaryTouchDevice,
            // Layout A: the whole room beside the rail, so its two sides show alike.
            !this.showWhole && !railLayout(),
        );
    }

    /** quanta: a room smaller than its window sits in the window's middle rather than in the top-left corner. */
    private updateRoomBounds(): void {
        if ((!QUANTA_UI && !this.fittedRoom) || get(mapEditorModeStore)) return;
        const seen = { width: this.camera.width / this.camera.zoom, height: this.camera.height / this.camera.zoom };
        const screen = coWebsiteManager.getGameSize();
        // Window insets are CSS pixels; the bounds are map pixels.
        const perCssPixel = screen.width ? seen.width / screen.width : 0;
        const insets = this.fittedRoom ? this.boundsInsets : this.windowInsets();
        const bounds = roomBounds(this.mapSize, seen, {
            top: insets.top * perCssPixel,
            right: insets.right * perCssPixel,
            bottom: insets.bottom * perCssPixel,
            left: insets.left * perCssPixel,
        });
        this.camera.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
        this.scene.markDirty();
    }

    public destroy(): void {
        if (QUANTA_UI) window.removeEventListener("quanta-chat-reserve", this.onWindowInsetsChanged);
        this.cancelRefitGlide();
        this.cancelOffsetTween();
        this.zoomAnimation?.onInterrupt();
        this.zoomAnimation = undefined;
        this.scene.game.events.off(WaScaleManagerEvent.ZoomChanged, this.onZoomChanged);

        this.scene.game.events.off(WaScaleManagerEvent.RefreshFocusOnTarget);
        this.camera.off("followupdate", this.onFollowUpdate);
        this.off(CameraManagerEvent.CameraUpdate, this.onCameraUpdate);
        this.unsubscribeMapEditorModeStore();
        super.destroy();
    }

    public getCamera(): Camera {
        return this.camera;
    }

    private animateToFocus(
        target: Character | { x: number; y: number },
        duration: number,
        callback?: () => void,
    ): void {
        this.cameraAnimation?.onInterrupt();

        if (duration === 0) {
            this.camera.startFollow(target, true, 1, 1, this.camera.followOffset.x, this.camera.followOffset.y);
            callback?.();
            this.setFollowMode();
        }

        const origin = {
            x: this.camera.scrollX + this.camera.width / 2 + this.camera.followOffset.x,
            y: this.camera.scrollY + this.camera.height / 2 + this.camera.followOffset.y,
        };
        this.explorerFocusOn = { ...origin };

        this.camera.startFollow(
            this.explorerFocusOn,
            true,
            1,
            1,
            this.camera.followOffset.x,
            this.camera.followOffset.y,
        );

        // Note: if duration = 0, the addCounter onUpdate is directly triggered to the "1" progress value.
        const followTween = this.scene.tweens.addCounter({
            from: 0,
            to: 1,
            duration,
            ease: Easing.SineEaseOut,
            onUpdate: (tween: Tween) => {
                const progress = tween.getValue() ?? 0;
                const shiftX = (target.x - origin.x) * progress;
                const shiftY = (target.y - origin.y) * progress;
                this.explorerFocusOn.x = origin.x + shiftX;
                this.explorerFocusOn.y = origin.y + shiftY;

                this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
            },
            onComplete: () => {
                this.camera.startFollow(target, true, 1, 1, this.camera.followOffset.x, this.camera.followOffset.y);
                callback?.();
                this.setFollowMode();
            },
        });

        this.cameraAnimation = {
            type: "focus",
            onInterrupt: () => {
                followTween.stop();
                followTween.destroy();
            },
        };
    }

    /**
     * Set camera view to specific destination without changing current camera mode.
     * @param setTo Viewport on which the camera should set the position
     * @param duration Time for the transition im MS. If set to 0, transition will occur immediately
     */
    public setPosition(setTo: WaScaleManagerFocusTarget, duration = 1000): void {
        this.waScaleManager.saveZoom();
        this.camera.stopFollow();

        const currentZoomModifier = this.waScaleManager.zoomModifier;
        const zoomModifierChange = this.getZoomModifierChange(setTo.width, setTo.height);

        this.animateToFocus(setTo, duration, () => {});
        this.animateToZoomLevel(currentZoomModifier + zoomModifierChange, duration);

        this.playerToFollow?.once(hasMovedEventName, () => {
            if (this.playerToFollow) {
                this.startFollowPlayer(this.playerToFollow, duration);
            }
        });
    }

    /**
     * Set camera to focus mode. As long as the camera is in the Focus mode, its view cannot be changed.
     */
    public enterFocusMode(focusOn: WaScaleManagerFocusTarget, margin = 0, duration = 1000): void {
        this.waScaleManager.saveZoom();
        this.waScaleManager.setFocusTarget(focusOn);

        this.zoomLocked = false;

        //Set the camera to focus on the given point
        const focusPoint = {
            x: focusOn.x,
            y: focusOn.y,
        };

        const currentZoomModifier = this.waScaleManager.zoomModifier;
        const zoomModifierChange = this.getZoomModifierChange(focusOn.width, focusOn.height, 1 + margin);

        this.animateToFocus(focusPoint, duration, () => {});
        this.animateToZoomLevel(currentZoomModifier + zoomModifierChange, duration);
    }

    public followPlayerKeepingZoom(player: Player, duration = 0): void {
        this.waScaleManager.setFocusTarget();
        this.startFollowPlayer(player, duration);
        // quanta: in a fitted room, the zoom to keep is the room's fit, whatever a script set just before.
        this.refitRoom(true);
    }

    public leaveFocusMode(player: Player, duration = 0): void {
        this.waScaleManager.setFocusTarget();
        this.startFollowPlayer(player, duration);
        this.restoreZoom(duration);
    }

    public move(moveEvents: ActiveEventList): void {
        let sendViewportUpdate = false;
        if (moveEvents.get(UserInputEvent.MoveUp)) {
            this.explorerFocusOn.y -= this.EDITOR_MODE_SCROLL_SPEED;
            this.explorerFocusOn.y = Clamp(this.explorerFocusOn.y, 0, this.mapSize.height);
            this.scene.markDirty();
            sendViewportUpdate = true;
        } else if (moveEvents.get(UserInputEvent.MoveDown)) {
            this.explorerFocusOn.y += this.EDITOR_MODE_SCROLL_SPEED;
            this.explorerFocusOn.y = Clamp(this.explorerFocusOn.y, 0, this.mapSize.height);
            this.scene.markDirty();
            sendViewportUpdate = true;
        }

        if (moveEvents.get(UserInputEvent.MoveLeft)) {
            this.explorerFocusOn.x -= this.EDITOR_MODE_SCROLL_SPEED;
            this.explorerFocusOn.x = Clamp(this.explorerFocusOn.x, 0, this.mapSize.width);
            this.scene.markDirty();
            sendViewportUpdate = true;
        } else if (moveEvents.get(UserInputEvent.MoveRight)) {
            this.explorerFocusOn.x += this.EDITOR_MODE_SCROLL_SPEED;
            this.explorerFocusOn.x = Clamp(this.explorerFocusOn.x, 0, this.mapSize.width);
            this.scene.markDirty();
            sendViewportUpdate = true;
        }

        if (sendViewportUpdate) {
            this.scene.sendViewportToServer();
        }
    }

    /**
     * quanta: drags the view by `dx`, `dy` screen pixels, off the player: someone can look over the room (a student
     * at their table, the teacher across the class) while they stand still, and the camera returns to them as soon as
     * they move again. The room's bounds stop the view at its edges.
     */
    public panBy(dx: number, dy: number): void {
        if (!this.panned) {
            this.cameraAnimation?.onInterrupt();
            this.cameraAnimation = undefined;
            this.explorerFocusOn = {
                x: this.camera.scrollX + this.camera.width / 2 + this.camera.followOffset.x,
                y: this.camera.scrollY + this.camera.height / 2 + this.camera.followOffset.y,
            };
            this.camera.startFollow(
                this.explorerFocusOn,
                true,
                1,
                1,
                this.camera.followOffset.x,
                this.camera.followOffset.y,
            );
            this.panned = true;
            const player = this.playerToFollow;
            const backOnMove = (event: { moving: boolean }) => {
                if (!event.moving) return;
                player?.off(hasMovedEventName, backOnMove);
                if (!this.panned || this.playerToFollow !== player || !player) return;
                this.panned = false;
                this.startFollowPlayer(player, 300);
            };
            player?.on(hasMovedEventName, backOnMove);
        }
        const zoom = this.camera.zoom || 1;
        const bounds = this.camera.getBounds();
        const halfWidth = this.camera.width / zoom / 2;
        const halfHeight = this.camera.height / zoom / 2;
        // The view's centre (the focus less the follow offset) stays where the bounds let the camera go, so dragging
        // back moves the view at once instead of first undoing a drag past the room's edge.
        const clamp = (value: number, offset: number, from: number, size: number, half: number) => {
            if (!this.camera.useBounds) return value;
            const centre = size > 2 * half ? Clamp(value - offset, from + half, from + size - half) : from + size / 2;
            return centre + offset;
        };
        const offset = this.camera.followOffset;
        this.explorerFocusOn.x = clamp(this.explorerFocusOn.x - dx / zoom, offset.x, bounds.x, bounds.width, halfWidth);
        this.explorerFocusOn.y = clamp(
            this.explorerFocusOn.y - dy / zoom,
            offset.y,
            bounds.y,
            bounds.height,
            halfHeight,
        );
        this.scene.markDirty();
        this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
    }

    public get isPanned(): boolean {
        return this.panned;
    }

    public startFollowPlayer(player: Player | RemotePlayer, duration = 0): void {
        this.panned = false;
        this.playerToFollow = player;

        this.animateToFocus(player, duration, () => {});
        return;
    }

    /**
     * Follow a remote player by their ID. Centers the camera on them and shows a popup.
     */
    public followRemotePlayer(userId: number): void {
        // Find the remote player by UserId
        const remotePlayer = this.scene.MapPlayersByKey.get(userId);

        if (!remotePlayer) {
            console.warn(`Remote player with ID ${userId} not found`);
            return;
        }

        // Restore camera mode
        this.startFollowPlayer(remotePlayer, 1000);
    }

    /**
     * Stop following a remote player.
     */
    public stopFollowRemotePlayer(): void {
        // Start following the current player
        this.startFollowPlayer(this.scene.CurrentPlayer, 1000);
    }

    /**
     * Takes the camera offset box (expressed in screen pixels) and update the targetFollowOffset (expressed in game pixels),
     * according to the current zoom level.
     */
    private updateTargetFollowOffset(): { x: number; y: number } {
        const box = this.cameraOffsetBox;
        if (!box) {
            return this.targetFollowOffset ?? { x: 0, y: 0 };
        }
        const xCenter = (box.xEnd - box.xStart) / 2 + box.xStart;
        const yCenter = (box.yEnd - box.yStart) / 2 + box.yStart;

        const game = HtmlUtils.querySelectorOrFail<HTMLDivElement>("#game");

        // Let's put this in Game coordinates by applying the zoom level:
        this.targetFollowOffset = {
            x: (xCenter - game.offsetWidth / 2) / this.scene.scale.zoom / this.camera.zoom,
            y: (yCenter - game.offsetHeight / 2) / this.scene.scale.zoom / this.camera.zoom,
        };
        return this.targetFollowOffset;
    }

    /**
     * Updates the offset of the character compared to the center of the screen according to the layout manager
     * (tries to put the character in the center of the remaining space if there is a discussion going on).
     */
    public updateCameraOffset(box: Box, instant = false): void {
        if (box.xEnd === undefined || box.yEnd === undefined) {
            return;
        }

        if (
            this.cameraOffsetBox &&
            box.xStart === this.cameraOffsetBox.xStart &&
            box.yStart === this.cameraOffsetBox.yStart &&
            box.xEnd === this.cameraOffsetBox.xEnd &&
            box.yEnd === this.cameraOffsetBox.yEnd
        ) {
            return;
        }

        this.cameraOffsetBox = box;
        this.doUpdateCameraOffset(instant);
    }

    public doUpdateCameraOffset(instant = false): void {
        const targetFollowOffset = this.updateTargetFollowOffset();

        if (instant) {
            if (!this.cameraOffsetCurrentTween) {
                this.camera.setFollowOffset(targetFollowOffset.x, targetFollowOffset.y);
                this.scene.markDirty();
                return;
            } else {
                // If we are requested to update the offset immediately, but we are in the middle of an animation of the offset,
                // let's keep the animation playing and simply update the offset.
                return;
            }
        }

        this.cancelOffsetTween();

        const oldFollowOffsetX = this.camera.followOffset.x;
        const oldFollowOffsetY = this.camera.followOffset.y;

        this.cameraOffsetCurrentTween = this.scene.tweens.addCounter({
            from: 0,
            to: 1,
            duration: 500,
            ease: Easing.QuadEaseOut,
            onUpdate: (tween) => {
                const progress = tween.getValue() ?? 0;
                if (!this.targetFollowOffset) {
                    console.warn("No more target for follow offset during animation");
                    return;
                }
                const newOffsetX = oldFollowOffsetX + (this.targetFollowOffset.x - oldFollowOffsetX) * progress;
                const newOffsetY = oldFollowOffsetY + (this.targetFollowOffset.y - oldFollowOffsetY) * progress;
                this.camera.setFollowOffset(newOffsetX, newOffsetY);
                this.scene.markDirty();
            },
            onComplete: () => {
                this.cameraOffsetCurrentTween = undefined;
            },
        });
    }

    public isZoomLocked(): boolean {
        return this.zoomLocked;
    }

    private getZoomModifierChange(width?: number, height?: number, multiplier = 1): number {
        if (!width || !height) {
            return 0;
        }
        const targetZoomModifier = this.waScaleManager.getTargetZoomModifierFor(
            width * multiplier,
            height * multiplier,
        );
        const currentZoomModifier = this.waScaleManager.zoomModifier;
        return targetZoomModifier - currentZoomModifier;
    }

    /*public defineNewCameraBounds(width: number, height: number): void {
        this.camera.setBounds(-width, -height, width * 3, height * 3, false);
    }*/

    public lockZoom(): void {
        this.zoomLocked = true;
    }

    public unlockZoom(): void {
        this.zoomLocked = false;
    }

    private restoreZoom(duration = 0): void {
        this.animateToZoomLevel(this.waScaleManager.getSaveZoom(), duration);
    }

    private initCamera() {
        this.camera = this.scene.cameras.main;
        this.camera.setBounds(0, 0, this.mapSize.width, this.mapSize.height);
    }

    private onFollowUpdate = () => {
        this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
    };

    private bindEventHandlers(): void {
        this.scene.game.events.on(
            WaScaleManagerEvent.RefreshFocusOnTarget,
            (focusOn: { x: number; y: number; width: number; height: number }) => {
                if (!focusOn) {
                    return;
                }

                this.camera.centerOn(focusOn.x, focusOn.y);

                this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
            },
        );

        this.camera.on("followupdate", this.onFollowUpdate);
        this.on(CameraManagerEvent.CameraUpdate, this.onCameraUpdate);
    }

    private onCameraUpdate = () => {
        this.scene.sendViewportToServer();
    };

    private getCameraUpdateEventData(): CameraManagerEventCameraUpdateData {
        return {
            x: this.camera.worldView.x,
            y: this.camera.worldView.y,
            width: this.camera.worldView.width,
            height: this.camera.worldView.height,
            zoom: this.camera.scaleManager.zoom,
        };
    }

    // Create function to define the camera on exploration mode. The camera can be moved anywhere on the map. The camera is not locked on the player. The camera can be zoomed in and out. The camera can be moved with the mouse. The camera can be moved with the keyboard. The camera can be moved with the touchpad.
    public setExplorationMode(): void {
        this.camera.setFollowOffset(0, 0);

        // this.camera.setBounds(
        //     -this.mapSize.width,
        //     -this.mapSize.height,
        //     this.mapSize.width * 3,
        //     this.mapSize.height * 3,
        //     false
        // );

        this.explorerFocusOn = {
            x: this.camera.scrollX + this.camera.width / 2,
            y: this.camera.scrollY + this.camera.height / 2,
        };
        this.camera.startFollow(this.explorerFocusOn, true);
    }

    public setFollowMode(): void {
        this.scene.reposition();
    }

    private cancelOffsetTween(): void {
        this.stopTween(this.cameraOffsetCurrentTween);
        this.cameraOffsetCurrentTween = undefined;
    }

    private stopTween(tween: Tween | undefined): void {
        if (!tween) {
            return;
        }

        tween.stop();
        tween.destroy();
    }

    public centerCameraOn(position: { x: number; y: number }, zoom?: number): void {
        this.animateToFocus(position, 1000);
        if (zoom) {
            this.animateToZoomLevel(zoom, 1000);
        }
    }

    /**
     * Zooms the camera by a factor passed in parameter.
     */
    public zoomByFactor(zoomFactor: number, duration: number, callback?: () => void): void {
        this.animateToZoomLevel(this.waScaleManager.zoomModifier * zoomFactor, duration, callback);
    }

    /**
     * Applies one Explorer menu click step.
     * If another click arrives while the previous step is still animating, the target is moved again
     * and the animation restarts from the current zoom, which avoids the visible "restart" effect.
     */
    public smoothZoomByFactor(zoomFactor: number): void {
        if (this.isZoomLocked()) {
            return;
        }

        this.smoothButtonZoomTargetModifier = getRetargetedButtonZoomModifier(
            this.waScaleManager.zoomModifier,
            zoomFactor,
            this.smoothButtonZoomTargetModifier,
        );
        this.smoothButtonZoomStartModifier = this.waScaleManager.zoomModifier;
        this.smoothButtonZoomElapsedMs = 0;
        this.continuousButtonZoomFactorPerSecond = undefined;

        if (!this.buttonZoomAnimation) {
            this.zoomAnimation?.onInterrupt();
            this.startButtonZoomAnimation();
        }
    }

    /**
     * Starts long-press zoom. The caller passes a per-second factor so the update loop can remain frame-rate independent.
     */
    public startContinuousZoom(zoomFactorPerSecond: number): void {
        if (this.isZoomLocked()) {
            return;
        }

        this.smoothButtonZoomTargetModifier = undefined;
        this.smoothButtonZoomStartModifier = undefined;
        this.smoothButtonZoomElapsedMs = 0;
        this.continuousButtonZoomFactorPerSecond = zoomFactorPerSecond;

        if (!this.buttonZoomAnimation) {
            this.zoomAnimation?.onInterrupt();
            this.startButtonZoomAnimation();
        }
    }

    /**
     * Ends long-press zoom and asks WaScaleManager to settle outside animation mode.
     * This lets its existing zoom bounds and canvas resize logic finish cleanly.
     */
    public stopContinuousZoom(): void {
        if (this.continuousButtonZoomFactorPerSecond === undefined) {
            return;
        }

        this.waScaleManager.setZoomModifier(this.waScaleManager.zoomModifier, this.camera, false);
        this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
        this.stopButtonZoomAnimation();
    }

    private animateToZoomLevel(targetZoomModifier: number, duration: number, callback?: () => void): void {
        this.zoomAnimation?.onInterrupt();
        const startZoomModifier = this.waScaleManager.zoomModifier;
        const startDate = Date.now();

        const easeAlgo = Easing.QuintEaseOut;

        const zoomTween = this.scene.tweens.addCounter({
            from: startZoomModifier,
            to: targetZoomModifier,
            duration,
            ease: easeAlgo,
            onUpdate: (tween: Tween) => {
                const value = tween.getValue();
                if (value === null) {
                    return;
                }
                this.waScaleManager.setZoomModifier(value, this.camera, true);
                this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
            },
            onComplete: () => {
                this.waScaleManager.setZoomModifier(targetZoomModifier, this.camera, false);
                callback?.();
            },
            onStop: () => {
                // If we are using the trackpad to zoom, we will receive a LOT of calls to
                // animateToZoomLevel. Some calls will even trigger before the first onUpdate. In this case,
                // the tween value is not set at all (0).
                // In this very special case, we want to compute the value of the Tween manually.

                let elapsedTime = Date.now() - startDate;
                if (elapsedTime > duration) {
                    elapsedTime = duration;
                }

                const easeFunction = Phaser.Tweens.Builders.GetEaseFunction(easeAlgo);

                let value;
                if (duration !== 0) {
                    value =
                        easeFunction(elapsedTime / duration) * (targetZoomModifier - startZoomModifier) +
                        startZoomModifier;
                } else {
                    value = targetZoomModifier;
                }
                this.waScaleManager.setZoomModifier(value, this.camera, true);
                this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
            },
        });

        this.zoomAnimation = {
            onInterrupt: () => {
                zoomTween.stop();
                zoomTween.destroy();
            },
        };
    }

    private startButtonZoomAnimation(): void {
        // We drive the button zoom from the scene update event because it handles both click easing
        // and continuous hold zoom with the same cleanup path.
        this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.animateButtonZoom);

        const buttonZoomAnimation: ZoomAnimation = {
            onInterrupt: () => {
                this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.animateButtonZoom);
                this.smoothButtonZoomStartModifier = undefined;
                this.smoothButtonZoomTargetModifier = undefined;
                this.smoothButtonZoomElapsedMs = 0;
                this.continuousButtonZoomFactorPerSecond = undefined;
                this.buttonZoomAnimation = undefined;
                if (this.zoomAnimation === buttonZoomAnimation) {
                    this.zoomAnimation = undefined;
                }
            },
        };

        this.buttonZoomAnimation = buttonZoomAnimation;
        this.zoomAnimation = buttonZoomAnimation;
    }

    private stopButtonZoomAnimation(): void {
        this.buttonZoomAnimation?.onInterrupt();
    }

    private updateButtonZoomModifier(targetZoomModifier: number, animating: boolean): void {
        this.waScaleManager.setZoomModifier(targetZoomModifier, this.camera, animating);
        this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
    }

    private isButtonZoomLimitReached(previousZoomModifier: number, requestedZoomModifier: number): boolean {
        // WaScaleManager clamps by mutating its internal zoom modifier when bounds are reached.
        // Comparing the requested direction with the exposed bound flags tells us when to stop the loop.
        if (requestedZoomModifier > previousZoomModifier && this.waScaleManager.isMaximumZoomInReached) {
            return true;
        }

        if (requestedZoomModifier < previousZoomModifier && this.waScaleManager.isMaximumZoomOutReached) {
            return true;
        }

        return false;
    }

    private readonly animateButtonZoom = (_time: number, delta: number): void => {
        if (this.continuousButtonZoomFactorPerSecond !== undefined) {
            // Long press zoom is multiplicative and frame-rate independent.
            const currentZoomModifier = this.waScaleManager.zoomModifier;
            const targetZoomModifier =
                currentZoomModifier * getContinuousButtonZoomFactor(this.continuousButtonZoomFactorPerSecond, delta);

            this.updateButtonZoomModifier(targetZoomModifier, true);

            if (this.isButtonZoomLimitReached(currentZoomModifier, targetZoomModifier)) {
                this.stopContinuousZoom();
            }
            return;
        }

        // Click zoom uses elapsed time from the last click target change, not only the frame delta.
        // This keeps the easing curve stable even if the browser drops frames.
        const startZoomModifier = this.smoothButtonZoomStartModifier;
        const targetZoomModifier = this.smoothButtonZoomTargetModifier;
        if (startZoomModifier === undefined || targetZoomModifier === undefined) {
            this.stopButtonZoomAnimation();
            return;
        }

        const currentZoomModifier = this.waScaleManager.zoomModifier;
        this.smoothButtonZoomElapsedMs += delta;
        const nextZoomModifier = getSmoothButtonZoomModifier(
            startZoomModifier,
            targetZoomModifier,
            this.smoothButtonZoomElapsedMs,
            SMOOTH_BUTTON_ZOOM_DURATION,
        );

        this.updateButtonZoomModifier(nextZoomModifier, true);

        if (
            this.smoothButtonZoomElapsedMs >= SMOOTH_BUTTON_ZOOM_DURATION ||
            Math.abs(this.waScaleManager.zoomModifier - targetZoomModifier) <= SMOOTH_BUTTON_ZOOM_TARGET_EPSILON ||
            this.isButtonZoomLimitReached(currentZoomModifier, targetZoomModifier)
        ) {
            this.updateButtonZoomModifier(this.waScaleManager.zoomModifier, false);
            this.stopButtonZoomAnimation();
        }
    };

    private animate = (time: number, delta: number): void => {
        const cameraSpeed = this.cameraAnimation;
        if (cameraSpeed?.type !== "speed") {
            console.warn(
                "Camera animation is not in speed mode but animate callback is called. This should not happen.",
            );
            return;
        }

        this.explorerFocusOn.x += (cameraSpeed.speedX * delta) / 400;
        this.explorerFocusOn.y += (cameraSpeed.speedY * delta) / 400;

        this.explorerFocusOn.x = Clamp(this.explorerFocusOn.x, 0, this.mapSize.width);
        this.explorerFocusOn.y = Clamp(this.explorerFocusOn.y, 0, this.mapSize.height);

        // Now, let's slow down the camera a bit
        cameraSpeed.speedX *= 1 - delta / 500;
        cameraSpeed.speedY *= 1 - delta / 500;
        if (Math.pow(cameraSpeed.speedX, 2) + Math.pow(cameraSpeed.speedY, 2) < 20) {
            cameraSpeed.onComplete();
        }

        this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
    };

    get resistanceEndZoomLevel(): number {
        return this._resistanceEndZoomLevel;
    }

    setSpeed(speed: { x: number; y: number }) {
        this.cameraAnimation?.onInterrupt();

        this.cameraAnimation = {
            type: "speed",
            speedX: speed.x,
            speedY: speed.y,
            onComplete: () => {
                this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.animate);
            },
            onInterrupt: () => {
                this.scene.events.off(Phaser.Scenes.Events.UPDATE, this.animate);
            },
        };

        this.scene.events.on(Phaser.Scenes.Events.UPDATE, this.animate);
    }

    stopSpeed() {
        if (this.cameraAnimation?.type === "speed") {
            this.cameraAnimation.onInterrupt();
        }
    }

    scrollCamera(x: number, y: number): void {
        this.explorerFocusOn.x += x;
        this.explorerFocusOn.y += y;

        this.explorerFocusOn.x = Clamp(this.explorerFocusOn.x, 0, this.mapSize.width);
        this.explorerFocusOn.y = Clamp(this.explorerFocusOn.y, 0, this.mapSize.height);

        this.emit(CameraManagerEvent.CameraUpdate, this.getCameraUpdateEventData());
        this.scene.markDirty();
    }

    get playerFollowing(): Player | RemotePlayer | undefined {
        return this.playerToFollow;
    }
}
