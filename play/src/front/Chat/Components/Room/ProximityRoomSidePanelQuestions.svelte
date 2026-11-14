<script lang="ts">
    import { readable } from "svelte/store";
    import type { ChatQuestionItem, ProximityChatSidePanelRoom } from "../../Connection/ChatConnection";
    import LL from "../../../../i18n/i18n-svelte";
    import { QL } from "../../../quanta/i18n";
    import { createQuestionStateRowsStore } from "./QuestionStateRowsStore";
    import { IconCheck, IconSend, IconThumbUp, IconTrash } from "@wa-icons";

    interface Props {
        room: ProximityChatSidePanelRoom;
    }

    let { room }: Props = $props();

    const emptyQuestionItems = readable<readonly ChatQuestionItem[]>([]);
    const cannotCreateQuestion = readable(false);
    let draftQuestion = $state("");
    let activeFilter: "open" | "answered" = $state("open");

    let questionItems = $derived(room.qaItems ?? emptyQuestionItems);
    let questionCreation = $derived(room.questionCreation);
    let canCreateQuestionStore = $derived(questionCreation?.canCreate ?? cannotCreateQuestion);
    let canCreateQuestion = $derived($canCreateQuestionStore);
    let maxQuestionLength = $derived(questionCreation?.maxLength ?? 500);
    let questionRowsStore = $derived(createQuestionStateRowsStore(questionItems));
    let questionRows = $derived($questionRowsStore);
    let filteredQuestionRows = $derived(
        questionRows.filter(({ state }) => state.isAnswered === (activeFilter === "answered")),
    );
    let openQuestionCount = $derived(questionRows.filter(({ state }) => !state.isAnswered).length);
    let answeredQuestionCount = $derived(questionRows.length - openQuestionCount);

    function createQuestion(): void {
        const body = draftQuestion.trim();
        if (!questionCreation || body.length === 0 || body.length > maxQuestionLength) {
            return;
        }

        questionCreation
            .create({ body })
            .then(() => {
                draftQuestion = "";
            })
            .catch((error) => console.error("Failed to create proximity question", error));
    }

    function toggleUpvote(question: ChatQuestionItem): void {
        question.toggleUpvote().catch((error) => console.error("Failed to update question upvote", error));
    }

    function markAnswered(question: ChatQuestionItem): void {
        question.markAnswered().catch((error) => console.error("Failed to mark question as answered", error));
    }

    function removeQuestion(question: ChatQuestionItem): void {
        question.remove().catch((error) => console.error("Failed to delete question", error));
    }
</script>

<div class="flex h-full min-h-0 flex-col" data-testid="proximityRoomSidePanelQuestions">
    {#if canCreateQuestion}
        <form
            class="quanta-question-form"
            onsubmit={(event) => {
                event.preventDefault();
                createQuestion();
            }}
        >
            <textarea
                id="proximity-question-input"
                rows="2"
                aria-label={$LL.chat.question.ask()}
                maxlength={maxQuestionLength}
                placeholder={$LL.chat.question.placeholder()}
                bind:value={draftQuestion}
                data-testid="proximityQuestionInput"
            ></textarea>
            <button
                type="submit"
                class="quanta-card-action"
                title={$LL.chat.question.send()}
                aria-label={$LL.chat.question.send()}
                disabled={draftQuestion.trim().length === 0}
                data-testid="proximityQuestionSubmit"
            >
                <IconSend font-size={16} />
            </button>
        </form>
    {/if}

    <div class="quanta-panel-tabs" role="tablist">
        <button
            type="button"
            role="tab"
            aria-selected={activeFilter === "open"}
            onclick={() => (activeFilter = "open")}
            data-testid="proximityQuestionsOpenFilter"
        >
            {$LL.chat.question.toAnswer({ count: openQuestionCount })}
        </button>
        <button
            type="button"
            role="tab"
            aria-selected={activeFilter === "answered"}
            onclick={() => (activeFilter = "answered")}
            data-testid="proximityQuestionsAnsweredFilter"
        >
            {$LL.chat.question.answeredFilter({ count: answeredQuestionCount })}
        </button>
    </div>

    <div class="quanta-panel-list">
        {#if filteredQuestionRows.length === 0}
            <p class="quanta-panel-empty">
                {activeFilter === "open" ? $LL.chat.question.emptyOpen() : $LL.chat.question.emptyAnswered()}
            </p>
        {:else}
            {#each filteredQuestionRows as { question, state } (question.id)}
                <article class="quanta-card quanta-card-full" data-testid="proximityQuestionItem">
                    <div class="quanta-card-body quanta-card-body-first">{state.body}</div>
                    <div class="quanta-card-meta">
                        <span>{state.senderName ?? $LL.chat.question.unknownAuthor()}</span>
                        <span
                            >{new Date(state.createdAt).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                            })}</span
                        >
                    </div>
                    <div class="quanta-card-foot">
                        <button
                            type="button"
                            class="quanta-card-action"
                            class:quanta-card-action-on={state.hasUpvoted}
                            disabled={!state.canUpvote}
                            title={$LL.chat.question.upvote()}
                            aria-label={$LL.chat.question.upvote()}
                            aria-pressed={state.hasUpvoted}
                            data-testid="proximityQuestionUpvoteButton"
                            onclick={() => toggleUpvote(question)}
                        >
                            <IconThumbUp font-size={14} />
                            <span>{state.upvoteCount}</span>
                        </button>
                        {#if state.isAnswered}
                            <span class="quanta-card-done">
                                <IconCheck font-size={14} />
                                <span class="quanta-card-label">{$LL.chat.question.answered()}</span>
                            </span>
                        {:else if state.canMarkAnswered}
                            <button
                                type="button"
                                class="quanta-card-action"
                                title={$LL.chat.question.markAnswered()}
                                aria-label={$LL.chat.question.markAnswered()}
                                data-testid="proximityQuestionMarkAnsweredButton"
                                onclick={() => markAnswered(question)}
                            >
                                <IconCheck font-size={14} />
                                <span class="quanta-card-label">{$QL.questionMarkAnswered()}</span>
                            </button>
                        {/if}
                        <span class="quanta-card-gap"></span>
                        {#if state.canDelete}
                            <button
                                type="button"
                                class="quanta-card-action"
                                title={$LL.chat.delete()}
                                aria-label={$LL.chat.delete()}
                                data-testid="proximityQuestionDeleteButton"
                                onclick={() => removeQuestion(question)}
                            >
                                <IconTrash font-size={14} />
                            </button>
                        {/if}
                    </div>
                </article>
            {/each}
        {/if}
    </div>
</div>
