<script lang="ts">
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import type { ChatQuestionItem } from "../../Connection/ChatConnection";
    import { roomSidePanelStore } from "../../Stores/RoomSidePanelStore";
    import { QL } from "../../../quanta/i18n";
    import { IconCheck, IconHelpCircle, IconList, IconLoader, IconThumbUp, IconTrash } from "@wa-icons";

    type PendingAction = "upvote" | "answer" | "delete";

    interface Props {
        question: ChatQuestionItem;
    }

    let { question }: Props = $props();

    let questionState = $derived(question.state);
    let pending: PendingAction | undefined = $state();

    function run(action: PendingAction, request: () => Promise<void>) {
        if (pending) {
            return;
        }

        pending = action;
        request()
            .catch((error) => console.error(`Failed to ${action} question`, error))
            .finally(() => {
                pending = undefined;
            });
    }
</script>

<div class="quanta-card-row">
    <div data-testid="questionCard" class="question-card quanta-card">
        <div class="quanta-card-meta quanta-card-meta-top">
            <span class="quanta-card-kind"><IconHelpCircle font-size={12} />{$LL.chat.question.badge()}</span>
            <span>{$questionState.senderName ?? $LL.chat.question.unknownAuthor()}</span>
            <span
                >{new Date($questionState.createdAt).toLocaleTimeString($locale, {
                    hour: "2-digit",
                    minute: "2-digit",
                })}</span
            >
        </div>

        <div class="quanta-card-body">{$questionState.body}</div>

        <div class="quanta-card-foot">
            <button
                type="button"
                class="quanta-card-action"
                class:quanta-card-action-on={$questionState.hasUpvoted}
                disabled={!$questionState.canUpvote || pending === "upvote"}
                title={$LL.chat.question.upvote()}
                aria-label={$LL.chat.question.upvote()}
                aria-pressed={$questionState.hasUpvoted}
                data-testid="questionUpvoteButton"
                onclick={() => run("upvote", () => question.toggleUpvote())}
            >
                <IconThumbUp font-size={14} />
                <span data-testid="questionUpvoteCount">{$questionState.upvoteCount}</span>
            </button>

            {#if $questionState.isAnswered}
                <span class="quanta-card-done" data-testid="questionAnsweredBadge">
                    <IconCheck font-size={14} />
                    <span class="quanta-card-label">{$LL.chat.question.answered()}</span>
                </span>
            {:else if $questionState.canMarkAnswered}
                <button
                    type="button"
                    class="quanta-card-action"
                    disabled={pending === "answer"}
                    title={$LL.chat.question.markAnswered()}
                    aria-label={$LL.chat.question.markAnswered()}
                    data-testid="questionMarkAnsweredButton"
                    onclick={() => run("answer", () => question.markAnswered())}
                >
                    {#if pending === "answer"}
                        <IconLoader class="animate-[spin_2s_linear_infinite]" font-size={14} />
                    {:else}
                        <IconCheck font-size={14} />
                    {/if}
                    <span class="quanta-card-label">{$QL.questionMarkAnswered()}</span>
                </button>
            {/if}

            <span class="quanta-card-gap"></span>

            <button
                type="button"
                class="quanta-card-action"
                title={$LL.chat.question.viewAll()}
                aria-label={$LL.chat.question.viewAll()}
                data-testid="questionViewAllButton"
                onclick={() => roomSidePanelStore.setActiveSection("questions")}
            >
                <IconList font-size={14} />
                <span class="quanta-card-label">{$LL.chat.question.viewAll()}</span>
            </button>

            {#if $questionState.canDelete}
                <button
                    type="button"
                    class="quanta-card-action"
                    disabled={pending === "delete"}
                    title={$LL.chat.delete()}
                    aria-label={$LL.chat.delete()}
                    data-testid="questionDeleteButton"
                    onclick={() => run("delete", () => question.remove())}
                >
                    {#if pending === "delete"}
                        <IconLoader class="animate-[spin_2s_linear_infinite]" font-size={14} />
                    {:else}
                        <IconTrash font-size={14} />
                    {/if}
                </button>
            {/if}
        </div>
    </div>
</div>
