import type { Subscription } from "rxjs";
import type { SpaceUser } from "@workadventure/messages";
import { FilterType } from "@workadventure/messages";
import type { SpaceState } from "@workadventure/shared-utils";
import { asError } from "catch-unknown";
import { MODERATION_ADMINS_ONLY } from "../Enum/EnvironmentVariable";
import { redisHandsStore, type HandsStore, type SavedHands } from "../Services/QuantaHandsStore";
import type { SpaceStateHost } from "./SpaceStateHost";
import type { Space } from "./Space";
import { isAdmin } from "./SpaceStateHost";

export type RaiseHandHost = SpaceStateHost & Pick<Space, "name" | "userAdded$" | "getAllUsers">;

/** quanta: someone who leaves with a hand up or the floor gets them back on rejoining within this. */
export const HAND_REJOIN_MS = 5 * 60 * 1000;
type Away = { hand?: { name: string; at: number }; floor?: { name: string }; leftAt: number };

/**
 * Owns the `raisedHands` queue and the `floorHolders` list of a space's state.
 *
 * The queue is kept in the order hands were raised, which IS the order the front displays. `floorHolders` only
 * ever lists users who were GIVEN the floor after raising their hand, never the original speakers, so the host
 * panel can offer taking the floor back.
 *
 * quanta: both are kept by account in Redis (QuantaHandsStore). A restart drops everyone at once and gives them new
 * spaceUserIds when they rejoin: whoever comes back within HAND_REJOIN_MS gets their place in the queue, or the
 * floor, again. A leave remembers them; only their own or a moderator's action forgets them.
 */
export class RaiseHandManager {
    private readonly subscriptions: Subscription[];
    // By account: who left holding a hand or the floor, and may come back for them.
    private readonly away = new Map<string, Away>();
    // Accounts that raised, lowered or were moderated before the saved queue was read: the saved state is older.
    private readonly decided = new Set<string>();
    private loaded = false;
    private unsaved = false;
    private destroyed = false;

    constructor(
        private readonly space: RaiseHandHost,
        private readonly store: HandsStore = redisHandsStore,
    ) {
        this.subscriptions = [
            // A user who leaves must not keep a ghost entry in the queue, nor in the host's "take back" panel.
            space.userRemoved$.subscribe((user) => {
                const state = this.space.getState();
                const hand = state.raisedHands.find((entry) => entry.spaceUserId === user.spaceUserId);
                const floor = state.floorHolders.find((entry) => entry.spaceUserId === user.spaceUserId);
                if (user.uuid && (hand || floor))
                    this.away.set(user.uuid, {
                        hand: hand && { name: hand.name, at: hand.at },
                        floor: floor && { name: floor.name },
                        leftAt: Date.now(),
                    });
                this.space.updateState((state) => {
                    removeEntry(state.raisedHands, user.spaceUserId);
                    removeEntry(state.floorHolders, user.spaceUserId);
                });
                // The same account still here (a takeover by another tab) keeps them at once.
                const twin = user.uuid
                    ? this.space
                          .getAllUsers()
                          .find((other) => other.uuid === user.uuid && other.spaceUserId !== user.spaceUserId)
                    : undefined;
                if (twin) this.welcomeBack(twin);
                else if (hand || floor) this.persist();
            }),
            space.userAdded$.subscribe((user) => this.welcomeBack(user)),
            // A floor holder who stops streaming (leaves the stage, loses the stream...) no longer holds the floor,
            // whether or not their own client hands it back. Only on the true -> false transition: right after
            // giveFloor, the holder is not streaming YET.
            space.userUpdated$.subscribe(({ user, previous }) => {
                if (!previous.megaphoneState || user.megaphoneState) {
                    return;
                }
                const before = this.space.getState().floorHolders.length;
                this.space.updateState((state) => {
                    removeEntry(state.floorHolders, user.spaceUserId);
                });
                if (this.space.getState().floorHolders.length !== before) this.persist();
            }),
        ];
        this.store
            .load(space.name)
            .catch((error: unknown) => {
                console.warn("Raised hands could not be restored", asError(error).message);
                return undefined;
            })
            .then((saved) => this.restore(saved))
            .catch((error: unknown) => console.warn("Raised hands could not be restored", asError(error).message));
    }

    /** Raises or lowers the sender's own hand. */
    public raiseHand(sender: SpaceUser, raised: boolean): void {
        this.decide(sender.uuid);
        this.space.updateState((state) => {
            if (!raised) {
                removeEntry(state.raisedHands, sender.spaceUserId);
            } else if (!state.raisedHands.some((entry) => entry.spaceUserId === sender.spaceUserId)) {
                state.raisedHands.push({ spaceUserId: sender.spaceUserId, name: sender.name, at: Date.now() });
            }
        });
        this.persist();
    }

    public lowerHand(sender: SpaceUser, targetSpaceUserId: string): void {
        this.assertCanModerate(sender);
        this.decide(this.space.getUser(targetSpaceUserId)?.uuid);
        this.space.updateState((state) => {
            removeEntry(state.raisedHands, targetSpaceUserId);
        });
        this.persist();
    }

    public giveFloor(sender: SpaceUser, targetSpaceUserId: string): void {
        this.assertCanModerate(sender);
        const target = this.space.getUser(targetSpaceUserId);
        if (!target) {
            throw new Error(`User ${targetSpaceUserId} is not in the space`);
        }
        this.decide(target.uuid);
        this.space.updateState((state) => {
            removeEntry(state.raisedHands, target.spaceUserId);
            // In a proximity (ALL_USERS) space everyone already speaks: there is no floor to hold.
            if (
                this.space.filterType !== FilterType.ALL_USERS &&
                !state.floorHolders.some((entry) => entry.spaceUserId === target.spaceUserId)
            ) {
                state.floorHolders.push({ spaceUserId: target.spaceUserId, name: target.name });
            }
        });
        this.persist();
    }

    public revokeFloor(sender: SpaceUser, targetSpaceUserId: string): void {
        // A floor holder may always hand the floor back themselves.
        if (targetSpaceUserId !== sender.spaceUserId) {
            this.assertCanModerate(sender);
        }
        this.decide(this.space.getUser(targetSpaceUserId)?.uuid);
        this.space.updateState((state) => {
            removeEntry(state.floorHolders, targetSpaceUserId);
        });
        this.persist();
    }

    public destroy(): void {
        this.destroyed = true;
        this.subscriptions.forEach((subscription) => subscription.unsubscribe());
    }

    private decide(uuid: string | undefined): void {
        if (!uuid) return;
        this.away.delete(uuid);
        if (!this.loaded) this.decided.add(uuid);
    }

    /** Takes in the saved queue: the people here get their place back now, the others when they rejoin. */
    private restore(saved: SavedHands | undefined): void {
        if (this.destroyed) return;
        this.loaded = true;
        const now = Date.now();
        // A restart leaves its people's entries without a leave time: they left when it happened.
        for (const hand of saved?.hands ?? []) {
            if (this.decided.has(hand.uuid) || this.away.has(hand.uuid)) continue;
            this.away.set(hand.uuid, { hand: { name: hand.name, at: hand.at }, leftAt: hand.leftAt ?? now });
        }
        for (const floor of saved?.floor ?? []) {
            if (this.decided.has(floor.uuid)) continue;
            const away = this.away.get(floor.uuid);
            if (away && !away.floor) away.floor = { name: floor.name };
            else if (!away) this.away.set(floor.uuid, { floor: { name: floor.name }, leftAt: floor.leftAt ?? now });
        }
        this.decided.clear();
        for (const user of this.space.getAllUsers()) this.welcomeBack(user, false);
        if (this.unsaved) this.persist();
    }

    private welcomeBack(user: SpaceUser, save = true): void {
        const away = user.uuid ? this.away.get(user.uuid) : undefined;
        if (!away) return;
        this.away.delete(user.uuid);
        if (Date.now() - away.leftAt > HAND_REJOIN_MS) {
            if (save) this.persist();
            return;
        }
        this.space.updateState((state) => {
            if (away.hand && !state.raisedHands.some((entry) => entry.spaceUserId === user.spaceUserId)) {
                // Back in the place the hand went up in.
                const at = away.hand.at;
                const index = state.raisedHands.findIndex((entry) => entry.at > at);
                const entry = { spaceUserId: user.spaceUserId, name: user.name, at };
                if (index === -1) state.raisedHands.push(entry);
                else state.raisedHands.splice(index, 0, entry);
            }
            if (
                away.floor &&
                this.space.filterType !== FilterType.ALL_USERS &&
                !state.floorHolders.some((entry) => entry.spaceUserId === user.spaceUserId)
            )
                state.floorHolders.push({ spaceUserId: user.spaceUserId, name: user.name });
        });
        if (save) this.persist();
    }

    private persist(): void {
        if (this.destroyed) return;
        if (!this.loaded) {
            this.unsaved = true;
            return;
        }
        this.unsaved = false;
        const now = Date.now();
        const saved: SavedHands = { hands: [], floor: [] };
        const state = this.space.getState();
        const uuids = new Map(this.space.getAllUsers().map((user) => [user.spaceUserId, user.uuid]));
        for (const entry of state.raisedHands) {
            const uuid = uuids.get(entry.spaceUserId);
            if (uuid) saved.hands.push({ uuid, name: entry.name, at: entry.at });
        }
        for (const entry of state.floorHolders) {
            const uuid = uuids.get(entry.spaceUserId);
            if (uuid) saved.floor.push({ uuid, name: entry.name });
        }
        for (const [uuid, away] of this.away) {
            if (now - away.leftAt > HAND_REJOIN_MS) {
                this.away.delete(uuid);
                continue;
            }
            if (away.hand) saved.hands.push({ uuid, ...away.hand, leftAt: away.leftAt });
            if (away.floor) saved.floor.push({ uuid, ...away.floor, leftAt: away.leftAt });
        }
        saved.hands.sort((a, b) => a.at - b.at);
        this.store.save(this.space.name, saved);
    }

    /**
     * Admins always moderate. In a proximity (ALL_USERS) space anyone may: whoever leads the discussion hands the
     * floor around. In a broadcast space only speakers may, and not a guest who was only given the floor.
     * quanta: with MODERATION_ADMINS_ONLY, only admins, wherever.
     */
    private assertCanModerate(sender: SpaceUser): void {
        if (isAdmin(sender)) {
            return;
        }
        if (MODERATION_ADMINS_ONLY) {
            throw new Error("Only an admin can manage the floor");
        }
        if (this.space.filterType === FilterType.ALL_USERS) {
            return;
        }
        const isPromotedGuest = this.space
            .getState()
            .floorHolders.some((entry) => entry.spaceUserId === sender.spaceUserId);
        if (sender.megaphoneState && !isPromotedGuest) {
            return;
        }
        throw new Error("Only a speaker or an admin can manage the floor");
    }
}

function removeEntry(list: SpaceState["raisedHands"] | SpaceState["floorHolders"], spaceUserId: string): void {
    const index = list.findIndex((entry) => entry.spaceUserId === spaceUserId);
    if (index !== -1) {
        list.splice(index, 1);
    }
}
