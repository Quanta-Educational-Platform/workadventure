// The dock's and the settings' option lists answer the keys a native select does. The keys stop here: the game only
// ignores keys typed into native form controls (UserInputManager), so an arrow would otherwise walk the woka.

/** On the list button: the arrows open the list, as Enter and Space (a click) do. */
export function openOnArrows(button: HTMLButtonElement, open: () => void) {
    const onkeydown = (event: KeyboardEvent) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        event.stopPropagation();
        open();
    };
    button.addEventListener("keydown", onkeydown);
    return {
        update(next: () => void) {
            open = next;
        },
        destroy() {
            button.removeEventListener("keydown", onkeydown);
        },
    };
}

/** On the open list: focus starts on the chosen option; arrows, Home and End move it; Escape and Tab close. */
export function listboxKeys(list: HTMLElement, close: (refocus: boolean) => void) {
    const options = () => [...list.querySelectorAll<HTMLButtonElement>("button")];
    const focusAt = (index: number) => {
        const all = options();
        all[(index + all.length) % all.length]?.focus();
    };
    (list.querySelector<HTMLButtonElement>('[aria-selected="true"] button') ?? options()[0])?.focus();

    const onkeydown = (event: KeyboardEvent) => {
        const all = options();
        const index = all.indexOf(document.activeElement as HTMLButtonElement);
        switch (event.key) {
            case "ArrowDown":
                focusAt(index + 1);
                break;
            case "ArrowUp":
                focusAt(index - 1);
                break;
            case "Home":
                focusAt(0);
                break;
            case "End":
                focusAt(all.length - 1);
                break;
            case "Escape":
                close(true);
                break;
            case "Tab":
                close(false);
                return;
            default:
                return;
        }
        event.preventDefault();
        event.stopPropagation();
    };
    list.addEventListener("keydown", onkeydown);
    return {
        update(next: (refocus: boolean) => void) {
            close = next;
        },
        destroy() {
            list.removeEventListener("keydown", onkeydown);
        },
    };
}
