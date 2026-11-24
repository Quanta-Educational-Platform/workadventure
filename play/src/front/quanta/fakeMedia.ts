// quanta: a fake student's camera, microphone and screen (botMode.ts), drawn and voiced here: a calm picture with the
// bot's initials, a babble that sounds like speech when it talks and is silent when it doesn't, and a slide as its shared
// screen. Cheap on purpose: a few small canvases and one sound graph per bot.

const HUES = [212, 152, 28, 280, 340, 190, 48, 110];
const hueOf = (name: string) => HUES[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % HUES.length];
const initials = (name: string) =>
    name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? "")
        .join("");

function drawn(width: number, height: number, fps: number, draw: (g: CanvasRenderingContext2D, t: number) => void) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const g = canvas.getContext("2d");
    if (!g) return new MediaStream();
    const start = performance.now();
    const paint = () => draw(g, (performance.now() - start) / 1000);
    paint();
    // Timers, not frames: a frame nobody looks at gets no animation frames, and its picture would freeze.
    const timer = setInterval(paint, 1000 / fps);
    const stream = canvas.captureStream(fps);
    for (const track of stream.getTracks()) track.addEventListener("ended", () => clearInterval(timer));
    const stop = MediaStreamTrack.prototype.stop;
    for (const track of stream.getTracks()) {
        track.stop = function () {
            clearInterval(timer);
            stop.call(this);
        };
    }
    return stream;
}

/** A camera: the bot's colour, its initials, and a slow drift so the picture is seen to be live. */
export function fakeCamera(name: string): MediaStream {
    const hue = hueOf(name);
    return drawn(320, 240, 12, (g, t) => {
        const shift = Math.sin(t / 3) * 20;
        const gradient = g.createLinearGradient(0, 0, 320, 240);
        gradient.addColorStop(0, `hsl(${hue} 45% ${38 + shift / 4}%)`);
        gradient.addColorStop(1, `hsl(${hue + 30} 50% ${22 - shift / 6}%)`);
        g.fillStyle = gradient;
        g.fillRect(0, 0, 320, 240);
        g.fillStyle = "rgb(255 255 255 / 0.12)";
        g.beginPath();
        g.arc(160 + Math.sin(t / 2) * 60, 120 + Math.cos(t / 2.6) * 30, 70, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#fff";
        g.font = "600 64px 'Fira Sans', system-ui, sans-serif";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(initials(name), 160, 112);
        g.font = "500 18px 'Fira Sans', system-ui, sans-serif";
        g.fillStyle = "rgb(255 255 255 / 0.8)";
        g.fillText(`${name} · bot`, 160, 190);
    });
}

/** A shared screen: a slide with a sum being worked, its last line changing. */
export function fakeScreen(name: string): MediaStream {
    return drawn(1280, 720, 5, (g, t) => {
        g.fillStyle = "#f7f7f4";
        g.fillRect(0, 0, 1280, 720);
        g.fillStyle = "#1d2027";
        g.font = "600 44px 'Fira Sans', system-ui, sans-serif";
        g.fillText(`${name}'s screen`, 80, 110);
        g.font = "400 36px 'Fira Sans', system-ui, sans-serif";
        g.fillStyle = "#3a3f48";
        g.fillText("2 + 2 + 2 + … + 2 = 16", 80, 240);
        g.fillText("8 × 2 = 16", 80, 310);
        const step = Math.floor(t / 2) % 4;
        g.fillStyle = "#2f6fdb";
        g.fillText(["so there are 8 twos", "check: 8 · 2 = 16 ✓", "a week later: 1 number", "what is it?"][step], 80, 380);
    });
}

type Voice = { stream: MediaStream; talk: (on: boolean) => void; state: () => AudioContextState };
let voice: Voice | null = null;

/**
 * A voice: a buzz through two moving formants, in syllables and pauses, which a room's speech detection takes for
 * someone talking. Silent until told to talk.
 */
function makeVoice(): Voice {
    const context = new AudioContext();
    const destination = context.createMediaStreamDestination();
    const level = context.createGain();
    level.gain.value = 0;
    const glottis = context.createOscillator();
    glottis.type = "sawtooth";
    glottis.frequency.value = 190;
    const formants = [700, 1200].map((frequency) => {
        const filter = context.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = frequency;
        filter.Q.value = 6;
        glottis.connect(filter);
        filter.connect(level);
        return filter;
    });
    level.connect(destination);
    glottis.start();

    let talking = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const syllable = () => {
        if (!talking) return;
        const now = context.currentTime;
        const length = 0.12 + Math.random() * 0.16;
        const pause = Math.random() < 0.2 ? 0.35 + Math.random() * 0.5 : 0.04;
        glottis.frequency.setTargetAtTime(160 + Math.random() * 70, now, 0.03);
        formants[0].frequency.setTargetAtTime(300 + Math.random() * 600, now, 0.03);
        formants[1].frequency.setTargetAtTime(900 + Math.random() * 1500, now, 0.03);
        level.gain.setTargetAtTime(0.9, now, 0.02);
        level.gain.setTargetAtTime(0, now + length, 0.03);
        timer = setTimeout(syllable, (length + pause) * 1000);
    };
    return {
        stream: destination.stream,
        talk: (on) => {
            // A frame made without a click of its own may start suspended.
            void context.resume().catch(() => {});
            if (on === talking) return;
            talking = on;
            clearTimeout(timer);
            if (on) syllable();
            else level.gain.setTargetAtTime(0, context.currentTime, 0.02);
        },
        state: () => context.state,
    };
}

/** The microphone: the voice's track, silent until `fakeTalk(true)`. */
export function fakeMicrophone(): MediaStream {
    voice ??= makeVoice();
    return new MediaStream(voice.stream.getAudioTracks().map((track) => track.clone()));
}

export function fakeTalk(on: boolean): void {
    voice ??= makeVoice();
    voice.talk(on);
}

/** "suspended" while the browser holds the voice back (no click in this page yet): the room hears silence. */
export function fakeVoiceState(): AudioContextState | null {
    return voice?.state() ?? null;
}
