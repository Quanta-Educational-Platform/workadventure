// quanta: the megaphone for a room's teachers (WA tags them `admin`, the Admin API's moderators) in every room,
// unless the room's own settings say otherwise: Quanta's rooms are created without any. Only the front checks
// these settings (WAMSettingsUtils), so a default here is the whole switch.
import type { WAMSettings } from "@workadventure/map-editor";
import { QUANTA_UI } from "../Enum/EnvironmentVariable";

export function withQuantaWamDefaults(settings: WAMSettings | undefined): WAMSettings | undefined {
    if (!QUANTA_UI || settings?.megaphone) return settings;
    return { ...settings, megaphone: { enabled: true, title: "room", scope: "ROOM", rights: ["admin"] } };
}
