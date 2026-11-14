import { writable } from "svelte/store";

/** One of WA's other menu pages (map credits, profile, a room script's page), by its menu key. */
export type MenuTab = `menu:${string}`;

export type QuantaSettingsTab = "audio" | "video" | "general" | "shortcuts" | "globalMessages" | MenuTab;

export const menuTab = (key: string): MenuTab => `menu:${key}`;

export function menuTabKey(tab: QuantaSettingsTab): string | undefined {
    return tab.startsWith("menu:") ? tab.slice("menu:".length) : undefined;
}

/** The tab the settings dialog opens on: the dock's trays open it on their own device's tab. */
export const quantaSettingsTabStore = writable<QuantaSettingsTab>("audio");
