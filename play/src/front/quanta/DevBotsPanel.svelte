<script lang="ts">
    // quanta: the dev tools panel (staging, staff): fake students to add, drive and play as (devBots.ts). Opened from the
    // dock's ⋮ menu; stays over the room until closed, so the room can be watched while they act.
    import Icon from "./Icon.svelte";
    import type { IconName } from "./icons";
    import {
        addBots,
        comeToMe,
        devBotsBusyStore,
        devBotsErrorStore,
        devBotsMutedForMeStore,
        devBotsPanelFoldedStore,
        devBotsPanelOpenStore,
        devBotsStore,
        playAs,
        removeAllBots,
        removeBot,
        tell,
    } from "./devBots";

    const CHAT_SECONDS = 5;

    let bots = $derived($devBotsStore);
    let all = $derived.by(() => {
        const states = bots.map((bot) => bot.state).filter((state) => state !== null);
        const every = (key: "mic" | "camera" | "talking" | "hand" | "sharing") =>
            states.length > 0 && states.every((state) => state[key]);
        return {
            mic: every("mic"),
            camera: every("camera"),
            talking: every("talking"),
            hand: every("hand"),
            chat: states.length > 0 && states.every((state) => state.chatEvery !== null),
        };
    });

    type Toggle = { key: string; icon: IconName; offIcon?: IconName; label: string; on: boolean; run: (on: boolean) => void };
    function toggles(userId: string | "all", state: {
        mic: boolean;
        camera: boolean;
        talking: boolean;
        hand: boolean;
        sharing?: boolean;
        chat: boolean;
    }): Toggle[] {
        const list: Toggle[] = [
            { key: "mic", icon: "mic", offIcon: "micOff", label: "Microphone", on: state.mic, run: (on) => tell(userId, (b) => b.mic(on)) },
            { key: "camera", icon: "videocam", offIcon: "videocamOff", label: "Camera", on: state.camera, run: (on) => tell(userId, (b) => b.camera(on)) },
            { key: "talk", icon: "campaign", offIcon: "campaignOff", label: "Talking", on: state.talking, run: (on) => tell(userId, (b) => b.talk(on)) },
            { key: "hand", icon: "hand", label: "Hand up", on: state.hand, run: (on) => tell(userId, (b) => b.hand(on)) },
            { key: "chat", icon: "message", offIcon: "messageOff", label: `Chat every ${CHAT_SECONDS} s`, on: state.chat, run: (on) => tell(userId, (b) => b.chatEvery(on ? CHAT_SECONDS : null)) },
        ];
        if (state.sharing !== undefined)
            list.push({ key: "share", icon: "share", offIcon: "stopShare", label: "Sharing screen", on: state.sharing, run: (on) => tell(userId, (b) => b.share(on)) });
        return list;
    }
</script>

{#if $devBotsPanelOpenStore && $devBotsPanelFoldedStore}
    <button type="button" class="qdb-pill" data-testid="quanta-dev-bots" onclick={() => devBotsPanelFoldedStore.set(false)}>
        Fake students{bots.length > 0 ? ` · ${bots.length}` : ""}
        <Icon name="dropDown" size={16} />
    </button>
{:else if $devBotsPanelOpenStore}
    <section class="qdb" aria-label="Dev tools" data-testid="quanta-dev-bots">
        <header>
            <h2>Fake students</h2>
            <span class="qdb-tag">staging</span>
            <button type="button" class="qdb-icon" aria-label="Fold dev tools" title="Fold" onclick={() => devBotsPanelFoldedStore.set(true)}>
                <Icon name="chevronUp" size={18} />
            </button>
            <button type="button" class="qdb-icon" aria-label="Close dev tools" title="Close (they stay)" onclick={() => devBotsPanelOpenStore.set(false)}>
                <Icon name="close" size={18} />
            </button>
        </header>

        <div class="qdb-row">
            {#each [1, 3, 5] as count (count)}
                <button type="button" class="qdb-button" disabled={$devBotsBusyStore || bots.length + count > 8} onclick={() => addBots(count)}>
                    +{count}
                </button>
            {/each}
            {#if bots.length > 0}
                <button type="button" class="qdb-button quiet" onclick={removeAllBots}>Remove all</button>
            {/if}
        </div>
        {#if $devBotsBusyStore}<p class="qdb-note">Making them and letting them in…</p>{/if}
        {#if $devBotsErrorStore}<p class="qdb-note error" role="alert">{$devBotsErrorStore}</p>{/if}

        {#if bots.length > 0}
            <label class="qdb-switch">
                <input type="checkbox" bind:checked={$devBotsMutedForMeStore} />
                <span>Mute them for me</span>
            </label>

            <div class="qdb-line">
                <span class="qdb-who">Everyone</span>
                {#each toggles("all", all) as toggle (toggle.key)}
                    <button
                        type="button"
                        class="qdb-toggle"
                        class:on={toggle.on}
                        aria-pressed={toggle.on}
                        aria-label={toggle.label}
                        title={toggle.label}
                        onclick={() => toggle.run(!toggle.on)}
                    >
                        <Icon name={toggle.on || !toggle.offIcon ? toggle.icon : toggle.offIcon} size={16} />
                    </button>
                {/each}
            </div>
            <div class="qdb-row">
                <button type="button" class="qdb-button small" onclick={comeToMe}>Come to me</button>
                <button type="button" class="qdb-button small" onclick={() => tell("all", (b) => b.goToSpot())}>To megaphones</button>
                <button type="button" class="qdb-button small quiet" onclick={() => tell("all", (b) => b.leaveSpot())}>Off them</button>
            </div>

            <ul>
                {#each bots as bot (bot.userId)}
                    <li data-testid="quanta-dev-bot">
                        <div class="qdb-line">
                            <span class="qdb-who qdb-name">
                                <span class="qdb-dot" class:ready={bot.state?.ready}></span>
                                <span>{bot.name}</span>
                            </span>
                            {#if bot.state?.ready}
                                <button type="button" class="qdb-text" onclick={() => tell(bot.userId, (b) => b.say())}>Say</button>
                                <button type="button" class="qdb-text" onclick={() => playAs(bot.userId)}>Play as</button>
                            {:else}
                                <span class="qdb-joining">joining…</span>
                            {/if}
                            <button type="button" class="qdb-icon" aria-label={`Remove ${bot.name}`} title="Remove" onclick={() => removeBot(bot.userId)}>
                                <Icon name="close" size={16} />
                            </button>
                        </div>
                        {#if bot.state?.ready}
                            <div class="qdb-line indent">
                                {#each toggles(bot.userId, { ...bot.state, chat: bot.state.chatEvery !== null }) as toggle (toggle.key)}
                                    <button
                                        type="button"
                                        class="qdb-toggle"
                                        class:on={toggle.on}
                                        aria-pressed={toggle.on}
                                        aria-label={`${toggle.label}: ${bot.name}`}
                                        title={toggle.label}
                                        onclick={() => toggle.run(!toggle.on)}
                                    >
                                        <Icon name={toggle.on || !toggle.offIcon ? toggle.icon : toggle.offIcon} size={16} />
                                    </button>
                                {/each}
                            </div>
                        {/if}
                    </li>
                {/each}
            </ul>
        {/if}
    </section>
{/if}

<style>
    .qdb {
        position: fixed;
        top: 64px;
        left: 12px;
        z-index: 2000;
        width: min(312px, calc(100vw - 24px));
        max-height: calc(100vh - 176px);
        overflow-y: auto;
        box-sizing: border-box;
        padding: 10px 12px 12px;
        border: 1px solid rgb(255 255 255 / 0.08);
        border-radius: 14px;
        background: rgb(29 32 39 / 0.97);
        box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
        color: #e3e6ea;
        font-family: "Fira Sans", system-ui, sans-serif;
        font-size: 13px;
        line-height: 18px;
        pointer-events: auto;
    }

    header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 10px;
    }

    h2 {
        margin: 0;
        font-size: 15px;
        font-weight: 600;
    }

    .qdb-tag {
        padding: 1px 8px;
        border-radius: 999px;
        background: rgb(255 196 0 / 0.16);
        color: #ffd666;
        font-size: 11px;
        font-weight: 600;
    }

    header .qdb-icon {
        margin-left: auto;
    }

    .qdb-row {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 6px;
        margin: 6px 0;
    }

    .qdb-button,
    .qdb-toggle,
    .qdb-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgb(255 255 255 / 0.1);
        background: rgb(255 255 255 / 0.06);
        color: #e3e6ea;
        font: inherit;
        cursor: pointer;
    }

    .qdb-button {
        height: 32px;
        padding: 0 12px;
        border-radius: 999px;
        font-weight: 500;
    }

    .qdb-button.small {
        height: 28px;
        padding: 0 10px;
    }

    .qdb-button.quiet {
        background: transparent;
    }

    .qdb-button:disabled {
        opacity: 0.45;
        cursor: default;
    }

    .qdb-toggle {
        width: 30px;
        height: 30px;
        border-radius: 999px;
        color: #a7adb7;
    }

    .qdb-toggle.on {
        border-color: transparent;
        background: #2f6fdb;
        color: #fff;
    }

    .qdb-icon {
        width: 28px;
        height: 28px;
        border-color: transparent;
        border-radius: 999px;
        background: transparent;
    }

    .qdb-button:hover:not(:disabled),
    .qdb-toggle:hover:not(.on),
    .qdb-icon:hover {
        background: rgb(255 255 255 / 0.12);
    }

    .qdb-switch {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 10px 0 4px;
        cursor: pointer;
    }

    .qdb-note {
        margin: 6px 0;
        color: #a7adb7;
    }

    .qdb-note.error {
        color: #ff8a80;
    }

    ul {
        margin: 8px 0 0;
        padding: 0;
        list-style: none;
    }

    li {
        padding: 6px 0;
        border-top: 1px solid rgb(255 255 255 / 0.07);
    }

    .qdb-dot {
        flex: none;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #6b7280;
    }

    .qdb-dot.ready {
        background: #4ade80;
    }

    .qdb-joining {
        color: #a7adb7;
        font-weight: 400;
    }

    .qdb-pill {
        position: fixed;
        top: 64px;
        left: 12px;
        z-index: 2000;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 32px;
        padding: 0 10px 0 14px;
        border: 1px solid rgb(255 255 255 / 0.1);
        border-radius: 999px;
        background: rgb(29 32 39 / 0.97);
        box-shadow: 0 8px 24px rgb(0 0 0 / 0.35);
        color: #e3e6ea;
        font: 500 13px "Fira Sans", system-ui, sans-serif;
        cursor: pointer;
        pointer-events: auto;
    }

    .qdb-line {
        display: flex;
        align-items: center;
        gap: 4px;
        min-height: 32px;
    }

    .qdb-line.indent {
        padding-left: 16px;
    }

    .qdb-who {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        color: #a7adb7;
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .qdb-who.qdb-name {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #e3e6ea;
        font-size: 13px;
        font-weight: 500;
    }

    .qdb-text {
        height: 26px;
        padding: 0 8px;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: #8fb3ff;
        font: inherit;
        font-weight: 500;
        cursor: pointer;
    }

    .qdb-text:hover {
        background: rgb(255 255 255 / 0.08);
    }
</style>
