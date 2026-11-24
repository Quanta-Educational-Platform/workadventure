import type { ComputePositionConfig } from "@floating-ui/dom";
import type { Rect } from "@floating-ui/dom";
import { arrow, autoUpdate, computePosition, flip, limitShift, offset, shift, size } from "@floating-ui/dom";
import { writable } from "svelte/store";
import { v4 } from "uuid";
import type { WorkAdventureComponent, WorkAdventureComponentProps } from "../../types/component";
import type { ArrowAction, ContentAction } from "./svelte-floatingui";

export const floatingUiComponents = writable(
    new Map<
        string,
        {
            componentType: WorkAdventureComponent;
            props?: WorkAdventureComponentProps;
            action: ContentAction;
            arrowAction: ArrowAction | undefined;
            zIndex: number;
        }
    >(),
);

/**
 * Use this function to display a popup on top/bottom of an element. Unlike the `createFloatingUiActions` function, this function
 * is passed the popup in parameter and will display it at the right position. The element in the DOM will be close to the root element.
 * As a result, you don't have to worry about the popup being clipped by the parent element because of "overflow: hidden".
 * @param closeOnClickOutside - when true, the popup closes when the user clicks outside the reference element and the popup content
 * @param onClose - called when the popup is closed (by click outside or by calling the returned close function)
 * @param zIndex - overrides the default global floating layer when the popup must stay below higher-priority overlays
 * @param edgePadding - how far the popup keeps from the window's edges
 * @param boundary - quanta: the area the popup stays wholly inside (the room's visible window), instead of the
 * viewport; read on each placement, and the popup scrolls when taller than it
 */
export function showFloatingUi(
    referenceNode: Element,
    component: WorkAdventureComponent,
    props: WorkAdventureComponentProps,
    options?: Partial<ComputePositionConfig>,
    offsetMainAxis = 0,
    withArrow = true,
    closeOnClickOutside = false,
    onClose?: () => void,
    zIndex = 3000,
    edgePadding = 5,
    boundary?: () => Rect | undefined,
): () => void {
    let arrowNode: HTMLElement | undefined;
    let contentNode: HTMLElement | undefined;
    let cleanup: (() => void) | null = null;
    let closed = false;

    const close = () => {
        // A single tap fires touchstart then a compatibility mousedown, so the click-outside
        // handler can call this twice; keep it idempotent so onClose runs at most once.
        if (closed) {
            return;
        }
        closed = true;
        cleanup?.();
        cleanup = null;
        floatingUiComponents.update((components) => {
            components.delete(id);
            return components;
        });
        onClose?.();
    };

    const contentAction: ContentAction = (node) => {
        contentNode = node;
        //options = { ...initOptions, ...contentOptions };
        initFloatingUi();

        let clickOutsideHandler: ((e: MouseEvent | TouchEvent) => void) | undefined;
        if (closeOnClickOutside) {
            clickOutsideHandler = (e: MouseEvent | TouchEvent) => {
                const target = e.target as Node;
                if (referenceNode.contains(target) || (contentNode && contentNode.contains(target))) {
                    return;
                }
                close();
            };
            // Listen to touchstart too: on the game canvas Phaser swallows the compatibility
            // mousedown, so a mousedown-only listener never fires on touch devices.
            document.addEventListener("mousedown", clickOutsideHandler);
            document.addEventListener("touchstart", clickOutsideHandler);
        }

        return {
            destroy() {
                if (clickOutsideHandler) {
                    document.removeEventListener("mousedown", clickOutsideHandler);
                    document.removeEventListener("touchstart", clickOutsideHandler);
                }
                deinitFloatingUi();
            },
        };
    };

    const arrowAction: ArrowAction = (node) => {
        arrowNode = node;
        initFloatingUi();
        return {
            destroy() {
                deinitFloatingUi();
            },
        };
    };

    const id = v4();
    floatingUiComponents.update((components) => {
        components.set(id, {
            componentType: component,
            props,
            action: contentAction,
            arrowAction: withArrow ? arrowAction : undefined,
            zIndex,
        });
        return components;
    });

    const updatePosition = () => {
        if (referenceNode && contentNode) {
            const area = boundary?.();
            const middlewares = area
                ? [
                      offset({ mainAxis: offsetMainAxis }),
                      flip({ padding: edgePadding, boundary: area }),
                      // Without a limiter: wholly inside even when that takes it off its anchor.
                      shift({ padding: edgePadding, boundary: area, crossAxis: true }),
                      size({
                          padding: edgePadding,
                          boundary: area,
                          apply({ availableHeight, elements }) {
                              elements.floating.style.maxHeight = `${Math.max(availableHeight, 0)}px`;
                              elements.floating.style.overflowY = "auto";
                          },
                      }),
                  ]
                : [
                      flip({ padding: edgePadding }),
                      shift({ padding: edgePadding, limiter: limitShift() }),
                      offset({ mainAxis: offsetMainAxis }),
                  ];
            if (arrowNode) {
                middlewares.push(arrow({ element: arrowNode }));
            }

            computePosition(referenceNode, contentNode, {
                placement: "top",
                ...options,
                middleware: middlewares,
            })
                .then(({ x, y, placement, middlewareData }) => {
                    if (contentNode) {
                        Object.assign(contentNode.style, {
                            left: `${x}px`,
                            top: `${y}px`,
                        });

                        if (arrowNode) {
                            const arrowX = middlewareData.arrow?.x;
                            const arrowY = middlewareData.arrow?.y;
                            const staticSide = {
                                top: "bottom",
                                right: "left",
                                bottom: "top",
                                left: "right",
                            }[placement.split("-")[0]];

                            if (staticSide === undefined) {
                                throw new Error("Invalid placement");
                            }
                            Object.assign(arrowNode.style, {
                                left: arrowX != null ? `${arrowX}px` : "",
                                top: arrowY != null ? `${arrowY}px` : "",
                                right: "",
                                bottom: "",
                                [staticSide]: "-4px",
                            });
                            arrowNode.classList.add("floating-ui-arrow");
                            arrowNode.dataset.arrowPlacement = staticSide;
                        }
                    }
                })
                .catch((e) => {
                    console.error(e);
                });
        }
    };

    const initFloatingUi = () => {
        if (referenceNode !== undefined && contentNode !== undefined) {
            if (cleanup) {
                // Is this normal?
                cleanup();
            }
            cleanup = autoUpdate(referenceNode, contentNode, () => {
                updatePosition();
            });
        }
    };

    const deinitFloatingUi = () => {
        if (cleanup !== null) {
            cleanup();
            cleanup = null;
        }
    };

    return close;
}
