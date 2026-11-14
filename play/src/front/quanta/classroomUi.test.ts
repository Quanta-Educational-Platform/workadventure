import { describe, expect, it } from "vitest";
import {
    followEntryVisible,
    lockEntryVisible,
    mapEditorEntryVisible,
    mapExplorerEntryVisible,
    profileMenuEntryVisible,
    type ProfileMenuEntry,
    emojiPanelPadding,
} from "./classroomUi";

describe("classroom UI entries", () => {
    it("shows the map editor only to admins in the Quanta UI", () => {
        expect(mapEditorEntryVisible(true, true, true)).toBe(true);
        expect(mapEditorEntryVisible(true, true, false)).toBe(false);
        expect(mapEditorEntryVisible(true, false, true)).toBe(false);
    });

    it("keeps upstream map editor rules without the Quanta UI", () => {
        expect(mapEditorEntryVisible(false, true, false)).toBe(true);
        expect(mapEditorEntryVisible(false, false, true)).toBe(false);
    });

    it("shows Explore only to admins in the Quanta UI, and only when the map allows it", () => {
        expect(mapExplorerEntryVisible(true, true, true)).toBe(true);
        expect(mapExplorerEntryVisible(true, true, false)).toBe(false);
        expect(mapExplorerEntryVisible(true, false, true)).toBe(false);
        expect(mapExplorerEntryVisible(false, true, false)).toBe(true);
    });

    it("offers no 'Ask to follow' in the Quanta UI, but keeps 'Stop following' while following", () => {
        expect(followEntryVisible(true, true, false)).toBe(false);
        expect(followEntryVisible(true, true, true)).toBe(true);
        expect(followEntryVisible(false, true, false)).toBe(true);
        expect(followEntryVisible(false, false, false)).toBe(false);
    });

    const entries: ProfileMenuEntry[] = [
        "status",
        "name",
        "avatar",
        "companion",
        "issueReport",
        "settings",
        "apps",
        "recording",
        "rightBar",
        "installApp",
    ];

    it("keeps only the avatar and the settings in the Quanta UI's ⋮ menu", () => {
        expect(entries.filter((entry) => profileMenuEntryVisible(true, entry))).toEqual(["avatar", "settings"]);
    });

    it("keeps every upstream ⋮ entry without the Quanta UI", () => {
        expect(entries.filter((entry) => profileMenuEntryVisible(false, entry))).toEqual(entries);
    });

    it("never shows an entry its own conditions hide", () => {
        expect(profileMenuEntryVisible(true, "avatar", false)).toBe(false);
        expect(profileMenuEntryVisible(false, "installApp", false)).toBe(false);
        expect(profileMenuEntryVisible(false, "name", true)).toBe(true);
    });

    it("offers no lock in the Quanta UI, but keeps the entry while something is locked", () => {
        expect(lockEntryVisible(true, true, false)).toBe(false);
        expect(lockEntryVisible(true, true, true)).toBe(true);
        expect(lockEntryVisible(true, false, true)).toBe(false);
        expect(lockEntryVisible(false, true, false)).toBe(true);
        expect(lockEntryVisible(false, false, false)).toBe(false);
    });
});

describe("emojiPanelPadding", () => {
    it("clears the zoom column where the frame has room", () => {
        expect(emojiPanelPadding(1440, 416)).toBe(84);
        expect(emojiPanelPadding(584, 416)).toBe(84);
    });
    it("keeps the panel whole in a narrow frame", () => {
        expect(emojiPanelPadding(440, 416)).toBe(12);
        expect(emojiPanelPadding(420, 404)).toBe(8);
    });
    it("never goes under the smallest margin", () => {
        expect(emojiPanelPadding(320, 304)).toBe(8);
        expect(emojiPanelPadding(320, 416)).toBe(8);
    });
});
