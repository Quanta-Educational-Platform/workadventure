// quanta: what the page's header can't hold on a phone (present the board, record, the class's links) offered in ⋮
// instead, under the dock's own folded buttons. The page says what to show and acts on the choice itself.
import { writable } from "svelte/store";
import { QUANTA_UI } from "../Enum/EnvironmentVariable";
import { fromPlatform, platformOrigin } from "./platformOrigin";
import type { IconName } from "./icons";

export interface PageMenuItem {
    id: string;
    label: string;
    icon: IconName;
    pressed?: boolean;
    danger?: boolean;
    /** A short fact at the row's end (a recording's length). */
    detail?: string;
}

const ICONS: Record<string, IconName> = { present: "board", record: "record", links: "link" };

export const pageMenuStore = writable<PageMenuItem[]>([]);

export function runPageMenuItem(id: string): void {
    const origin = platformOrigin();
    if (origin && window.parent !== window) window.parent.postMessage({ type: "quanta_wa_menu", id }, origin);
}

let started = false;
export function startPageMenu(): void {
    if (started || !QUANTA_UI) return;
    started = true;
    window.addEventListener("message", (event: MessageEvent) => {
        if (event.data?.type !== "quanta_menu" || !fromPlatform(event)) return;
        const items: unknown = event.data.items;
        if (!Array.isArray(items)) return;
        pageMenuStore.set(
            items
                .filter(
                    (item): item is Record<string, unknown> =>
                        !!item &&
                        typeof item.id === "string" &&
                        typeof item.label === "string" &&
                        typeof item.kind === "string" &&
                        item.kind in ICONS,
                )
                .slice(0, 8)
                .map((item) => ({
                    id: (item.id as string).slice(0, 40),
                    label: (item.label as string).slice(0, 80),
                    icon: ICONS[item.kind as string],
                    pressed: item.pressed === true,
                    danger: item.danger === true,
                    detail: typeof item.detail === "string" ? item.detail.slice(0, 16) : undefined,
                })),
        );
    });
}
