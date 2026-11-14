// quanta: a meeting area closed to some roles (restrictedRightsPropertyData, e.g. a staff room) is closed here too, not
// only in the browser, which a tampered client can skip to join the area's call by name.
import { mapFetcher } from "@workadventure/map-editor/src/MapFetcher";
import { isMapDetailsData } from "@workadventure/messages";
import { slugifyJitsiRoomName } from "@workadventure/shared-utils/src/Jitsi/slugify";
import { adminService } from "../services/AdminService";
import { FRONT_ENVIRONMENT_VARIABLES, INTERNAL_MAP_STORAGE_URL } from "../enums/EnvironmentVariable";

const CACHE_MS = 60_000;

/** Space name (as the front names it) → the tags that may join it. */
type Restricted = Map<string, string[]>;

const cache = new Map<string, { at: number; restricted: Promise<Restricted> }>();

async function load(roomUrl: string): Promise<Restricted> {
    const restricted: Restricted = new Map();
    const details = isMapDetailsData.safeParse(await adminService.fetchMapDetails(roomUrl));
    if (!details.success || !details.data.wamUrl) return restricted;
    const wam = await mapFetcher.fetchWamFile(
        details.data.wamUrl,
        INTERNAL_MAP_STORAGE_URL,
        FRONT_ENVIRONMENT_VARIABLES.PUBLIC_MAP_STORAGE_PREFIX,
    );
    for (const area of wam.areas) {
        let tags: string[] = [];
        for (const property of area.properties) {
            if (property.type === "restrictedRightsPropertyData") tags = [...property.writeTags, ...property.readTags];
        }
        if (tags.length === 0) continue;
        for (const property of area.properties) {
            if (property.type !== "livekitRoomProperty") continue;
            // As AreasPropertiesListener names the area's space.
            const roomId = property.roomName.trim().length === 0 ? property.id : property.roomName;
            restricted.set(slugifyJitsiRoomName(roomId, roomUrl).trim(), tags);
        }
    }
    console.info("[quanta] restricted calls", roomUrl, [...restricted.keys()]);
    return restricted;
}

function restrictedSpaces(roomUrl: string): Promise<Restricted> {
    const hit = cache.get(roomUrl);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.restricted;
    const restricted = load(roomUrl);
    cache.set(roomUrl, { at: Date.now(), restricted });
    // A failed read is not kept: the next join tries again.
    restricted.catch(() => cache.delete(roomUrl));
    return restricted;
}

/**
 * Whether someone with these tags may join this space of this room. Only a space bound to a restricted area is
 * checked. When the map can't be read the join goes ahead (as before this check), so a map-storage hiccup never keeps
 * a class out of its own calls.
 */
export async function mayJoinSpace(roomUrl: string, localSpaceName: string, tags: string[]): Promise<boolean> {
    let restricted: Restricted;
    try {
        restricted = await restrictedSpaces(roomUrl);
    } catch (error) {
        console.warn("[quanta] restricted spaces: map read failed, join allowed", roomUrl, error);
        return true;
    }
    const allowed = restricted.get(localSpaceName);
    if (allowed === undefined || allowed.some((tag) => tags.includes(tag))) return true;
    console.warn("[quanta] restricted call refused", roomUrl, localSpaceName);
    return false;
}
