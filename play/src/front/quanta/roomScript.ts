// quanta: a map names Quanta's room script on the Quanta its template was uploaded to, which need not be the one
// this server works for (DEV's rooms share PROD's templates). The script talks to the Quanta it is served from, so it
// is loaded from this server's own Quanta (QUANTA_URL) instead.
import { QUANTA_URL } from "../Enum/EnvironmentVariable";

const ROOM_SCRIPT_PATH = "/wa/quanta-button.js";
const QUANTA_HOST = /(^|\.)(quanta|qed|neoed)\.world$/;

export function quantaRoomScript(url: string): string {
    if (!QUANTA_URL) return url;
    try {
        const script = new URL(url);
        if (script.pathname !== ROOM_SCRIPT_PATH || !QUANTA_HOST.test(script.hostname)) return url;
        return new URL(script.pathname + script.search, QUANTA_URL).toString();
    } catch {
        return url;
    }
}
