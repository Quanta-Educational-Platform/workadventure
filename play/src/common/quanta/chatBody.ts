// The message box is contenteditable, so a typed body is HTML: spaces arrive as &nbsp; and line breaks as <br>,
// or as empty <div>s when a keyboard inserts its own line.
const BREAK = /<br\s*\/?>/gi;
const EMPTY_TAG = /<\/?(?:div|p|span)(?:\s[^>]*)?>/gi;
const SPACE_ENTITY = /&(?:nbsp|#160|#x0*a0);/gi;
const INVISIBLE = /[\u200b-\u200d\u2060\ufeff]/g;

/** True when a body has nothing to read once its markup, spaces and line breaks are gone. */
export function isBlankChatBody(body: string): boolean {
    return (
        body
            .replace(BREAK, "")
            .replace(EMPTY_TAG, "")
            .replace(SPACE_ENTITY, " ")
            .replace(INVISIBLE, "")
            .trim() === ""
    );
}

/** The message box's HTML as a body to send: line breaks as newlines, without blank lines or spaces around it. */
export function chatBodyFromInput(html: string): string {
    return html
        .replace(BREAK, "\n")
        .replace(/^(?:\s|&nbsp;)+|(?:\s|&nbsp;)+$/gi, "");
}

/** Plain text (the direct messages' textarea) as a body, written the way the class chat's box writes it: its <, > and &
 *  as entities, so they read as typed. */
export function chatBodyFromText(text: string): string {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** A body back as plain text, to edit it in a textarea. */
export function chatTextFromBody(body: string): string {
    return body
        .replace(BREAK, "\n")
        .replace(SPACE_ENTITY, " ")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0*39;/g, "'")
        .replace(/&amp;/g, "&");
}

/** A sent body back in the message box, to edit it: its newlines as the box's line breaks. */
export function chatInputFromBody(body: string): string {
    return body.replace(/\n/g, "<br>");
}

const wordChar = /^[\p{L}\p{N}_]/u;
/** A body as the text its "@Name"s are read in: plain, with no-break spaces as spaces. */
export function mentionText(body: string): string {
    return chatTextFromBody(body).replace(/ /g, " ");
}
/** True when the text names someone as "@Name" on its own: not inside a word, and not the start of a longer one. */
export function namesMention(text: string, name: string): boolean {
    const at = `@${name}`;
    for (let index = text.indexOf(at); index >= 0; index = text.indexOf(at, index + 1)) {
        const before = index === 0 ? "" : text[index - 1];
        if (!wordChar.test(before) && !wordChar.test(text.slice(index + at.length))) return true;
    }
    return false;
}
