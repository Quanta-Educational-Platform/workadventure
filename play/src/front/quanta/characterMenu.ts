// quanta: a click on someone's character opens the person menu the call tiles have (PersonMenu.svelte), by the
// character and wholly inside the room's window, instead of WorkAdventure's card at the foot of the screen, whose
// buttons went under the dock. Only someone the viewer has entries for gets a menu (personMenu.ts).
import { get, readable } from "svelte/store";
import type { SpaceUserExtended } from "../Space/SpaceInterface";
import { mediaSynchronizedSpacesStore, raisedHandSectionsStore } from "../Stores/PeerStore";
import { showFloatingUi } from "../Utils/svelte-floatingui-show";
import { gameManager } from "../Phaser/Game/GameManager";
import PersonMenu from "./PersonMenu.svelte";
import { roomModerationStore } from "./moderationBridge";
import { personMenuItems } from "./personMenu";
import { roomWindowRect } from "./roomWindow";
import { mayBlockOrReport, staffTarget } from "./staffTargets";

export interface MapPerson {
    userUuid: string;
    playerName: string;
    /** Where the character is drawn, in screen pixels. */
    screenBounds(): DOMRect;
}

/** The person as the call's spaces know them; someone in none of them, by what the map knows. */
function spaceUserOf(person: MapPerson): SpaceUserExtended {
    const spaces = [
        ...get(mediaSynchronizedSpacesStore),
        ...get(raisedHandSectionsStore).map((section) => section.space),
    ];
    for (const space of spaces) {
        for (const user of get(space.usersStore).values()) if (user.uuid === person.userUuid) return user;
    }
    return {
        uuid: person.userUuid,
        name: person.playerName,
        spaceUserId: "",
        tags: [],
        space: {
            canAskToMuteAudioOrTurnOffVideo: readable(false),
            getName: () => "",
            filterType: undefined,
            emitPublicMessage: () => {},
        },
    } as unknown as SpaceUserExtended;
}

let open: { uuid: string; close: () => void } | undefined;
let closedAt: { uuid: string; at: number } | undefined;

/** Closes the menu if it is this person's (they left, or the viewer walked away from them). */
export function closeCharacterMenu(uuid: string): void {
    if (open?.uuid === uuid) open.close();
}

/** Whether they run the room: the room's list or their space's tags, else the room's user list; unknown, staff. */
async function staffOf(uuid: string, spaceUser: SpaceUserExtended): Promise<boolean> {
    const known =
        get(roomModerationStore)?.people.find((entry) => entry.id === uuid)?.staff ?? staffTarget(uuid, spaceUser.tags);
    if (known !== undefined) return known;
    try {
        const merger = await Promise.race([
            gameManager.getCurrentGameScene().userProviderMerger,
            new Promise<undefined>((resolve) => {
                setTimeout(() => resolve(undefined), 500);
            }),
        ]);
        for (const { users } of merger ? get(merger.usersByRoomStore).values() : []) {
            const user = users.find((candidate) => candidate.uuid === uuid);
            if (user?.isAdmin !== undefined) return user.isAdmin;
        }
    } catch {
        // No scene or user list: as unknown.
    }
    return true;
}

let opening = false;

export function toggleCharacterMenu(person: MapPerson): void {
    // The click on the character that closed its menu (a click outside it) doesn't open it again.
    if (opening || (closedAt?.uuid === person.userUuid && performance.now() - closedAt.at < 400)) return;
    if (open) {
        const same = open.uuid === person.userUuid;
        open.close();
        if (same) return;
    }
    const spaceUser = spaceUserOf(person);
    opening = true;
    staffOf(person.userUuid, spaceUser)
        .then((targetStaff) => openMenu(person, spaceUser, targetStaff))
        .catch((error: unknown) => console.error(error))
        .finally(() => (opening = false));
}

function openMenu(person: MapPerson, spaceUser: SpaceUserExtended, targetStaff: boolean): void {
    const room = get(roomModerationStore);
    const items = personMenuItems({
        viewerStaff: room?.canModerate === true,
        targetStaff,
        self: !!room && room.self === person.userUuid,
        canGoTo: true,
        canMessage: true,
        mayLetSpeak: false,
        speaking: false,
        canLetDraw: false,
        drawing: false,
        canTurnOffCamera: true,
        chatMuted: false,
        mayReport: mayBlockOrReport({ uuid: person.userUuid }),
    });
    if (items.length === 0) return;

    // An anchor over the character where it stands now; the menu doesn't follow a walk.
    const bounds = person.screenBounds();
    const anchor = document.createElement("div");
    Object.assign(anchor.style, {
        position: "fixed",
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        pointerEvents: "none",
    });
    anchor.dataset.testid = "character-menu-anchor";
    document.body.appendChild(anchor);

    const uuid = person.userUuid;
    let close: () => void = () => {};
    const done = () => {
        anchor.remove();
        if (open?.close === close) open = undefined;
        closedAt = { uuid, at: performance.now() };
    };
    close = showFloatingUi(
        anchor,
        // @ts-ignore See https://github.com/storybookjs/storybook/issues/21884
        PersonMenu,
        { spaceUser, videoEnabled: false, fromMap: true, targetStaff, onClose: () => close() },
        { placement: "top" },
        8,
        false,
        true,
        done,
        3000,
        12,
        roomWindowRect,
    );
    open = { uuid, close };
}
