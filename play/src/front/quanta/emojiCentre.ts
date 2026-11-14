// quanta: colour emoji fonts draw their glyph off the centre of their own line box, each by a different amount (Apple
// Color Emoji about a twelfth of an em high, Noto almost none). Measured once from this browser's emoji font, the offset
// that centres the ink goes in --quanta-emoji-nudge (in em) for the chips that sit an emoji beside text.

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';

export function emojiNudge(metrics: TextMetrics): number {
    const { actualBoundingBoxAscent: ink, actualBoundingBoxDescent: inkBelow } = metrics;
    const { fontBoundingBoxAscent: ascent, fontBoundingBoxDescent: descent } = metrics;
    if (![ink, inkBelow, ascent, descent].every(Number.isFinite) || ascent + descent <= 0) return 0;
    // In a line box centred on its content, the ink's centre sits this far above the box's centre.
    return (ink - inkBelow - (ascent - descent)) / 2;
}

export function startEmojiCentre(): void {
    try {
        const size = 100;
        const context = document.createElement("canvas").getContext("2d");
        if (!context) return;
        context.font = `${size}px ${EMOJI_FONT}`;
        const nudge = emojiNudge(context.measureText("\u{1F600}")) / size;
        // Anything larger is a font without colour emoji, not an offset worth correcting.
        if (Math.abs(nudge) > 0.2) return;
        document.documentElement.style.setProperty("--quanta-emoji-nudge", `${nudge.toFixed(3)}em`);
    } catch (error) {
        console.warn("Emoji centre not measured", error);
    }
}
