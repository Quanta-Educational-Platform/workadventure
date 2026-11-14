// quanta: the room server's own screens (pusher quanta/roomModeration.ts) come with a code, and their words are the
// reader's language rather than the server's English.
import type { QLStrings } from "./i18n";

export interface RoomScreenText {
    title: string;
    subtitle: string;
    buttonTitle?: string;
}

export function roomScreenText(code: string | undefined, ql: QLStrings): RoomScreenText | undefined {
    if (code === "ROOM_OPENED_ELSEWHERE")
        return {
            title: ql.openedElsewhereTitle(),
            subtitle: ql.openedElsewhereSubtitle(),
            buttonTitle: ql.openedElsewhereButton(),
        };
    if (code === "ROOM_REMOVED") return { title: ql.removedTitle(), subtitle: ql.removedSubtitle() };
    // Shown only when reloading by itself didn't bring the new build (quanta/versionReload.ts).
    if (code === "NEW_VERSION")
        return {
            title: ql.roomUpdatedTitle(),
            subtitle: ql.roomUpdatedSubtitle(),
            buttonTitle: ql.roomUpdatedButton(),
        };
    return undefined;
}
