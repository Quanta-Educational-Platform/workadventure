<script lang="ts">
    import { LL } from "../../../i18n/i18n-svelte";
    import Button from "../UI/Button.svelte";
    import type { Game } from "../../Phaser/Game/Game";
    import type { SelectCompanionScene } from "../../Phaser/Login/SelectCompanionScene";
    import { SelectCompanionSceneName } from "../../Phaser/Login/SelectCompanionScene";
    import { collectionsSizeStore, selectedCollection } from "../../Stores/SelectCharacterSceneStore";
    import { analyticsClient } from "../../Administration/AnalyticsClient";
    import { QUANTA_UI } from "../../Enum/EnvironmentVariable";
    import { IconChevronLeft, IconChevronRight } from "@wa-icons";

    interface Props {
        game: Game;
    }

    let { game }: Props = $props();

    let selectCompanionScene = $derived(game.scene.getScene(SelectCompanionSceneName) as SelectCompanionScene);

    /*function selectLeft() {
        selectCompanionScene.moveToLeft();
    }

    function selectRight() {
        selectCompanionScene.moveToRight();
    }*/

    function noCompanion() {
        selectCompanionScene.noCompagnion().catch((e) => console.error(e));
    }

    function selectCompanion() {
        selectCompanionScene.selectCompanion().catch((e) => console.error(e));
    }

    function cancel() {
        selectCompanionScene.cancel();
    }

    function selectLeftCollection() {
        selectCompanionScene.selectPreviousCompanionCollection();
    }

    function selectRightCollection() {
        selectCompanionScene.selectNextCompanionCollection();
    }
</script>

{#if QUANTA_UI}
    <!-- quanta: the companions stand a third of the way down; the title sits clear above them. -->
    <h2 class="qc-title">{$LL.companion.select.title()}</h2>
{:else}
    <section
        class="text-center absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-[calc(50%+20vh)] h-16"
    >
        <span class="text-white text-lg bold">
            {$LL.companion.select.title()}
        </span>
    </section>
{/if}
<section class="category flex flex-row justify-center">
    {#if $collectionsSizeStore > 1 && $selectedCollection}
        <button
            class="light mr-2 selectCharacterButton"
            onclick={(event) => {
                event.preventDefault();
                selectLeftCollection();
            }}
        >
            <IconChevronLeft />
        </button>
        <strong class="category-text">{$selectedCollection}</strong>
        <button
            class="outline ml-2 selectCharacterButton"
            onclick={(event) => {
                event.preventDefault();
                selectRightCollection();
            }}
        >
            <IconChevronRight />
        </button>
    {/if}
</section>
{#if QUANTA_UI}
    <!-- quanta: a way back to the room that keeps the companion, and both choices always in sight. -->
    <div class="qc-bar">
        <button type="button" class="qc-button ghost" onclick={cancel}>{$LL.recording.back()}</button>
        <span class="qc-spacer"></span>
        <button type="button" class="qc-button ghost" onclick={noCompanion}>{$LL.companion.select.any()}</button>
        <button
            type="button"
            class="qc-button primary"
            onclick={() => {
                analyticsClient.trackAdminEvent("onboarding.companion_selected");
                selectCompanion();
            }}
        >
            {$LL.companion.select.continue()}
        </button>
    </div>
{:else}
    <div
        class="fixed bottom-0 w-full bg-contrast/80 backdrop-blur-md border border-solid border-t border-b-0 border-x-0 border-white/10"
    >
        <section
            class="action container m-auto p-4 flex flex-col-reverse md:flex-row items-center space-y-2 md:space-y-0 md:space-x-4 justify-between"
        >
            <Button
                variant="light"
                appearance="ghost"
                size="lg"
                class="w-full md:w-1/2 block selectCompanionSceneFormBack pointer-events-auto"
                onclick={(event) => {
                    event.preventDefault();
                    noCompanion();
                }}
            >
                {$LL.companion.select.any()}
            </Button>
            <Button
                type="submit"
                variant="secondary"
                size="lg"
                class="w-full md:w-1/2 block selectCompanionSceneFormSubmit pointer-events-auto"
                onclick={(event) => {
                    event.preventDefault();
                    analyticsClient.trackAdminEvent("onboarding.companion_selected");
                    selectCompanion();
                }}
            >
                {$LL.companion.select.continue()}
            </Button>
        </section>
    </div>
{/if}

<!--<form class="selectCompanionScene">-->
<!--    <section class="text-center">-->
<!--        <h2 class="text-white text-2xl">{$LL.companion.select.title()}</h2>-->
<!--        {#if $collectionsSizeStore > 1 && $selectedCollection}-->
<!--            <button-->
<!--                class="outline mr-2 selectCompanionCollectionButton selectCharacterButtonLeft"-->
<!--                onclick|preventDefault={selectLeftCollection}-->
<!--            >-->
<!--                &lt;-->
<!--            </button>-->
<!--            <strong class="category-text">{$selectedCollection}</strong>-->
<!--            <button-->
<!--                class="outline ml-2 selectCompanionCollectionButton selectCompanionButtonRight"-->
<!--                onclick|preventDefault={selectRightCollection}-->
<!--            >-->
<!--                &gt;-->
<!--            </button>-->
<!--        {/if}-->
<!--        <button class="outline selectCharacterButton selectCharacterButtonLeft" onclick|preventDefault={selectLeft}>-->
<!--            &lt;-->
<!--        </button>-->
<!--        <button class="outline selectCharacterButton selectCharacterButtonRight" onclick|preventDefault={selectRight}>-->
<!--            &gt;-->
<!--        </button>-->
<!--    </section>-->
<!--    <section class="action flex flex-row justify-center">-->
<!--        <button class="outline mr-2 selectCompanionSceneFormBack" onclick|preventDefault={noCompanion}-->
<!--            >{$LL.companion.select.any()}</button-->
<!--        >-->
<!--        <button-->
<!--            type="submit"-->
<!--            class="light ml-2 selectCompanionSceneFormSubmit"-->
<!--            onclick|preventDefault={() => analyticsClient.trackAdminEvent("onboarding.woka_selected")}-->
<!--            onclick|preventDefault={selectCompanion}>{$LL.companion.select.continue()}</button-->
<!--        >-->
<!--    </section>-->

<!--</form>-->
<style>
    button {
        pointer-events: auto;
    }

    .qc-title {
        position: absolute;
        top: calc(100% / 3 - 7rem);
        left: 50%;
        transform: translateX(-50%);
        margin: 0;
        color: #eceef1;
        font-size: 1.25rem;
        font-weight: 600;
        white-space: nowrap;
    }

    .qc-bar {
        position: fixed;
        left: 50%;
        bottom: 16px;
        transform: translateX(-50%);
        width: min(560px, calc(100% - 32px));
        box-sizing: border-box;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
        padding: 10px;
        border-radius: 36px;
        background: #181b21;
        pointer-events: auto;
    }

    .qc-spacer {
        flex: 1;
    }

    .qc-button {
        height: 44px;
        padding: 0 20px;
        border: 0;
        border-radius: 9999px;
        font: inherit;
        font-weight: 500;
        cursor: pointer;
        white-space: nowrap;
    }

    .qc-button.ghost {
        background: transparent;
        color: #eceef1;
    }

    .qc-button.ghost:hover {
        background: #2b3038;
    }

    .qc-button.primary {
        background: #c9d5ea;
        color: #1d2b45;
    }

    .qc-button.primary:hover {
        background: #dbe4f3;
    }

    /* Phones: Continue gets its own full row rather than wrapping wherever the labels' length puts it. */
    @media (max-width: 480px) {
        .qc-bar {
            border-radius: 28px;
        }

        .qc-button {
            padding: 0 14px;
        }

        .qc-button.primary {
            flex: 1 0 100%;
        }
    }

    .qc-button:focus-visible {
        outline: 2px solid #c9d5ea;
        outline-offset: 2px;
    }
</style>
