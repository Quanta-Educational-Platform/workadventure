// quanta: the board staff present to the class lives on the Quanta page beside the room (VirtualRoom). The room only
// carries who presents what and which students staff let draw: the map variable presentedBoard ({ courseBoard,
// drawers?: player uuids, editors? }, writable by admin only), written by the room script (quanta-button.js).
import { writable, type Readable } from "svelte/store";

export const BOARD_VARIABLE = "presentedBoard";

const BOARD_AREA_PREFIX = "quanta:whiteboard:";

/** The map's class boards: areas or entities named `quanta:whiteboard:<name>`, where the class looks at the board. */
export function isClassBoardArea(name: string | undefined): boolean {
    return (name ?? "").startsWith(BOARD_AREA_PREFIX);
}

const presentedBoard = writable<unknown>(undefined);
export const presentedBoardStore: Readable<unknown> = presentedBoard;

/** Called by the SharedVariablesManager with the room's value and every change to it. */
export function noteSharedVariable(name: string, value: unknown): void {
    if (name === BOARD_VARIABLE) presentedBoard.set(value);
}

export function drawersOf(value: unknown): string[] {
    const drawers = (value as { drawers?: unknown } | null | undefined)?.drawers;
    return Array.isArray(drawers) ? drawers.filter((id): id is string => typeof id === "string") : [];
}
