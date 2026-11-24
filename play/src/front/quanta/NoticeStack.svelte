<script lang="ts">
    // quanta: the room's notices in one stack above the dock (quanta-ui.css .quanta-notices): the map script's banner
    // (recording started), WA's warnings, toasts and notifications, and staff's messages to everyone, in the order they
    // came, the newest nearest the dock. What shows (noticeLook.ts noticesKeptOut): three at most, information giving
    // way; then as much as fits below the call's tiles at the top of the room (noticeOffsets.ts), information first and
    // then the older of the rest. The recording's notices and the newest notice that is not information always show.
    // Every card is measured where it stands and what fits is worked out before the frame is drawn, so none flashes in
    // or out; the room growing brings back what had no room. Each notice is read out once, as it comes, from one log
    // here, whether it shows or not.
    import { tick, type Component } from "svelte";
    import { bannerStore } from "../Stores/GameStore";
    import { warningBannerStore } from "../Stores/MenuStore";
    import { warningMessageStore } from "../Stores/ErrorStore";
    import { toastStore } from "../Stores/ToastStoreSingleton";
    import { notificationPlayingStore, type Notification as WaNotification } from "../Stores/NotificationStore";
    import { textMessageStore } from "../Stores/TypeMessageStore/TextMessageStore";
    import type { Message } from "../Stores/TypeMessageStore/MessageStore";
    import Notification from "../Components/UI/Notification.svelte";
    import Notice from "./Notice.svelte";
    import RoomBanner from "./RoomBanner.svelte";
    import GlobalNotice, { globalMessageText } from "./GlobalNotice.svelte";
    import { notificationLook, noticesKeptOut } from "./noticeLook";
    import { weakLinkNoticeStore } from "../Livekit/WeakLinkNotice";
    import { laneStore, offerLane, LANE_RANK, closeLaneWhenMouseLeaves } from "./lane";
    import LaneMore from "./LaneMore.svelte";
    import { QL } from "./i18n";

    // While a board fills the stage the stack shares one row with the on-air line (lane.ts): only the most important
    // message shows, "+N" beside it opens the rest.

    const MAX_SHOWN = 3;
    const GAP = 8;

    type Item = { key: string; info: boolean; pinned: boolean; urgent: boolean; text: string | undefined } & (
        | { kind: "banner" }
        | { kind: "warning"; id: string; message: string; closable: boolean }
        | { kind: "toast"; component: Component<Record<string, unknown>>; props: Record<string, unknown> }
        | { kind: "note"; notification: WaNotification }
        | { kind: "global"; message: Message }
    );

    // When each came, by key: the order of the stack. A notification has no key of its own that is sure to be unique
    // (a teacher's pokes share one), so each gets its own number. Bookkeeping read only while `items` is worked out.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const arrived = new Map<string, number>();
    let arrivals = 0;
    const noteKeys = new WeakMap<WaNotification, string>();
    const noteKey = (notification: WaNotification) => {
        let key = noteKeys.get(notification);
        if (!key) {
            key = `note:${++arrivals}`;
            noteKeys.set(notification, key);
        }
        return key;
    };

    let items = $derived.by(() => {
        const list: Item[] = [];
        const banner = $bannerStore;
        if ($warningBannerStore && banner) {
            const recording = banner.id === "quanta-recording";
            const key = `banner:${banner.id}:${banner.text}:${banner.bgColor ?? ""}`;
            list.push({ key, kind: "banner", info: !recording, pinned: recording, urgent: false, text: banner.text });
        }
        for (const warning of $warningMessageStore) {
            // WA types both loosely; the store always gives an id and text.
            const message = String(warning.message ?? "");
            const id = warning.id ?? message;
            list.push({
                key: `warning:${id}`,
                kind: "warning",
                id,
                message,
                closable: warning.closable,
                info: false,
                pinned: false,
                urgent: true,
                text: message,
            });
        }
        for (const [uuid, toast] of $toastStore.entries()) {
            list.push({
                key: `toast:${uuid}`,
                kind: "toast",
                component: toast.component as never,
                props: toast.props,
                info: false,
                pinned: false,
                urgent: false,
                // A toast reads itself out (its own Notice): the stack doesn't know its words.
                text: undefined,
            });
        }
        for (const notification of $notificationPlayingStore) {
            const tone = notificationLook(notification).tone;
            list.push({
                key: noteKey(notification),
                kind: "note",
                notification,
                info: tone === "info",
                pinned: tone === "recording",
                urgent: tone === "problem",
                text: notification.lead ? `${notification.lead}: ${notification.text}` : notification.text,
            });
        }
        for (const message of $textMessageStore) {
            list.push({
                key: `global:${message.id}`,
                kind: "global",
                message,
                info: false,
                pinned: false,
                urgent: false,
                text: globalMessageText(message),
            });
        }
        const present = new Set(list.map((item) => item.key));
        for (const key of [...arrived.keys()]) if (!present.has(key)) arrived.delete(key);
        for (const item of list) if (!arrived.has(item.key)) arrived.set(item.key, ++arrivals);
        return list.sort((a, b) => (arrived.get(a.key) ?? 0) - (arrived.get(b.key) ?? 0));
    });

    // Kept out of sight now, worked out from the cards' measured heights (below).
    let out = $state<ReadonlySet<string>>(new Set());
    let stack: HTMLDivElement | undefined = $state();
    // The cards' elements, read only when measuring: nothing renders from it.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const cards = new Map<string, HTMLElement>();
    function card(element: HTMLElement, key: string) {
        cards.set(key, element);
        return { destroy: () => cards.delete(key) };
    }

    /** The room left between the stack's foot and the call's tiles (quanta-ui.css, noticeOffsets.ts). */
    function room(element: HTMLElement): number {
        const css = getComputedStyle(document.documentElement);
        const bottom = parseFloat(css.getPropertyValue("--quanta-notices-bottom")) || 104;
        const clear = Math.max(24, (parseFloat(css.getPropertyValue("--quanta-notices-clear")) || 0) + 12);
        const height = element.parentElement?.clientHeight ?? window.innerHeight;
        return height - bottom - clear;
    }

    function fit(): void {
        if (!stack) return;
        // The weak-link notice above the dock has the room to itself while it shows: only what must always show
        // (the recording's) stays beside it, the rest comes back when it goes, so two cards never pile up on the map.
        const alone = $weakLinkNoticeStore !== undefined;
        const measured = items.map((item) => ({
            key: item.key,
            height: cards.get(item.key)?.offsetHeight ?? 0,
            info: alone ? true : item.info,
            pinned: item.pinned,
        }));
        let next = noticesKeptOut(measured, alone ? 0 : MAX_SHOWN, room(stack), GAP);
        if ($laneStore.active && !$laneStore.open)
            next = new Set(measured.filter((notice) => laneKey(notice.key) !== $laneStore.winner).map((n) => n.key));
        if (next.size !== out.size || [...next].some((key) => !out.has(key))) out = next;
    }

    // Measured after every change to the notices, before the frame is drawn; again whenever a card or the room changes
    // size, which can also bring back what had no room.
    $effect(() => {
        void items;
        void $weakLinkNoticeStore;
        void $laneStore;
        void tick().then(fit);
    });
    $effect(() => {
        void items;
        if (!stack) return;
        let frame = 0;
        const later = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(fit);
        };
        const observer = new ResizeObserver(later);
        observer.observe(stack);
        if (stack.parentElement) observer.observe(stack.parentElement);
        for (const element of cards.values()) observer.observe(element);
        const variables = new MutationObserver(later);
        variables.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
        window.addEventListener("resize", later);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            variables.disconnect();
            window.removeEventListener("resize", later);
        };
    });

    // What each message weighs when the row under a board is shared (lane.ts).
    const laneKey = (key: string) => `notice:${key}`;
    function laneRank(item: Item): number {
        if (item.kind === "warning" || item.urgent) return LANE_RANK.problem;
        if (item.kind === "global") return LANE_RANK.staffMessage;
        if (item.kind === "toast") return LANE_RANK.toast;
        if (item.pinned) return LANE_RANK.recording;
        if (item.kind === "note" && notificationLook(item.notification).tone === "action") return LANE_RANK.action;
        return LANE_RANK.information;
    }
    $effect(() => {
        offerLane(
            "notices",
            items.map((item) => ({ key: laneKey(item.key), rank: laneRank(item) })),
        );
    });
    $effect(() => {
        return $laneStore.open ? closeLaneWhenMouseLeaves() : undefined;
    });

    // The newest staff message showing is the one Escape closes.
    let newestGlobal = $derived([...items].reverse().find((item) => item.kind === "global" && !out.has(item.key))?.key);
</script>

<!-- Read out once each, as it comes, whether it shows or not; problems at once. -->
<div class="quanta-notice-log" role="log" aria-live="polite">
    {#each items.filter((item) => item.text && !item.urgent) as item (item.key)}<p>{item.text}</p>{/each}
</div>
<div class="quanta-notice-log" role="log" aria-live="assertive">
    {#each items.filter((item) => item.text && item.urgent) as item (item.key)}<p>{item.text}</p>{/each}
</div>

<div class="quanta-notices" data-quanta-notices bind:this={stack}>
    {#each items as item (item.key)}
        <!-- Out of sight but still laid out: measured where it stands, so taking it back costs no extra frame. -->
        <div
            class="quanta-notice-item"
            class:gone={out.has(item.key)}
            inert={out.has(item.key) || undefined}
            use:card={item.key}
        >
            {#if item.kind === "banner"}
                <RoomBanner live="off" />
            {:else if item.kind === "warning"}
                <Notice
                    tone="problem"
                    live="off"
                    text={item.message}
                    ondismiss={item.closable ? () => warningMessageStore.removeWarningMessage(item.id) : undefined}
                />
            {:else if item.kind === "toast"}
                {@const ToastComponent = item.component}
                <ToastComponent {...item.props} />
            {:else if item.kind === "note"}
                <Notification notification={item.notification} live="off" />
            {:else if item.kind === "global"}
                <GlobalNotice message={item.message} escape={item.key === newestGlobal} />
            {/if}
            <LaneMore key={laneKey(item.key)} />
        </div>
    {/each}
</div>
