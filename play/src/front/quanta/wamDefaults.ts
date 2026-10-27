// quanta: the megaphone for a room's teachers (WA tags them `admin`, the Admin API's moderators) in every room,
// unless the room's own settings say otherwise: Quanta's rooms are created without any. Only the front checks
// these settings (WAMSettingsUtils). Written into the room's file as it loads, so everything that reads its
// settings, the map editor's form and later saves included, sees the same values.
import type { WAMFileFormat } from "@workadventure/map-editor";
import { QUANTA_UI } from "../Enum/EnvironmentVariable";

export function applyQuantaWamDefaults(wam: WAMFileFormat): WAMFileFormat {
    if (QUANTA_UI && !wam.settings?.megaphone) {
        wam.settings = {
            ...wam.settings,
            megaphone: { enabled: true, title: "room", scope: "ROOM", rights: ["admin"] },
        };
    }
    return wam;
}
