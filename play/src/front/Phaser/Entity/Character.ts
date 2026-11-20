import * as Phaser from "phaser";
import type { Unsubscriber, Readable } from "svelte/store";
import { get, readable } from "svelte/store";
import type { CancelablePromise } from "cancelable-promise";
import type { AvailabilityStatus as AvailabilityStatusType } from "@workadventure/messages";
import { SayMessageType, AvailabilityStatus, PositionMessage_Direction } from "@workadventure/messages";
import { defaultWoka, Deferred, type Movable, type PositionInterface } from "@workadventure/shared-utils";
import { Subject } from "rxjs";
import { asError } from "catch-unknown";
import { currentPlayerWokaStore } from "../../Stores/CurrentPlayerWokaStore";
import type { OutlineableInterface } from "../Game/OutlineableInterface";
import { createColorStore } from "../../Stores/OutlineColorStore";
import type { PictureStore } from "../../Stores/PictureStore";
import { TexturesHelper } from "../Helpers/TexturesHelper";
import type { GameScene } from "../Game/GameScene";
import { Companion } from "../Companion/Companion";
import { CharacterTextureError } from "../../Exception/CharacterTextureError";
import { getPlayerAnimations, PlayerAnimationTypes } from "../Player/Animation";
import {
    getSheetAnimations,
    isSheetFrameCount,
    seatedColumnsOf,
    seatedFrame,
    sheetAnimationKey,
    sliceWokaSheet,
    stillFrame,
} from "../Player/WokaSheet";
import { directionOfFacing, FacingTracker } from "../../quanta/wokaFacing";
import { ProtobufClientUtils } from "../../Network/ProtobufClientUtils";
import { WOKA_SPEED } from "../../Enum/EnvironmentVariable";

import { UsernameDisplay } from "../Components/UsernameDisplay";
import { SIT_MS, STAND_MS, type SeatPlacement } from "../../quanta/seats";
import { lazyLoadPlayerCharacterTextures } from "./PlayerTexturesLoadingManager";
import { SpeechBubble } from "./SpeechBubble";
import { SpeechDomElement } from "./SpeechDomElement";
import { ThinkingCloud } from "./ThinkingCloud";
import { adoptWokaLease } from "./WokaBaker";
import type { WokaLease, WokaLeaseHolder } from "./WokaBaker";

import Container = Phaser.GameObjects.Container;
import RenderTexture = Phaser.GameObjects.RenderTexture;
import DOMElement = Phaser.GameObjects.DOMElement;
import Sprite = Phaser.GameObjects.Sprite;
import Tween = Phaser.Tweens.Tween;
import Circle = Phaser.Geom.Circle;
import Body = Phaser.Physics.Arcade.Body;

const playerNameY = -18;
const interactiveRadius = 25;

export const CHARACTER_BODY_WIDTH = 16;
export const CHARACTER_BODY_HEIGHT = 16;
export const CHARACTER_BODY_OFFSET_X = 0;
export const CHARACTER_BODY_OFFSET_Y = 8;

export const PLAYTEXT_NEW_MEDIA_DEVICE_PREFIX = "playtext-mediadevice-";

export type PathFollowResult = {
    x: number;
    y: number;
    cancelled: boolean;
    /**
     * Set when the path was aborted because its next waypoint started colliding (e.g. an area got locked
     * mid-walk); the character stopped just before the blocking tile.
     */
    blocked?: boolean;
};

/** quanta: how a seated woka's sprites are moved from its position and cut at the legs. */
type SeatOffsets = { x: number; y: number; crop: number };
/** quanta: and which frame they show, mirrored or not. */
type SeatLook = SeatOffsets & { frame: number; flip: boolean };
/** quanta: an old (3 x 4) sheet's standing stills: rows down, left, right, up. */
const OLD_STILL_FRAME: Partial<Record<PositionMessage_Direction, number>> = {
    [PositionMessage_Direction.DOWN]: 1,
    [PositionMessage_Direction.LEFT]: 4,
    [PositionMessage_Direction.RIGHT]: 7,
    [PositionMessage_Direction.UP]: 10,
};

/** quanta: a path walked at `cruise` pixels a second, reaching it and stopping from it over `ramp` seconds. */
export type PathEase = { cruise: number; ramp: number };

/** How far an eased walk of `length` pixels has gone after `t` seconds; past its end, a pixel beyond it. */
function easedDistance({ cruise, ramp, length }: PathEase & { length: number }, t: number): number {
    if (length <= 0) return length + 1;
    const acceleration = cruise / ramp;
    // Too short to reach the cruising pace: speeds up halfway, slows down the rest.
    const rampTime = length < cruise * ramp ? Math.sqrt(length / acceleration) : ramp;
    const top = acceleration * rampTime;
    const cruiseTime = (length - top * rampTime) / top;
    const total = 2 * rampTime + cruiseTime;
    if (t >= total) return length + 1;
    if (t <= rampTime) return (acceleration * t * t) / 2;
    if (t <= rampTime + cruiseTime) return (top * rampTime) / 2 + top * (t - rampTime);
    return length - (acceleration * (total - t) * (total - t)) / 2;
}

export abstract class Character extends Container implements OutlineableInterface, Movable, WokaLeaseHolder {
    private readonly movedSubject = new Subject<PositionInterface>();
    public readonly moved$ = this.movedSubject.asObservable();

    private bubble: RenderTexture | null | DOMElement = null;
    private usernameDisplay: UsernameDisplay | undefined;
    private displayedName: string | undefined;
    private availabilityStatus: AvailabilityStatusType = AvailabilityStatus.ONLINE;
    private raisedHand = false;
    public readonly playerName: string;
    public sprites: Map<string, Sprite>;
    protected _lastDirection: PositionMessage_Direction = PositionMessage_Direction.DOWN;
    //private teleportation: Sprite;
    private invisible: boolean;
    private clickable: boolean;
    public companion?: Companion;
    private emote: DOMElement | null = null;
    private emoteTween: Tween | null = null;
    private texts: Map<string, DOMElement> = new Map();
    private textsToBuild = new Map();
    scene: GameScene;
    private lastRenderedSprite: string | undefined;
    private readonly _pictureStore: Readable<string | undefined>;
    protected readonly outlineColorStore = createColorStore();
    private outlineColorStoreUnsubscribe: Unsubscriber | undefined;
    private texturePromise: CancelablePromise<string[] | void> | undefined;
    private destroyed = false;
    protected pathToFollow?: { x: number; y: number }[];
    protected pathWalkingSpeed?: number;
    /** quanta: a walk that speeds up from a standstill and slows to one (setPathToFollow's `ease`). */
    private pathEase?: PathEase & { length: number; elapsed: number };
    private currentPathSegmentDistanceFromStart = 0;
    private pathFollowingResolve?: (result: PathFollowResult) => void;
    // quanta: the seat it is on (quanta/seats.ts), and how far its sprites are moved and cut at the legs there:
    // eased in on sitting down and out on standing up.
    private seat: SeatPlacement | undefined;
    private seatDrawn: SeatOffsets = { x: 0, y: 0, crop: 0 };
    private seatMotion: Tween | undefined;
    // quanta: true when every layer is a new sheet, with eight facings and seated frames.
    private eightWay = false;
    // quanta: the baked look it shows (WokaBaker.ts), let go when it goes.
    private wokaLease: WokaLease | undefined;
    protected readonly facing = new FacingTracker(PositionMessage_Direction.DOWN);
    private readonly syncDisplayPositionWithPhysics = (): void => {
        this.setDepthIfNeeded(this.y + 16);
        this.updateUsernameDisplayPosition();
    };

    /**
     * A deferred promise that resolves when the texture of the character is actually displayed.
     */
    private textureLoadedDeferred = new Deferred<void>();

    constructor(
        scene: GameScene,
        x: number,
        y: number,
        texturesPromise: CancelablePromise<string[]>,
        name: string,
        direction: PositionMessage_Direction,
        moving: boolean,
        frame: string | number,
        isClickable: boolean,
        companionTexturePromise: CancelablePromise<string> | undefined,
        userId?: string | null,
    ) {
        super(scene, x, y /*, texture, frame*/);
        this.scene = scene;
        this.playerName = name;
        this.invisible = true;
        this.clickable = false;

        this.sprites = new Map<string, Sprite>();

        // Note: the picture store is rarely used because most of the time, we display the character sent in the space
        // by the remote player.
        // The sole place where we need the picture store is when you click on a Woka on the map and want to display
        // the Woka sprite in the popup that opens.
        this._pictureStore = readable<string | undefined>(undefined, (set) => {
            this.waitAndGetSnapshot()
                .then((htmlImageElementSrc) => {
                    set(htmlImageElementSrc);
                })
                .catch((e) => {
                    console.warn(e);
                    set(defaultWoka);
                });
        });

        if (userId != undefined) {
            this.waitAndGetSnapshot()
                .then((htmlImageElementSrc) => {
                    currentPlayerWokaStore.set(htmlImageElementSrc);
                })
                .catch((e) => {
                    console.warn(e);
                    currentPlayerWokaStore.set(defaultWoka);
                });
        }

        //textures are inside a Promise in case they need to be lazyloaded before use.
        this.texturePromise = texturesPromise
            .then((textures) => {
                this.addTextures(textures, frame);
                this.invisible = false;
                this.playAnimation(direction, moving);
                this.textureLoadedDeferred.resolve();
            })
            .catch(() => {
                return lazyLoadPlayerCharacterTextures(scene.superLoad, [
                    {
                        id: "color_22",
                        url: "resources/customisation/character_color/character_color21.png",
                    },
                    {
                        id: "eyes_23",
                        url: "resources/customisation/character_eyes/character_eyes23.png",
                    },
                ])
                    .then((textures) => {
                        this.addTextures(textures, frame);
                        this.invisible = false;
                        this.playAnimation(direction, moving);
                        this.textureLoadedDeferred.resolve();
                    })
                    .catch((e) => {
                        this.textureLoadedDeferred.reject(e);
                        throw e;
                    });
            })
            .finally(() => {
                this.texturePromise = undefined;
            });

        if (companionTexturePromise != undefined) {
            this.addCompanion(companionTexturePromise);
        }

        // We delay the assignment of the text because it can take up to 16ms.
        // If we enter a zone with 100 people, that is a 1.6s freeze.
        // requestAnimationFrame has the priority over setTimeout so the game will keep running smoothly.
        setTimeout(() => {
            if (this.destroyed) {
                // The character has been destroyed before the timeout
                return;
            }

            const playerNameOutlineColor = get(this.outlineColorStore);
            this.usernameDisplay = new UsernameDisplay(
                scene,
                this.x,
                this.y + playerNameY,
                this.displayedName ?? this.playerName,
                playerNameOutlineColor,
            );
            this.usernameDisplay.setAvailabilityStatus(this.availabilityStatus, true);
            this.usernameDisplay.setRaisedHand(this.raisedHand, true);
            this.usernameDisplay.setPlayerDepth(this.depth);

            this.outlineColorStoreUnsubscribe = this.outlineColorStore.subscribe((color) => {
                this.usernameDisplay?.setPlayerNameOutlineColor(color);
                this.scene.markDirty();
            });
            this.scene.markDirty();
        }, 0);

        if (isClickable) {
            this.setInteractive({
                hitArea: new Circle(8, 8, interactiveRadius),
                hitAreaCallback: Circle.Contains, //eslint-disable-line @typescript-eslint/unbound-method
                useHandCursor: true,
            });
        }

        this.setClickable(isClickable);

        scene.add.existing(this);

        this.scene.physics.world.enableBody(this);
        const body = this.getBody();
        body.setImmovable(true);
        body.setCollideWorldBounds(true);
        this.setSize(CHARACTER_BODY_WIDTH, CHARACTER_BODY_HEIGHT);
        body.setSize(CHARACTER_BODY_WIDTH, CHARACTER_BODY_HEIGHT); //edit the hitbox to better match the character model
        body.setOffset(CHARACTER_BODY_OFFSET_X, CHARACTER_BODY_OFFSET_Y);
        this.scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.syncDisplayPositionWithPhysics);
        this.setDepthIfNeeded(this.y + 16);
    }

    private waitAndGetSnapshot(): Promise<string> {
        if (this.lastRenderedSprite) {
            return Promise.resolve(this.lastRenderedSprite);
        }
        return new Promise((resolve) => {
            // getSnapshot can be quite long (~16ms) so we delay it to avoid freezing the game.
            // Since requestAnimationFrame has the priority over setTimeout, the game will keep running smoothly.
            this.textureLoadedDeferred.promise
                .then(() => {
                    setTimeout(() => {
                        this.getSnapshot()
                            .then((htmlImageElementSrc) => {
                                this.lastRenderedSprite = htmlImageElementSrc;
                                resolve(htmlImageElementSrc);
                            })
                            .catch((e) => {
                                console.warn(e);
                                this.lastRenderedSprite = defaultWoka;
                                resolve(defaultWoka);
                            });
                    }, 0);
                })
                .catch((e) => {
                    console.warn(e);
                    this.lastRenderedSprite = defaultWoka;
                    resolve(defaultWoka);
                });
        });
    }

    private setDepthIfNeeded(depth: number): void {
        if (this.depth !== depth) {
            this.setDepth(depth);
            this.usernameDisplay?.setPlayerDepth(depth);
        }
    }

    public setClickable(clickable = true): void {
        if (this.clickable === clickable) {
            return;
        }
        this.clickable = clickable;
        if (clickable) {
            this.setInteractive({
                hitArea: new Circle(8, 8, interactiveRadius),
                hitAreaCallback: Circle.Contains, //eslint-disable-line @typescript-eslint/unbound-method
                useHandCursor: true,
            });
            return;
        }
        this.disableInteractive();
    }

    public isClickable() {
        return this.clickable;
    }

    public getPosition(): PositionInterface {
        return { x: this.x, y: this.y };
    }

    /**
     * Returns position based on where player is currently facing
     * @param shift How far from player should the point of interest be.
     */
    public getDirectionalActivationPosition(shift: number): { x: number; y: number } {
        switch (this._lastDirection) {
            case PositionMessage_Direction.DOWN: {
                return { x: this.x, y: this.y + shift };
            }
            case PositionMessage_Direction.LEFT: {
                return { x: this.x - shift, y: this.y };
            }
            case PositionMessage_Direction.RIGHT: {
                return { x: this.x + shift, y: this.y };
            }
            case PositionMessage_Direction.UP: {
                return { x: this.x, y: this.y - shift };
            }
            case PositionMessage_Direction.UNRECOGNIZED: {
                return { x: this.x, y: this.y };
            }
        }
    }

    private async getSnapshot(): Promise<string> {
        // quanta: a baked look comes with its picture, drawn without the GPU.
        const picture = this.wokaLease?.picture();
        if (picture) return picture;
        const sprites = Array.from(this.sprites.values()).map((sprite) => {
            return { sprite, frame: 1 };
        });
        return TexturesHelper.getSnapshot(this.scene, ...sprites).catch((reason) => {
            console.warn(reason);
            for (const sprite of this.sprites.values()) {
                // we can be sure that either predefined woka or body texture is at this point loaded
                if (sprite.texture.key.includes("color") || sprite.texture.key.includes("male")) {
                    return this.scene.textures.getBase64(sprite.texture.key);
                }
            }
            return "male1";
        });
    }

    /** What the name tag says, when it differs from the name others see (quanta/fullNames.ts). */
    protected setDisplayedName(name: string | undefined): void {
        this.displayedName = name;
        this.usernameDisplay?.setDisplayedName(name ?? this.playerName);
    }

    public toggleTalk(show = true): void {
        this.usernameDisplay?.setTalking(show, this.getAvailabilityStatus() === AvailabilityStatus.SPEAKER);
    }

    public setRaisedHand(raised: boolean): void {
        this.raisedHand = raised;
        this.usernameDisplay?.setRaisedHand(raised);
        this.scene.markDirty();
    }

    public setAvailabilityStatus(availabilityStatus: AvailabilityStatusType, instant = false): void {
        if (availabilityStatus !== AvailabilityStatus.UNCHANGED) {
            this.availabilityStatus = availabilityStatus;
        }
        this.usernameDisplay?.setAvailabilityStatus(availabilityStatus, instant);
    }

    public getAvailabilityStatus() {
        return this.usernameDisplay?.getAvailabilityStatus() ?? this.availabilityStatus;
    }

    public addCompanion(texturePromise: CancelablePromise<string>): void {
        this.companion = new Companion(this.scene, this.x, this.y, texturePromise);
    }

    private addTextures(textures: string[], frame?: string | number): void {
        if (textures.length < 1) {
            throw new CharacterTextureError("No texture given");
        }
        // quanta: a baked look is held from here until this woka is destroyed.
        const lease = adoptWokaLease(textures, this);
        if (lease) this.wokaLease = lease;

        for (const texture of textures) {
            if (this.scene && !this.scene.textures.exists(texture)) {
                throw new CharacterTextureError(`Texture "${texture}" not found`);
            }
            // quanta: a 2x sheet's 64 x 64 frames are drawn at the room's 32 x 32, like every other sheet's.
            const frameSize = sliceWokaSheet(this.scene.textures.get(texture));
            const sprite = new Sprite(this.scene, 0, 0, texture, frame);
            if (frameSize !== 32) sprite.setScale(32 / frameSize);
            this.add(sprite);
            this.createAnimations(texture, sprite);
            // Needed, otherwise, animations are not handled correctly.
            if (this.scene) {
                this.scene.sys.updateList.add(sprite);
            }
            this.sprites.set(texture, sprite);
        }
        this.eightWay = [...this.sprites.values()].every((sprite) =>
            isSheetFrameCount(sprite.texture.getFrameNames().length),
        );
        if (this.seat) {
            // Seated before its sheets arrived: straight into the pose its sheets give.
            const look = this.seatLook(this.seat);
            this.showSeatFrame(look);
            this.seatMotion?.stop();
            this.seatMotion = undefined;
            this.setPosition(this.seat.x, this.seat.y);
            this.seatDrawn = { x: look.x, y: look.y, crop: look.crop };
        }
        this.drawSeatOffsets();
    }

    private createAnimations(texture: string, sprite: Sprite): void {
        const sheet = isSheetFrameCount(sprite.texture.getFrameNames().length);
        [...getPlayerAnimations(texture), ...(sheet ? getSheetAnimations(texture) : [])].forEach((d) => {
            if (!this.scene.anims.exists(d.key)) {
                this.scene.anims.create({
                    key: d.key,
                    frames: this.scene.anims.generateFrameNumbers(d.frameModel, { frames: d.frames }),
                    frameRate: d.frameRate,
                    repeat: d.repeat,
                });
            }
        });
    }

    /**
     * quanta: the same look baked at the room's new density: the sprite keeps its frame, mirror, seat cut and
     * animation, on the new sheet. Everything is checked before the sprite is touched; once it shows `to`, `to` is
     * this woka's and true is returned, even if its animation could not follow.
     */
    public swapWokaLease(from: WokaLease, to: WokaLease): boolean {
        const sprite = this.sprites.get(from.key);
        if (this.destroyed || !this.scene || this.wokaLease !== from || !sprite) return false;
        if (!to.key || to.key === from.key || !this.scene.textures.exists(to.key)) return false;
        const texture = this.scene.textures.get(to.key);
        const frame = sprite.frame.name;
        if (!texture.has(frame)) return false;
        const playing = sprite.anims.isPlaying ? sprite.anims.currentAnim?.key : undefined;

        this.wokaLease = to;
        this.sprites.delete(from.key);
        this.sprites.set(to.key, sprite);
        // A playing animation would put its own (old) texture back on the next step.
        sprite.anims.stop();
        sprite.setTexture(to.key, frame);
        try {
            sprite.setScale(32 / sliceWokaSheet(texture));
            this.createAnimations(to.key, sprite);
            if (playing?.startsWith(from.key + "-")) sprite.play(to.key + playing.slice(from.key.length));
            this.drawSeatOffsets();
        } catch (e) {
            console.warn("quanta: woka look swapped, its animation not", asError(e));
        }
        this.scene.markDirty();
        return true;
    }

    public get seatId(): string | undefined {
        return this.seat?.id;
    }

    /** quanta: still sliding onto its seat. */
    public get seatSettling(): boolean {
        return this.seat !== undefined && this.seatMotion !== undefined;
    }

    /**
     * quanta: sits on a seat, facing its way: on its own seated frame, or, without one, its standing frame cut at the
     * legs. It slides onto the seat's spot and settles into the pose in one short ease.
     */
    public sitOn(seat: SeatPlacement, animate = true): void {
        if (this.isFollowingPath()) this.finishFollowingPath(true);
        this.seat = seat;
        this.getBody().setVelocity(0, 0);
        this._lastDirection = directionOfFacing(seat.facing);
        this.facing.reset(this._lastDirection, seat.facing);
        const look = this.seatLook(seat);
        this.showSeatFrame(look);
        this.easeSeatDrawing({ x: seat.x, y: seat.y }, look, animate ? SIT_MS : 0);
    }

    public standUp(): void {
        if (!this.seat) return;
        this.seat = undefined;
        for (const sprite of this.sprites.values()) sprite.setFlipX(false);
        this.playAnimation(this._lastDirection, false);
        this.easeSeatDrawing(undefined, { x: 0, y: 0, crop: 0 }, STAND_MS);
    }

    private seatLook(seat: SeatPlacement): SeatLook {
        const { frame, standing } = seat.pose;
        if (this.eightWay) {
            const bottom = this.sprites.values().next().value;
            if (bottom && seatedColumnsOf(this.scene.textures, bottom.texture.key) & (1 << frame.column)) {
                return { frame: seatedFrame(frame.column), flip: frame.flip, x: frame.x, y: frame.y, crop: 0 };
            }
            const still = stillFrame(seat.facing);
            return { frame: still, flip: false, x: standing.x, y: standing.y, crop: standing.cropBottom };
        }
        const still = OLD_STILL_FRAME[standing.direction] ?? 1;
        return { frame: still, flip: false, x: standing.x, y: standing.y, crop: standing.cropBottom };
    }

    private showSeatFrame(look: SeatLook): void {
        for (const sprite of this.sprites.values()) {
            sprite.anims?.stop();
            sprite.setFrame(look.frame);
            sprite.setFlipX(look.flip);
        }
    }

    /** The slide onto a seat (`to`) and the sprites' move and cut, eased from where they are now. */
    private easeSeatDrawing(to: { x: number; y: number } | undefined, target: SeatOffsets, duration: number): void {
        this.seatMotion?.stop();
        this.seatMotion = undefined;
        const from = { ...this.seatDrawn };
        const start = { x: this.x, y: this.y };
        const finish = () => {
            this.seatMotion = undefined;
            if (to) this.setPosition(to.x, to.y);
            this.seatDrawn = { x: target.x, y: target.y, crop: target.crop };
            this.drawSeatOffsets();
            // The room draws a frame only while something moves or tweens, and the finished ease has already left the
            // tween list: without this, the last step stays undrawn (on a slow device, the whole slide).
            this.scene.markDirty();
        };
        if (duration <= 0 || this.destroyed) {
            finish();
            return;
        }
        const motion = this.scene.tweens.addCounter({
            from: 0,
            to: 1,
            duration,
            ease: "Cubic.easeOut",
            onUpdate: (tween) => {
                const k = tween.getValue() ?? 1;
                if (to) this.setPosition(start.x + (to.x - start.x) * k, start.y + (to.y - start.y) * k);
                this.seatDrawn = {
                    x: from.x + (target.x - from.x) * k,
                    y: from.y + (target.y - from.y) * k,
                    crop: from.crop + (target.crop - from.crop) * k,
                };
                this.drawSeatOffsets();
            },
            onComplete: () => {
                if (this.seatMotion === motion) finish();
            },
        });
        this.seatMotion = motion;
    }

    private drawSeatOffsets(): void {
        const x = Math.round(this.seatDrawn.x);
        const y = Math.round(this.seatDrawn.y);
        const crop = Math.round(this.seatDrawn.crop);
        for (const sprite of this.sprites.values()) {
            sprite.setPosition(x, y);
            // The cut is in room pixels; the crop is in the sheet's own (two of them a room pixel on a 2x sheet).
            if (crop > 0) sprite.setCrop(0, 0, sprite.width, sprite.height - (crop * sprite.width) / 32);
            else if (sprite.isCropped) sprite.setCrop();
        }
        this.updateUsernameDisplayPosition();
    }

    /** quanta: real movement, from which a woka works out which way it faces: one of eight on a new sheet. */
    protected observeMovement(dx: number, dy: number, smoothingMs?: number): void {
        this.facing.move(dx, dy, this.scene.time.now, smoothingMs);
    }

    protected playAnimation(direction: PositionMessage_Direction, moving: boolean): void {
        if (this.invisible) return;
        if (this.seat) {
            this.showSeatFrame(this.seatLook(this.seat));
            return;
        }
        for (const [texture, sprite] of this.sprites.entries()) {
            if (!sprite.anims) {
                console.error("ANIMS IS NOT DEFINED!!!");
                return;
            }
            if (this.eightWay) {
                const facing = this.facing.shown(direction, moving, this.scene.time.now);
                const type = moving ? PlayerAnimationTypes.Walk : PlayerAnimationTypes.Idle;
                sprite.play(sheetAnimationKey(texture, facing, type), true);
                continue;
            }
            const directionStr = ProtobufClientUtils.toDirectionString(direction);
            if (moving && (!sprite.anims.currentAnim || sprite.anims.currentAnim.key !== directionStr)) {
                sprite.play(texture + "-" + directionStr + "-" + PlayerAnimationTypes.Walk, true);
            } else if (!moving) {
                sprite.anims.play(texture + "-" + directionStr + "-" + PlayerAnimationTypes.Idle, true);
            }
        }
    }

    protected getBody(): Body {
        const body = this.body;
        if (!(body instanceof Body)) {
            throw new Error("Container does not have arcade body");
        }
        return body;
    }

    protected updateUsernameDisplayPosition(x = this.x, y = this.y): void {
        this.usernameDisplay?.setPosition(x, y + playerNameY + Math.round(this.seatDrawn.y));
    }

    setPosition(x: number, y: number): this {
        super.setPosition(Math.round(x), Math.round(y));
        this.setDepth(this.y + 16);
        this.usernameDisplay?.setPlayerDepth(this.depth);
        this.updateUsernameDisplayPosition();
        this.movedSubject?.next({ x: this.x, y: this.y });
        return this;
    }

    stop() {
        this.getBody().setVelocity(0, 0);
        this.playAnimation(this._lastDirection, false);
    }

    protected setPathToFollow(
        path: { x: number; y: number }[],
        speed?: number,
        ease?: PathEase,
    ): Promise<PathFollowResult> {
        const isPreviousPathInProgress = this.isFollowingPath();
        this.pathToFollow = this.adjustPathToColliderBounds(path);
        this.pathToFollow.unshift({ x: this.x, y: this.y });
        this.pathWalkingSpeed = speed;
        this.currentPathSegmentDistanceFromStart = 0;
        this.pathEase = undefined;
        if (ease) {
            let length = 0;
            for (let i = 1; i < this.pathToFollow.length; i++)
                length += Math.hypot(
                    this.pathToFollow[i].x - this.pathToFollow[i - 1].x,
                    this.pathToFollow[i].y - this.pathToFollow[i - 1].y,
                );
            this.pathEase = { ...ease, length, elapsed: 0 };
        }

        return new Promise((resolve) => {
            this.pathFollowingResolve?.call(this, { x: this.x, y: this.y, cancelled: isPreviousPathInProgress });
            this.pathFollowingResolve = resolve;
        });
    }

    public finishFollowingPath(cancelled = false, blocked = false): void {
        this.pathToFollow = undefined;
        this.pathWalkingSpeed = undefined;
        this.pathEase = undefined;
        this.currentPathSegmentDistanceFromStart = 0;
        this.stop();

        const resolve = this.pathFollowingResolve;
        this.pathFollowingResolve = undefined;
        resolve?.({ x: this.x, y: this.y, cancelled, blocked });
    }

    protected isFollowingPath(): boolean {
        return this.pathToFollow !== undefined || this.pathFollowingResolve !== undefined;
    }

    protected getPathWalkingSpeed(): number {
        return this.pathWalkingSpeed ?? WOKA_SPEED;
    }

    /**
     * Called each time a waypoint of the followed path is reached, i.e. on each tile change.
     * Subclasses can abort the path following from here (e.g. when the next waypoint started colliding).
     */
    protected onPathWaypointReached(): void {}

    protected adjustPathToColliderBounds(path: { x: number; y: number }[]): { x: number; y: number }[] {
        const body = this.getBody();
        return path.map((step) => ({
            x: step.x,
            y: step.y - body.height / 2 - body.offset.y,
        }));
    }

    protected followPath(delta: number): void {
        if (this.pathToFollow !== undefined && this.pathToFollow.length === 1) {
            this.finishFollowingPath();
            return;
        }
        if (!this.pathToFollow) {
            return;
        }

        let segmentStartPos = this.pathToFollow[0];
        let segmentEndPos = this.pathToFollow[1];
        let xDistance = segmentEndPos.x - segmentStartPos.x;
        let yDistance = segmentEndPos.y - segmentStartPos.y;
        let pathSegmentLength = Math.sqrt(xDistance * xDistance + yDistance * yDistance);

        if (this.pathEase) {
            const ease = this.pathEase;
            const before = easedDistance(ease, ease.elapsed);
            ease.elapsed += delta / 1000;
            this.currentPathSegmentDistanceFromStart += easedDistance(ease, ease.elapsed) - before;
        } else {
            this.currentPathSegmentDistanceFromStart += (this.getPathWalkingSpeed() * delta * 20) / 1000;
        }

        while (this.currentPathSegmentDistanceFromStart >= pathSegmentLength) {
            this.currentPathSegmentDistanceFromStart -= pathSegmentLength;
            this.pathToFollow.shift();

            if (this.pathToFollow.length === 1) {
                this.setPosition(this.pathToFollow[0].x, this.pathToFollow[0].y);
                this.finishFollowingPath();
                return;
            }

            this.onPathWaypointReached();
            if (!this.pathToFollow) {
                // The hook aborted the path following.
                return;
            }

            segmentStartPos = this.pathToFollow[0];
            segmentEndPos = this.pathToFollow[1];
            xDistance = segmentEndPos.x - segmentStartPos.x;
            yDistance = segmentEndPos.y - segmentStartPos.y;
            pathSegmentLength = Math.sqrt(xDistance * xDistance + yDistance * yDistance);
        }

        const newX =
            segmentStartPos.x +
            (this.currentPathSegmentDistanceFromStart / pathSegmentLength) * (segmentEndPos.x - segmentStartPos.x);
        const newY =
            segmentStartPos.y +
            (this.currentPathSegmentDistanceFromStart / pathSegmentLength) * (segmentEndPos.y - segmentStartPos.y);

        this.moveToPathPosition(newX, newY);
        this.scene.markDirty();
    }

    protected moveToPathPosition(x: number, y: number): void {
        const oldX = this.x;
        const oldY = this.y;
        this.setPosition(x, y);
        // quanta: the facing comes from the smoothed heading, so a path zigzagging between diagonal and straight
        // tiles holds one view, here and on the wire, instead of flipping on every tile.
        if (this.x !== oldX || this.y !== oldY) {
            this.observeMovement(this.x - oldX, this.y - oldY);
            this._lastDirection = directionOfFacing(this.facing.facing);
        }

        this.playAnimation(this._lastDirection, true);
        this.companion?.setTarget(this.x, this.y, this._lastDirection);
    }

    say(text: string, type: SayMessageType) {
        this.scene.markDirty();
        if (this.bubble !== null) {
            this.remove(this.bubble);
            this.bubble.destroy();
        }
        // If text is empty, let's just remove the previous bubble and say nothing.
        if (!text) {
            return;
        }

        switch (type) {
            case SayMessageType.SpeechBubble:
            case SayMessageType.UNRECOGNIZED: {
                const speechBubble = new SpeechBubble(text);
                this.bubble = new DOMElement(
                    this.scene,
                    0,
                    0 - CHARACTER_BODY_HEIGHT / 2 - 50,
                    speechBubble.getElement(),
                );
                this.add(this.bubble);
                break;
            }
            case SayMessageType.ThinkingCloud: {
                const thinkElement = new ThinkingCloud({
                    text: text,
                    maxWidth: 200,
                    fontSize: 11,
                    cornerRadius: 10,
                    padding: 12,
                    fillColor: 0xffffff,
                    fillAlpha: 0.8,
                }).getElement();
                this.bubble = new DOMElement(this.scene, 0, 0 - CHARACTER_BODY_HEIGHT / 2 - 70, thinkElement);
                this.add(this.bubble);
                break;
            }
            default: {
                const _exhaustiveCheck: never = type;
            }
        }
    }

    destroy(): void {
        this.usernameDisplay?.destroy();
        this.seatMotion?.stop();
        this.seatMotion = undefined;
        if (this.scene) {
            this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.syncDisplayPositionWithPhysics);
            for (const sprite of this.sprites.values()) {
                this.scene.sys.updateList.remove(sprite);
            }
        }
        this.texturePromise?.cancel();
        this.list.forEach((objectContaining) => objectContaining.destroy());
        // quanta: after its sprite: the look's texture may go with it.
        this.wokaLease?.release();
        this.wokaLease = undefined;
        this.outlineColorStoreUnsubscribe?.();
        this.destroyed = true;
        super.destroy();
    }

    playEmote(emote: string) {
        this.cancelPreviousEmote();
        const emoteY = -45;
        const span = document.createElement("span");
        // The emote comes from another player: it is plain text (an emoji) and must never be interpreted as HTML.
        span.textContent = emote;
        this.emote = new DOMElement(this.scene, -1, 0, span, "z-index:10;");
        this.emote.setAlpha(0);
        this.add(this.emote);
        this.createStartTransition(emoteY);
    }

    playText(
        id: string,
        text: string,
        duration = 10000,
        callback = () => this.destroyText(id),
        createStackAnimation = true,
        type: "warning" | "message" = "message",
        escapeCallback?: () => void,
    ) {
        if (this.texts.has(id)) {
            this.destroyText(id);
        }
        this.textsToBuild.set(id, { text, duration, callback, type, escapeCallback });

        // If there is already one text created, we don't need to create a stack animation
        if (this.texts.size == 1 && createStackAnimation) {
            this.createStackAnimationForMultiText();
            return;
        }

        const speechDomElement = new SpeechDomElement(
            id,
            text,
            this.scene,
            -1,
            -30 + this.texts.size * 2,
            callback,
            type,
            escapeCallback,
        );
        this.add(speechDomElement);
        this.texts.set(id, speechDomElement);

        let y = -60 + this.texts.size * 2;
        if (escapeCallback !== undefined) {
            y = -70 + this.texts.size * 2;
        }
        speechDomElement.play(-1, y, duration, (id) => {
            this.destroyText(id);
        });
    }

    private createStartTransition(emoteY: number) {
        this.emoteTween = this.scene?.tweens.add({
            targets: this.emote,
            props: {
                alpha: 1,
                y: emoteY,
            },
            ease: "Power2",
            duration: 500,
            onComplete: () => {
                this.startPulseTransition(emoteY);
            },
        });
    }

    private startPulseTransition(emoteY: number) {
        if (this.emote) {
            this.emoteTween = this.scene?.tweens.add({
                targets: this.emote,
                props: {
                    y: emoteY * 1.3,
                    scale: this.emote.scale * 1.1,
                },
                duration: 250,
                yoyo: true,
                repeat: 1,
                completeDelay: 200,
                onComplete: () => {
                    this.startExitTransition(emoteY);
                },
            });
        }
    }

    private startExitTransition(emoteY: number) {
        this.emoteTween = this.scene?.tweens.add({
            targets: this.emote,
            props: {
                alpha: 0,
                y: 2 * emoteY,
            },
            ease: "Power2",
            duration: 500,
            onComplete: () => {
                this.destroyEmote();
            },
        });
    }

    private cancelPreviousEmote() {
        if (!this.emote) return;

        this.emoteTween?.remove();
        this.destroyEmote();
    }

    private destroyEmote() {
        this.emote?.destroy();
        this.emote = null;
    }

    destroyText(id: string) {
        const text = this.texts.get(id);
        text?.destroy();
        this.texts.delete(id);
        this.textsToBuild.delete(id);
    }

    destroyAllText() {
        for (const [id] of this.texts) {
            this.destroyText(id);
        }
    }

    private createStackAnimationForMultiText() {
        // Destroy all texts and recreate them
        this.texts.forEach((text, id) => {
            // Destroy and remove the text from the map
            text.destroy();
            this.texts.delete(id);
        });

        // Recreate all texts in the correct order (from the biggest length to the smallest)
        Array.from(this.textsToBuild.entries())
            .sort((a, b) => a[1].text.length - b[1].text.length)
            .forEach(([id, { text, duration, callback, type = "message", escapeCallback }]) => {
                this.playText(id, text, duration, callback, false, type, escapeCallback);
            });
    }

    public get pictureStore(): PictureStore {
        return this._pictureStore;
    }

    public setFollowOutlineColor(color: number): void {
        this.outlineColorStore.setFollowColor(color);
    }

    public removeFollowOutlineColor(): void {
        this.outlineColorStore.removeFollowColor();
    }

    public setApiOutlineColor(color: number): void {
        this.outlineColorStore.setApiColor(color);
    }

    public removeApiOutlineColor(): void {
        this.outlineColorStore.removeApiColor();
    }

    public pointerOverOutline(color: number): void {
        this.outlineColorStore.pointerOver(color);
        this.usernameDisplay?.setToForeFront(true);
    }

    public pointerOutOutline(): void {
        this.outlineColorStore.pointerOut();
        this.usernameDisplay?.setToForeFront(false);
    }

    public characterCloseByOutline(color: number): void {
        this.outlineColorStore.characterCloseBy(color);
    }

    public characterFarAwayOutline(): void {
        this.outlineColorStore.characterFarAway();
    }

    /**
     * Returns a promise that resolves as soon as a texture is displayed for the user.
     * The promise will return when the required texture is loaded OR when the fallback texture is loaded (in case
     * the required texture could not be loaded).
     */
    public getTextureLoadedPromise(): PromiseLike<void> {
        return this.textureLoadedDeferred.promise;
    }

    public get lastDirection(): PositionMessage_Direction {
        return this._lastDirection;
    }

    public handlePressSpacePlayerTextCallback() {
        for (const [, text] of this.texts) {
            (text as SpeechDomElement).callback();
        }
    }

    /**
     * Dismisses "new media device" prompts without switching devices, and reports each device id for persistence.
     * @returns true if at least one prompt was dismissed.
     */
    public dismissNewMediaDevicePrompts(onIgnoreDeviceId: (deviceId: string) => void): boolean {
        let dismissed = false;
        for (const id of this.texts.keys()) {
            if (!id.startsWith(PLAYTEXT_NEW_MEDIA_DEVICE_PREFIX)) {
                continue;
            }
            const deviceId = id.slice(PLAYTEXT_NEW_MEDIA_DEVICE_PREFIX.length);
            if (deviceId) {
                onIgnoreDeviceId(deviceId);
            }
            this.destroyText(id);
            dismissed = true;
        }
        return dismissed;
    }

    /**
     * Returns the collision rectangle for this character.
     * Uses the physics body dimensions and actual position.
     */
    public getCollisionRectangle(): { x: number; y: number; width: number; height: number } {
        const body = this.getBody();
        // Use body.left and body.top which give the actual world position of the collision box
        return {
            x: body.left,
            y: body.top,
            width: body.width,
            height: body.height,
        };
    }
}
