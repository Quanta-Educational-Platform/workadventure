import { readable } from "svelte/store";
import { describe, expect, it } from "vitest";
import type { MenuItem } from "../Stores/MenuStore";
import { menuPage, type MenuPageSources } from "./settingsMenuPages";
import { menuTab, menuTabKey } from "./settingsTab";

const visible = readable(true);
const translated = (key: string) => ({ type: "translated", key, visible }) as MenuItem;
const scripting = (key: string) => ({ type: "scripting", key, label: "Room rules", visible }) as MenuItem;

const sources = (overrides: Partial<MenuPageSources> = {}): MenuPageSources => ({
    customFrames: new Map([["rules", { url: "https://maps.example/rules.html", allowApi: true, allow: "fullscreen" }]]),
    profileUrl: () => "https://pusher.example/profile-callback",
    contactUrl: undefined,
    reportUrl: undefined,
    ...overrides,
});

describe("menuPage", () => {
    it("shows the map credits and the chat page in the dialog itself", () => {
        expect(menuPage(translated("credit"), sources())).toEqual({ kind: "credit" });
        expect(menuPage(translated("chat"), sources())).toEqual({ kind: "chat" });
    });

    it("shows a room script's page as a website, with the script's own permissions", () => {
        expect(menuPage(scripting("rules"), sources())).toEqual({
            kind: "frame",
            src: "https://maps.example/rules.html",
            allowApi: true,
            allow: "fullscreen",
        });
    });

    it("runs a room script's plain command instead of showing a page", () => {
        expect(menuPage(scripting("wave"), sources())).toEqual({ kind: "command" });
    });

    it("shows the profile, contact and report pages as websites", () => {
        expect(menuPage(translated("profile"), sources())).toEqual({
            kind: "frame",
            src: "https://pusher.example/profile-callback",
            allowApi: true,
            allow: undefined,
        });
        expect(menuPage(translated("contact"), sources({ contactUrl: "https://help.example" }))).toEqual({
            kind: "frame",
            src: "https://help.example",
            allowApi: false,
            allow: "clipboard-read; clipboard-write self https://help.example",
        });
        expect(menuPage(translated("report"), sources({ reportUrl: "https://report.example" }))).toMatchObject({
            kind: "frame",
            src: "https://report.example",
        });
    });

    it("has no page for a website that isn't configured, nor for the settings' own tabs", () => {
        expect(menuPage(translated("contact"), sources())).toBeUndefined();
        expect(menuPage(translated("report"), sources())).toBeUndefined();
        for (const key of ["settings", "shortcuts", "globalMessages", "help"]) {
            expect(menuPage(translated(key), sources())).toBeUndefined();
        }
    });
});

describe("menu tabs", () => {
    it("round-trip a menu key, and leave the settings' own tabs alone", () => {
        expect(menuTabKey(menuTab("credit"))).toBe("credit");
        expect(menuTabKey(menuTab("menu:odd"))).toBe("menu:odd");
        expect(menuTabKey("audio")).toBeUndefined();
    });
});
