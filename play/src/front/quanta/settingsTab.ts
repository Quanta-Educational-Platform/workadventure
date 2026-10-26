import { writable } from "svelte/store";

export type QuantaSettingsTab = "audio" | "video" | "general" | "shortcuts" | "globalMessages";

/** The tab the settings dialog opens on: the dock's trays open it on their own device's tab. */
export const quantaSettingsTabStore = writable<QuantaSettingsTab>("audio");
