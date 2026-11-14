import type { Subscription } from "rxjs";
import type { RoomConnection } from "../../Connection/RoomConnection";
import { QUANTA_UI } from "../../Enum/EnvironmentVariable";
import { offerHint } from "../../quanta/dockHints";
import type { GameScene } from "./GameScene";

export class EmoteManager {
    private subscription: Subscription;

    constructor(
        private scene: GameScene,
        private connection: RoomConnection,
    ) {
        this.subscription = connection.emoteEventMessageStream.subscribe((event) => {
            const actor = this.scene.MapPlayersByKey.get(event.actorUserId);
            if (actor) {
                actor.playEmote(event.emote);
                // quanta: others reacting is when someone who has not found the reactions yet looks for them.
                if (QUANTA_UI) offerHint("reactions");
            }
        });
    }

    destroy() {
        this.subscription.unsubscribe();
    }
}
