import { describe, expect, it } from "vitest";
import { NOT_HEARD_COOLDOWN_MS, NOT_HEARD_HINT_MS, NotHeardHint, SpeechDetector } from "./notHeard";
import { LEVEL_TRACES } from "./notHeard.traces";

const bands = (level: number) => Array.from({ length: 7 }, () => level);
const hits = (levels: readonly number[]) => {
    const detector = new SpeechDetector();
    return levels.filter((level) => detector.sample(bands(level))).length;
};
const firstHit = (levels: readonly number[]) => {
    const detector = new SpeechDetector();
    return levels.findIndex((level) => detector.sample(bands(level)));
};

describe("SpeechDetector on recorded meter traces", () => {
    it.each(["voice-a", "voice-b", "voice-hum", "voice-hiss"] as const)("hears talking: %s", (name) => {
        expect(hits(LEVEL_TRACES[name])).toBeGreaterThan(10);
    });
    it.each(["noise-steady", "noise-white", "noise-fan", "short-burst", "silent", "typing", "typing-soft"] as const)(
        "stays quiet on: %s",
        (name) => {
            expect(hits(LEVEL_TRACES[name])).toBe(0);
        },
    );
    it("stays quiet on a loud burst now and then", () => {
        expect(hits(LEVEL_TRACES.cough)).toBe(0);
    });
    it("takes about two seconds of talking once the meter has settled", () => {
        const talking = [...Array.from({ length: 60 }, () => 12), ...LEVEL_TRACES["voice-b"].slice(30)];
        expect((firstHit(talking) - 60) / 10).toBeLessThan(4);
        expect(firstHit(talking)).toBeGreaterThan(60 + 10);
    });
    it("forgets when the microphone goes", () => {
        const detector = new SpeechDetector();
        for (const level of LEVEL_TRACES["voice-a"]) detector.sample(bands(level));
        expect(detector.sample(undefined)).toBe(false);
        expect(detector.sample(bands(90))).toBe(false);
    });
});

describe("NotHeardHint", () => {
    const memory = () => {
        const data = new Map<string, string>();
        return {
            getItem: (key: string) => data.get(key) ?? null,
            setItem: (key: string, value: string) => {
                data.set(key, value);
            },
        };
    };
    /** Plays the talking trace from `start`, returns when the hint first came up. */
    const talk = (hint: NotHeardHint, start: number) => {
        let now = start;
        for (const level of [...LEVEL_TRACES["voice-a"], ...LEVEL_TRACES["voice-a"]]) {
            now += 100;
            if (hint.update(now, true, bands(level))) return now;
        }
        return undefined;
    };
    const START = 10 * NOT_HEARD_COOLDOWN_MS;

    it("shows for a few seconds and goes by itself", () => {
        const hint = new NotHeardHint(memory());
        const at = talk(hint, START) as number;
        expect(at).toBeDefined();
        expect(hint.update(at + NOT_HEARD_HINT_MS - 100, true, bands(90))).toBe(true);
        expect(hint.update(at + NOT_HEARD_HINT_MS, true, bands(90))).toBe(false);
    });
    it("goes as soon as the person can be heard", () => {
        const hint = new NotHeardHint(memory());
        const at = talk(hint, START) as number;
        expect(hint.update(at + 100, false, bands(90))).toBe(false);
    });
    it("doesn't come back for a few minutes, also after a reload", () => {
        const storage = memory();
        const hint = new NotHeardHint(storage);
        const at = talk(hint, START) as number;
        expect(talk(hint, at + NOT_HEARD_HINT_MS + 1000)).toBeUndefined();
        expect(talk(new NotHeardHint(storage), at + NOT_HEARD_HINT_MS + 1000)).toBeUndefined();
        expect(talk(new NotHeardHint(storage), at + NOT_HEARD_COOLDOWN_MS)).toBeDefined();
    });
    it("a closed hint stays closed", () => {
        const hint = new NotHeardHint(memory());
        const at = talk(hint, START) as number;
        hint.dismiss();
        expect(hint.update(at + 100, true, bands(90))).toBe(false);
    });
    it("never counts while heard", () => {
        const hint = new NotHeardHint(memory());
        let now = START;
        for (const level of LEVEL_TRACES["voice-a"]) expect(hint.update((now += 100), false, bands(level))).toBe(false);
    });
    it("works without storage", () => {
        expect(talk(new NotHeardHint(undefined), START)).toBeDefined();
    });
});
