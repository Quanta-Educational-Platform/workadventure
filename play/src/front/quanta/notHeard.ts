// quanta: telling someone they are talking and nobody can hear them. Everything here runs on the browser's own volume
// meter (localVolumeStore): loudness only, nothing is kept beyond a few seconds of levels, and nothing is sent.

/** A sample every 100 ms. Long enough for "about two seconds of talking", with the gaps inside speech. */
const WINDOW_SAMPLES = 25;
/** The meter climbs from nothing as a microphone opens: its first seconds look like someone starting to talk. */
const WARM_UP_SAMPLES = 30;
const FLOOR_SAMPLES = 100;
const ABOVE_FLOOR = 18;
const MIN_LEVEL = 20;
/** Steady noise moves the meter by under 10; a voice by 30 and more. */
const MIN_SWING = 24;
/** A level kept up or rising. After a click or a slam the meter only falls, about 6 per sample. */
const HELD_DROP = -3;
const MIN_HELD = 8;
/** Held samples this far apart: a cough or a door is over sooner. */
const MIN_HELD_SPAN = 18;

export const NOT_HEARD_HINT_MS = 8_000;
export const NOT_HEARD_COOLDOWN_MS = 5 * 60_000;
const STORAGE_KEY = "quanta.notHeardHintAt";

function bandLevel(bands: number[]): number {
    return bands.reduce((sum, band) => sum + band, 0) / bands.length;
}

function percentile(values: number[], share: number): number {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
}

/** Whether the last couple of seconds of the meter sound like someone talking, not like a fan, typing or a cough. */
export class SpeechDetector {
    private levels: number[] = [];
    private held: boolean[] = [];
    private warmUp = WARM_UP_SAMPLES;

    reset(): void {
        this.levels = [];
        this.held = [];
        this.warmUp = WARM_UP_SAMPLES;
    }

    sample(bands: number[] | undefined): boolean {
        if (!bands || bands.length === 0) {
            this.reset();
            return false;
        }
        if (this.warmUp > 0) {
            this.warmUp -= 1;
            return false;
        }
        const level = bandLevel(bands);
        const previous = this.levels.at(-1) ?? level;
        this.levels.push(level);
        if (this.levels.length > FLOOR_SAMPLES) this.levels.shift();
        const floor = percentile(this.levels, 0.1);
        this.held.push(level >= floor + ABOVE_FLOOR && level >= MIN_LEVEL && level - previous >= HELD_DROP);
        if (this.held.length > WINDOW_SAMPLES) this.held.shift();
        if (this.levels.length < WINDOW_SAMPLES) return false;

        const recent = this.levels.slice(-WINDOW_SAMPLES);
        if (percentile(recent, 0.9) - percentile(recent, 0.1) < MIN_SWING) return false;
        const count = this.held.filter(Boolean).length;
        return count >= MIN_HELD && this.held.lastIndexOf(true) - this.held.indexOf(true) >= MIN_HELD_SPAN;
    }
}

type HintStorage = Pick<Storage, "getItem" | "setItem">;

/** When the hint shows: once someone unheard has talked, for a few seconds, and not again for a few minutes. */
export class NotHeardHint {
    private readonly speech = new SpeechDetector();
    private shownAt: number | undefined;

    constructor(private readonly storage: HintStorage | undefined) {}

    private lastShown(): number {
        try {
            const value = Number(this.storage?.getItem(STORAGE_KEY));
            return Number.isFinite(value) ? value : 0;
        } catch {
            return 0;
        }
    }

    /** One meter reading; returns whether the hint is up. `unheard`: the microphone is on and nobody can hear it. */
    update(now: number, unheard: boolean, bands: number[] | undefined): boolean {
        if (!unheard) {
            this.speech.reset();
            this.shownAt = undefined;
            return false;
        }
        if (this.shownAt !== undefined) {
            if (now - this.shownAt < NOT_HEARD_HINT_MS) return true;
            this.dismiss();
        }
        if (now - this.lastShown() < NOT_HEARD_COOLDOWN_MS) return false;
        if (!this.speech.sample(bands)) return false;
        this.speech.reset();
        this.shownAt = now;
        try {
            this.storage?.setItem(STORAGE_KEY, String(now));
        } catch {
            // Storage full or blocked: the hint may show again after a reload.
        }
        return true;
    }

    dismiss(): void {
        this.shownAt = undefined;
    }
}
