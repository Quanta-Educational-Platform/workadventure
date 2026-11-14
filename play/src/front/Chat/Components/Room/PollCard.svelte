<script lang="ts">
    import LL, { locale } from "../../../../i18n/i18n-svelte";
    import type { ChatPollAnswer, ChatPollItem } from "../../Connection/ChatConnection";
    import { QL } from "../../../quanta/i18n";
    import { IconCheck, IconLoader, IconLock, IconTrash } from "@wa-icons";

    interface Props {
        poll: ChatPollItem;
    }

    let { poll }: Props = $props();

    let { state: pollState, date, canVote, canEnd, canDelete } = $derived(poll);
    let localSelection: string[] = $state([]);
    let isDirty = $state(false);
    let isSubmittingVote = $state(false);
    let isEndingPoll = $state(false);
    let isDeletingPoll = $state(false);
    let errorMessage: string | undefined = $state();

    $effect(() => {
        if (!isDirty) {
            localSelection = [...$pollState.myAnswerIds];
        }
    });

    let senderDisplayName = $derived(
        poll.sender?.username && poll.sender.username !== poll.sender.chatId ? poll.sender.username : undefined,
    );
    function getAnswerResult(answer: ChatPollAnswer) {
        return `${answer.votes} (${answer.percentage}%)`;
    }

    function computeNextSelection(answerId: string): string[] {
        if ($pollState.maxSelections === 1) {
            return localSelection[0] === answerId ? [] : [answerId];
        }

        if (localSelection.includes(answerId)) {
            return localSelection.filter((existingAnswerId) => existingAnswerId !== answerId);
        }

        if (localSelection.length >= $pollState.maxSelections) {
            return [...localSelection.slice(1), answerId];
        }

        return [...localSelection, answerId];
    }

    async function voteFromAnswerClick(answerId: string) {
        if ($pollState.isEnded || !$canVote || isSubmittingVote) {
            return;
        }

        errorMessage = undefined;
        const nextSelection = computeNextSelection(answerId);

        if (haveSameSelection(nextSelection, $pollState.myAnswerIds)) {
            return;
        }

        isSubmittingVote = true;
        isDirty = true;
        localSelection = [...nextSelection];

        try {
            await poll.vote(nextSelection);
        } catch (error) {
            console.error("Failed to submit poll vote", error);
            errorMessage = $LL.chat.poll.submitError();
        } finally {
            isDirty = false;
            // A second vote cannot start while this guarded request is in progress.
            // eslint-disable-next-line require-atomic-updates
            isSubmittingVote = false;
        }
    }

    async function endPoll() {
        isEndingPoll = true;
        errorMessage = undefined;
        try {
            await poll.end();
        } catch (error) {
            console.error("Failed to end poll", error);
            errorMessage = $LL.chat.poll.endError();
        } finally {
            isEndingPoll = false;
        }
    }

    async function deletePoll() {
        isDeletingPoll = true;
        errorMessage = undefined;
        try {
            await poll.remove();
        } catch (error) {
            console.error("Failed to delete poll", error);
            errorMessage = $LL.chat.poll.deleteError();
        } finally {
            isDeletingPoll = false;
        }
    }

    function haveSameSelection(left: string[], right: string[]) {
        if (left.length !== right.length) {
            return false;
        }

        const leftSorted = [...left].sort();
        const rightSorted = [...right].sort();
        return leftSorted.every((answerId, index) => answerId === rightSorted[index]);
    }
</script>

<div class="quanta-card-row">
    <div data-testid="pollCard" class="poll-card quanta-card">
        <div data-testid="pollQuestion" class="quanta-card-title">{$pollState.question}</div>
        <div class="quanta-card-meta">
            {#if senderDisplayName}<span data-testid="pollCreatorName">{senderDisplayName}</span>{/if}
            {#if date}<span
                    >{date.toLocaleTimeString($locale, {
                        hour: "2-digit",
                        minute: "2-digit",
                    })}</span
                >{/if}
            {#if $pollState.isEnded}<span>{$LL.chat.poll.status.closed()}</span>{/if}
            {#if $pollState.maxSelections > 1}<span
                    >{$LL.chat.poll.multiSelect({ count: $pollState.maxSelections })}</span
                >{/if}
        </div>

        {#if !$pollState.isEnded && !$pollState.resultsVisible && !$canVote}
            <!-- Nothing to pick and nothing to show yet: the note below says when results come. -->
        {:else}
            <div class="quanta-poll-options" class:quanta-poll-results={$pollState.resultsVisible}>
                {#each $pollState.answers as answer (answer.id)}
                    {@const selected = localSelection.includes(answer.id)}
                    {#snippet option()}
                        {#if $pollState.resultsVisible}
                            <span class="quanta-poll-percent">{answer.percentage}%</span>
                        {:else}
                            <span
                                class="quanta-poll-mark"
                                class:quanta-poll-mark-many={$pollState.maxSelections > 1}
                                class:quanta-poll-mark-on={selected}
                            >
                                {#if isSubmittingVote && selected}
                                    <IconLoader class="animate-[spin_2s_linear_infinite]" font-size={12} />
                                {:else if selected}
                                    <IconCheck font-size={12} />
                                {/if}
                            </span>
                        {/if}
                        <span class="quanta-poll-text" class:quanta-poll-text-won={answer.isWinning && $pollState.isEnded}>
                            {answer.text}
                            {#if selected && $pollState.resultsVisible}
                                <span class="quanta-poll-chosen"><IconCheck font-size={12} /></span>
                            {/if}
                        </span>
                        <span class="quanta-poll-line">
                            {#if $pollState.resultsVisible}
                                <i style:width={`${answer.percentage}%`}></i>
                            {/if}
                        </span>
                    {/snippet}
                    {#if !$pollState.isEnded && $canVote}
                        <button
                            type="button"
                            data-testid={`pollAnswer-${answer.id}`}
                            aria-pressed={selected}
                            class="quanta-poll-option"
                            disabled={isSubmittingVote}
                            title={getAnswerResult(answer)}
                            onclick={() => voteFromAnswerClick(answer.id)}
                        >
                            {@render option()}
                        </button>
                    {:else}
                        <div class="quanta-poll-option" title={getAnswerResult(answer)}>
                            {@render option()}
                        </div>
                    {/if}
                {/each}
            </div>
        {/if}

        {#if $pollState.isEnded && $pollState.closingMessage}
            <div class="quanta-card-note">{$pollState.closingMessage}</div>
        {/if}

        {#if errorMessage}
            <div class="quanta-card-note quanta-card-error">{errorMessage}</div>
        {/if}

        <div class="quanta-card-foot">
            <span class="quanta-card-count" data-testid="pollParticipantsCount">
                {#if !$pollState.resultsVisible && !$pollState.isEnded}
                    {$pollState.kind === "open" ? $LL.chat.poll.resultsAfterVote() : $LL.chat.poll.resultsWhenClosed()}
                {:else}
                    {$LL.chat.poll.participants({ count: $pollState.totalVotes })}
                    {#if $pollState.spoiledVotes > 0}
                        · {$LL.chat.poll.spoiledVotes({ count: $pollState.spoiledVotes })}
                    {/if}
                {/if}
            </span>
            {#if !$pollState.isEnded && $canEnd}
                <button
                    type="button"
                    data-testid="endPollButton"
                    class="quanta-card-action"
                    title={$LL.chat.poll.end.cta()}
                    aria-label={$LL.chat.poll.end.cta()}
                    disabled={isEndingPoll}
                    onclick={endPoll}
                >
                    {#if isEndingPoll}
                        <IconLoader class="animate-[spin_2s_linear_infinite]" font-size={14} />
                    {:else}
                        <IconLock font-size={14} />
                    {/if}
                    <span class="quanta-card-label">{$QL.pollClose()}</span>
                </button>
            {/if}
            {#if $canDelete}
                <button
                    type="button"
                    data-testid="deletePollButton"
                    class="quanta-card-action"
                    title={$LL.chat.delete()}
                    aria-label={$LL.chat.delete()}
                    disabled={isDeletingPoll}
                    onclick={deletePoll}
                >
                    {#if isDeletingPoll}
                        <IconLoader class="animate-[spin_2s_linear_infinite]" font-size={14} />
                    {:else}
                        <IconTrash font-size={14} />
                    {/if}
                </button>
            {/if}
        </div>
    </div>
</div>
