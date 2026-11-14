import type { MenuItem } from "../Stores/MenuStore";

/** How the settings dialog shows one of WA's other menu pages. */
export type MenuPage =
    | { kind: "credit" }
    | { kind: "chat" }
    | { kind: "frame"; src: string; allowApi: boolean; allow: string | undefined }
    /** A room script's plain command: it runs, and the dialog closes. */
    | { kind: "command" };

export interface MenuPageSources {
    customFrames: ReadonlyMap<string, { url: string; allowApi: boolean; allow?: string | undefined }>;
    profileUrl: () => string;
    contactUrl: string | undefined;
    reportUrl: string | undefined;
}

// Keys as in SubMenusInterface (MenuStore.ts), which this file doesn't import so that it stays testable alone.
export function menuPage(menu: MenuItem, sources: MenuPageSources): MenuPage | undefined {
    if (menu.type === "scripting") {
        const frame = sources.customFrames.get(menu.key);
        return frame
            ? { kind: "frame", src: frame.url, allowApi: frame.allowApi, allow: frame.allow }
            : { kind: "command" };
    }
    switch (menu.key) {
        case "credit":
            return { kind: "credit" };
        case "chat":
            return { kind: "chat" };
        case "profile":
            return { kind: "frame", src: sources.profileUrl(), allowApi: true, allow: undefined };
        case "contact":
            return sources.contactUrl
                ? {
                      kind: "frame",
                      src: sources.contactUrl,
                      allowApi: false,
                      allow: `clipboard-read; clipboard-write self ${sources.contactUrl}`,
                  }
                : undefined;
        case "report":
            return sources.reportUrl
                ? { kind: "frame", src: sources.reportUrl, allowApi: false, allow: undefined }
                : undefined;
        default:
            return undefined;
    }
}
