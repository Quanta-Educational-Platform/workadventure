import { describe, expect, it, vi } from "vitest";
import { get, writable } from "svelte/store";

const locale = vi.hoisted(() => ({ store: undefined as undefined | ReturnType<typeof writable<string>> }));
vi.mock("../../i18n/i18n-svelte", async () => {
    const { writable } = await import("svelte/store");
    locale.store = writable("uk-UA");
    return { locale: locale.store };
});
import { QL } from "./i18n";
import { roomScreenText } from "./roomScreens";

describe("roomScreenText", () => {
    it("words the room server's screens in the reader's language", () => {
        locale.store?.set("uk-UA");
        expect(roomScreenText("ROOM_OPENED_ELSEWHERE", get(QL))).toEqual({
            title: "Ви відкрили цю кімнату в іншому місці",
            subtitle: "Ви в кімнаті в іншій вкладці чи на іншому пристрої, тож тут її закрито.",
            buttonTitle: "Продовжити тут",
        });
        expect(roomScreenText("ROOM_REMOVED", get(QL))?.title).toBe("Вчитель видалив вас із кімнати");
        locale.store?.set("de-DE");
        expect(roomScreenText("ROOM_REMOVED", get(QL))?.title).toBe("Von der Lehrkraft entfernt");
        locale.store?.set("en-US");
        expect(roomScreenText("ROOM_OPENED_ELSEWHERE", get(QL))?.buttonTitle).toBe("Use here");
        // A language without these words falls back to English.
        locale.store?.set("ja-JP");
        expect(roomScreenText("ROOM_REMOVED", get(QL))?.subtitle).toBe(
            "Ask the teacher to let you back into this room.",
        );
    });

    it("words the new-build screen", () => {
        locale.store?.set("uk-UA");
        expect(roomScreenText("NEW_VERSION", get(QL))).toEqual({
            title: "Кімнату оновлено",
            subtitle: "Перезавантажте сторінку, щоб продовжити.",
            buttonTitle: "Перезавантажити",
        });
        locale.store?.set("de-DE");
        expect(roomScreenText("NEW_VERSION", get(QL))?.buttonTitle).toBe("Neu laden");
        locale.store?.set("en-US");
        expect(roomScreenText("NEW_VERSION", get(QL))?.subtitle).toBe("Reload the page to continue.");
    });

    it("leaves every other screen as the server words it", () => {
        expect(roomScreenText("WORLD_FULL", get(QL))).toBeUndefined();
        expect(roomScreenText(undefined, get(QL))).toBeUndefined();
    });
});
