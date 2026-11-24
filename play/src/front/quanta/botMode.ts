// quanta: a fake student (DEV dev tools, devBots.ts): the room in that student's own Quanta page, which the person
// running the room opened beside their own (the web app's use-room-dev-bots.ts). Loaded before anything else
// (svelte.ts), so before WA's own modules read storage or the devices, it keeps the bot from touching what belongs to
// the person whose browser it runs in: its storage is its own and in memory (this room's origin is shared with theirs),
// it plays no sound, and its camera, microphone and screen are made up (fakeMedia.ts). It talks to its own page like any
// room. Without the marker, on staging, nothing here does anything.
import { fakeCamera, fakeMicrophone, fakeScreen } from "./fakeMedia";

export const BOT_MARKER = "quanta-bot:";
const STAGING_HOST = "wa-dev.qed.world";

/** The bot's name and user id, from the frame's name (kept across the frame's own reloads); null in every other room. */
export const BOT: { userId: string; name: string } | null = (() => {
    try {
        if (window.location.hostname !== STAGING_HOST) return null;
        if (window.parent === window || !window.name.startsWith(BOT_MARKER)) return null;
        const [userId, ...name] = window.name.slice(BOT_MARKER.length).split(":");
        return { userId, name: decodeURIComponent(name.join(":")) };
    } catch {
        return null;
    }
})();

class MemoryStorage implements Storage {
    private items = new Map<string, string>();
    get length(): number {
        return this.items.size;
    }
    clear(): void {
        this.items.clear();
    }
    getItem(key: string): string | null {
        return this.items.get(key) ?? null;
    }
    key(index: number): string | null {
        return [...this.items.keys()][index] ?? null;
    }
    removeItem(key: string): void {
        this.items.delete(key);
    }
    setItem(key: string, value: string): void {
        this.items.set(key, String(value));
    }
}

if (BOT) {
    // The person's own sign-in, devices and settings stay theirs. Session storage too: same-origin frames in one tab
    // share it, and a code-signed room keeps its token and its code-signed mark there.
    Object.defineProperty(window, "sessionStorage", { configurable: true, value: new MemoryStorage() });
    const storage = new MemoryStorage();
    // Its own devices already chosen: no camera set-up screen on the way in.
    storage.setItem("preferredVideoInputDevice", "quanta-bot-camera");
    storage.setItem("preferredAudioInputDevice", "quanta-bot-mic");
    Object.defineProperty(window, "localStorage", { configurable: true, get: () => storage });
    // Heard and seen only through the room: the bot itself plays nothing.
    const play = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
        this.muted = true;
        this.volume = 0;
        return play.call(this);
    };

    const devices = navigator.mediaDevices;
    if (devices) {
        const named = (track: MediaStreamTrack, label: string) => {
            Object.defineProperty(track, "label", { configurable: true, value: label });
            return track;
        };
        devices.getUserMedia = (constraints?: MediaStreamConstraints) => {
            const stream = new MediaStream();
            if (constraints?.audio)
                for (const track of fakeMicrophone().getAudioTracks()) stream.addTrack(named(track, "Bot microphone"));
            if (constraints?.video)
                for (const track of fakeCamera(BOT.name).getVideoTracks()) stream.addTrack(named(track, "Bot camera"));
            return Promise.resolve(stream);
        };
        devices.getDisplayMedia = () => Promise.resolve(fakeScreen(BOT.name));
        devices.enumerateDevices = () =>
            Promise.resolve([
                { deviceId: "quanta-bot-mic", groupId: "quanta-bot", kind: "audioinput", label: "Bot microphone" },
                { deviceId: "quanta-bot-camera", groupId: "quanta-bot", kind: "videoinput", label: "Bot camera" },
                { deviceId: "quanta-bot-speaker", groupId: "quanta-bot", kind: "audiooutput", label: "Bot speaker" },
            ].map((device) => ({ ...device, toJSON: () => device })) as MediaDeviceInfo[]);
    }
    try {
        const query = navigator.permissions.query.bind(navigator.permissions);
        navigator.permissions.query = (descriptor: PermissionDescriptor) =>
            ["camera", "microphone"].includes(String(descriptor.name))
                ? Promise.resolve({
                      state: "granted",
                      name: descriptor.name,
                      onchange: null,
                      addEventListener: () => {},
                      removeEventListener: () => {},
                      dispatchEvent: () => false,
                  } as unknown as PermissionStatus)
                : query(descriptor);
    } catch {
        // No permissions API: WA asks the devices themselves.
    }
}
