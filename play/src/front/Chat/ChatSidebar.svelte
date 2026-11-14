<script lang="ts">
    import { fly } from "svelte/transition";
    import { QUANTA_UI } from "../Enum/EnvironmentVariable";
    import { gameManager } from "../Phaser/Game/GameManager";
    import { chatVisibilityStore, INITIAL_SIDEBAR_WIDTH, INITIAL_SIDEBAR_WIDTH_MOBILE } from "../Stores/ChatStore";
    import { isMediaBreakpointUp } from "../Utils/BreakpointsUtils";
    import { blocker } from "../Utils/screenBlocker";
    import ChatPanelHeader from "../quanta/ChatPanelHeader.svelte";
    import { sidePanelLayoutStore } from "../quanta/sidePanel";
    import { sidePanelSlide } from "../quanta/sidePanelSlide";
    import { railPanelTopStore } from "../quanta/rail";
    import { activeDirectStore } from "../quanta/directMessages";
    import DirectConversation from "../quanta/DirectConversation.svelte";
    import { selectedRoomStore } from "./Stores/SelectRoomStore";
    import Chat from "./Components/Chat.svelte";
    import { chatSidebarWidthStore, hideActionBarStoreBecauseOfChatBar } from "./ChatSidebarWidthStore";
    import { IconX } from "@wa-icons";

    let container: HTMLElement | undefined = $state();

    function closeChat() {
        chatVisibilityStore.set(false);
    }

    let isInSpecificDiscussion = $derived($selectedRoomStore !== undefined);

    let sideBarWidth: number = $state($chatSidebarWidthStore);

    const isRTL: boolean = document.documentElement.dir === "rtl";

    // quanta: as far as the platform's people column slides: the column with its margin, or the whole room it covers.
    function slideDistance(side: { width: number; margin: number; cover: boolean }): number {
        const distance = side.cover ? window.innerWidth : side.width + side.margin;
        return isRTL ? -distance : distance;
    }

    const handleMousedown = (e: MouseEvent) => {
        let dragX = e.clientX;
        const initialWidth = sideBarWidth;

        document.onmousemove = (e) => {
            const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
            const diff = e.clientX - dragX;

            const newWidth = isRTL ? initialWidth - diff : initialWidth + diff;
            const minWidth = 200;
            const maxWidth = vw - 50;
            const clampedWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));

            sideBarWidth = clampedWidth;
        };
        document.onmouseup = () => {
            document.onmousemove = null;
            chatSidebarWidthStore.set(sideBarWidth);
        };
    };
    const handleTouchStart = (e: TouchEvent) => {
        let dragX = e.targetTouches[0].pageX;

        function onTouchMove(e: TouchEvent) {
            const vw = Math.max(document.documentElement.clientWidth, window.innerWidth || 0);
            const diff = e.targetTouches[0].pageX - dragX;
            const newWidth = Math.min(isRTL ? sideBarWidth - diff : sideBarWidth + diff, vw);
            const minWidth = 200;
            const maxWidth = vw - 50;
            const clampedWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));

            sideBarWidth = clampedWidth;

            dragX = e.targetTouches[0].pageX;
        }

        function onTouchEnd() {
            document.removeEventListener("touchmove", onTouchMove);
            document.removeEventListener("touchend", onTouchEnd);
            chatSidebarWidthStore.set(sideBarWidth);
        }

        document.addEventListener("touchmove", onTouchMove);
        document.addEventListener("touchend", onTouchEnd);
    };

    const handleDbClick = () => {
        if (isChatBarInFullScreen()) {
            const initialWidth = isMediaBreakpointUp("md") ? INITIAL_SIDEBAR_WIDTH_MOBILE : INITIAL_SIDEBAR_WIDTH;
            sideBarWidth = initialWidth;
        } else {
            const fullWidth = document.documentElement.clientWidth;
            sideBarWidth = fullWidth;
        }
        chatSidebarWidthStore.set(sideBarWidth);
    };

    $effect(() => {
        chatSidebarWidthStore.set(sideBarWidth);
    });

    const onresize = () => {
        if (isChatSidebarLargerThanWindow() && container) {
            sideBarWidth = document.documentElement.clientWidth;
            chatSidebarWidthStore.set(sideBarWidth);
        }
    };

    const isChatSidebarLargerThanWindow = () => {
        return sideBarWidth >= document.documentElement.clientWidth;
    };

    const isChatBarInFullScreen = () => {
        return sideBarWidth === document.documentElement.clientWidth;
    };

    // quanta: no chat at all in a room whose platform turned chat off, not even the proximity chat; the
    // shortcut and the bubble's own prompts open nothing (and leave no space for a panel).
    const chatTurnedOff = QUANTA_UI && !gameManager.getCurrentGameScene().room.isChatEnabled;
    $effect(() => {
        if (chatTurnedOff && $chatVisibilityStore) chatVisibilityStore.set(false);
    });
</script>

<svelte:window {onresize} />
{#if $chatVisibilityStore && !chatTurnedOff && QUANTA_UI}
    <!-- quanta: in the platform's side column (quanta/sidePanel.ts), at its width, margin and corners; over the
         whole room where the column covers the map. Fixed to the window: it lives in the map's #game, and a
         co-website beside the map would otherwise put it between the two instead of at the window's edge. -->
    {@const side = $sidePanelLayoutStore}
    <!-- Beside the page the frame itself slides open by the column (sidePanel.ts): the column comes in with it, at
         once and shifted out by what the frame hasn't gained yet, instead of a slide of its own. -->
    {@const withFrame = (side.widens ?? 0) > 0 && !side.cover && !side.below}
    <section
        bind:this={container}
        id="chat"
        data-testid="chat"
        in:sidePanelSlide={{ distance: slideDistance(side), direction: "in", instant: side.instant || withFrame }}
        out:sidePanelSlide={{
            distance: slideDistance(side),
            direction: "out",
            instant: side.instant || withFrame,
        }}
        onintrostart={(event) => event.currentTarget.classList.remove("quanta-side-leaving")}
        onoutrostart={(event) => event.currentTarget.classList.add("quanta-side-leaving")}
        style={side.cover
            ? `position: fixed; inset: 0 0 ${side.margin === 8 ? 84 : 96}px 0; width: 100% !important; max-width: none; margin: 0; height: auto; border-radius: 0;`
            : side.below
              ? `position: fixed; top: auto; left: ${side.margin}px; right: ${side.margin}px; bottom: ${side.margin === 8 ? 84 : 96}px; width: auto !important; max-width: none; margin: 0; height: ${side.below}px; border-radius: ${side.radius}px;`
              : $railPanelTopStore !== null
                ? `position: fixed; top: ${$railPanelTopStore}px; inset-inline-end: 0; width: ${side.width}px !important; max-width: ${side.width}px; margin: 0 ${side.margin}px ${side.margin}px 0; height: calc(100% - ${$railPanelTopStore + side.margin}px); border-radius: ${side.radius}px;`
                : `position: fixed; top: 0; inset-inline-end: 0; width: ${side.width}px !important; max-width: ${side.width}px; margin: ${side.margin}px ${side.margin}px ${side.margin}px 0; height: calc(100% - ${2 * side.margin}px); border-radius: ${side.radius}px;${withFrame ? " translate: var(--quanta-chat-slide, 0px) 0;" : ""}`}
        {@attach blocker}
        class="chatWindow quanta-side-chat !min-w-0 p-0"
    >
        <ChatPanelHeader tabs={side.tabs} />
        {#if $activeDirectStore}
            <DirectConversation peerId={$activeDirectStore} />
        {:else}
            <Chat sideBarWidth={side.width} />
        {/if}
    </section>
{:else if $chatVisibilityStore && !chatTurnedOff}
    <section
        bind:this={container}
        id="chat"
        data-testid="chat"
        transition:fly={{ duration: 200, x: isRTL ? sideBarWidth : -sideBarWidth }}
        style="width: {sideBarWidth}px; max-width: {sideBarWidth}px;"
        {@attach blocker}
        class=" chatWindow !min-w-[150px] max-sm:!min-w-[150px] bg-contrast/50 backdrop-blur-md p-0"
    >
        {#if $hideActionBarStoreBecauseOfChatBar && isInSpecificDiscussion}
            <div class="close-window absolute end-2 top-3 rounded-sm p-1 bg-contrast/80 z-50">
                <button
                    class="hover:bg-white/10 rounded aspect-square w-8 h-8 m-0 flex items-center justify-center !text-white"
                    data-testid="closeChatButton"
                    onclick={closeChat}
                >
                    <IconX font-size="20" />
                </button>
            </div>
        {/if}

        <Chat {sideBarWidth} />
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
            class="!absolute !end-1 !top-0 !bottom-0 !m-auto !w-1 !h-32 !bg-white !rounded !cursor-col-resize select-none"
            style:display={$sidePanelLayoutStore.below || $sidePanelLayoutStore.cover ? "none" : undefined}
            id="resize-bar"
            onmousedown={handleMousedown}
            ondblclick={handleDbClick}
            ontouchstart={handleTouchStart}
        ></div>
    </section>
{/if}

<style>
    @media only screen and (max-width: 767px) {
        .chatWindow {
            width: 100% !important;
        }
    }
</style>
