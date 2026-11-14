// quanta: map tags stand next to each other at the desks, so they carry a short form of the name.
const WORD_MAX = 14;

function capped(word: string): string {
    const chars = [...word];
    return chars.length > WORD_MAX ? `${chars.slice(0, WORD_MAX).join("")}…` : word;
}

/** Capitals take far more width, and a name typed all in capitals says nothing more than the same name without. */
function withoutShouting(name: string): string {
    if (name.length < 4 || name !== name.toUpperCase() || name === name.toLowerCase()) return name;
    return name.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, gap: string, letter: string) => gap + letter.toUpperCase());
}

/** "ROSTYSLAV ISHCHENKO" to "Rostyslav I.": the first word and the last word's initial. */
export function nameTag(name: string): string {
    const words = withoutShouting(name.trim()).split(/\s+/);
    const first = capped(words[0] ?? "");
    const last = words.length > 1 ? words[words.length - 1] : undefined;
    const initial = last ? [...last][0] : undefined;
    return initial ? `${first} ${initial.toUpperCase()}.` : first;
}
