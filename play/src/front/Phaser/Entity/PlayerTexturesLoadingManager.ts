import * as Phaser from "phaser";
import { CancelablePromise } from "cancelable-promise";
import { asError } from "catch-unknown";
import type { SuperLoaderPlugin } from "../Services/SuperLoaderPlugin";
import type { GameScene } from "../Game/GameScene";
import { PlayerTexturesKey } from "./PlayerTextures";
import type { WokaTextureDescriptionInterface, PlayerTextures } from "./PlayerTextures";
import { bakedTextureList, wokaBaker } from "./WokaBaker";

import Texture = Phaser.Textures.Texture;
import LoaderPlugin = Phaser.Loader.LoaderPlugin;

export interface FrameConfig {
    frameWidth: number;
    frameHeight: number;
}

export const loadAllLayers = (
    load: LoaderPlugin,
    playerTextures: PlayerTextures,
): WokaTextureDescriptionInterface[][] => {
    const returnArray: WokaTextureDescriptionInterface[][] = [];
    playerTextures.getLayers().forEach((layer) => {
        const layerArray: WokaTextureDescriptionInterface[] = [];
        Object.values(layer).forEach((textureDescriptor) => {
            layerArray.push(textureDescriptor);
            if (!textureDescriptor.url) {
                console.warn("Player resource has no URL", textureDescriptor);
                return;
            }
            load.spritesheet(textureDescriptor.id, textureDescriptor.url, { frameWidth: 32, frameHeight: 32 });
        });
        returnArray.push(layerArray);
    });
    return returnArray;
};
export const loadAllDefaultModels = (
    load: LoaderPlugin,
    playerTextures: PlayerTextures,
): WokaTextureDescriptionInterface[] => {
    const returnArray = Object.values(playerTextures.getTexturesResources(PlayerTexturesKey.Woka));
    returnArray.forEach((playerResource: WokaTextureDescriptionInterface) => {
        if (!playerResource.url) {
            console.warn("Player resource has no URL", playerResource);
            return;
        }
        load.spritesheet(playerResource.id, playerResource.url, { frameWidth: 32, frameHeight: 32 });
    });
    return returnArray;
};

export const loadWokaTexture = (
    superLoaderPlugin: SuperLoaderPlugin,
    texture: WokaTextureDescriptionInterface,
): CancelablePromise<Texture> => {
    return superLoaderPlugin.spritesheet(texture.id, texture.url, {
        frameWidth: 32,
        frameHeight: 32,
    });
};

export const lazyLoadPlayerCharacterTextures = (
    superLoaderPlugin: SuperLoaderPlugin,
    textures: WokaTextureDescriptionInterface[],
): CancelablePromise<string[]> => {
    const promisesList: CancelablePromise<Texture>[] = [];
    for (const texture of textures) {
        promisesList.push(
            superLoaderPlugin.spritesheet(texture.id, texture.url, {
                frameWidth: 32,
                frameHeight: 32,
            }),
        );
    }
    const returnPromise: CancelablePromise<Texture[]> = CancelablePromise.all(promisesList);

    return returnPromise.then(() =>
        textures.map((key) => {
            return key.id;
        }),
    );
};

/**
 * quanta: a woka's textures for the map: its look baked into one sheet (WokaBaker.ts), held until the woka showing it
 * goes; or a texture per layer, as before, where baking is off or the look cannot be baked.
 */
export const loadPlayerCharacterTextures = (
    scene: GameScene,
    textures: WokaTextureDescriptionInterface[],
): CancelablePromise<string[]> => {
    const lease = wokaBaker.lease(scene.game, textures, () => scene.markDirty());
    if (!lease) return lazyLoadPlayerCharacterTextures(scene.superLoad, textures);
    return new CancelablePromise<string[]>((resolve, reject, onCancel) => {
        let cancelled = false;
        let layered: CancelablePromise<string[]> | undefined;
        onCancel(() => {
            cancelled = true;
            lease.dropIfUnadopted();
            layered?.cancel();
        });
        lease
            .whenReady()
            .then(() => resolve(bakedTextureList(lease)))
            .catch((e: unknown) => {
                lease.release();
                if (cancelled) return;
                console.warn("quanta: woka drawn by layers, not baked", asError(e).message);
                layered = lazyLoadPlayerCharacterTextures(scene.superLoad, textures);
                layered.then(resolve, reject);
            });
    });
};
