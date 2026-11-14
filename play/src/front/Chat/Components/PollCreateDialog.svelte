<script lang="ts">
    import type { ChatPollCreationCapability, ChatPollKind } from "../Connection/ChatConnection";
    import Popup from "../../Components/Modal/Popup.svelte";
    import { chatInputFocusStore } from "../../Stores/ChatStore";
    import LL from "../../../i18n/i18n-svelte";
    import { IconLoader, IconPlus, IconX } from "@wa-icons";
    import { modals } from "@wa-modals";

    interface Props {
        pollCreation: ChatPollCreationCapability;
    }

    let { pollCreation }: Props = $props();

    let limits = $derived(pollCreation.limits);
    let canCreatePoll = $derived(pollCreation.canCreate);
    let supportedKinds = $derived(pollCreation.supportedKinds);

    let question = $state("");
    let selectedKind: ChatPollKind = $state((() => supportedKinds[0] ?? "open")());
    let answers = $state((() => Array.from({ length: limits.minAnswers }, () => ""))());
    let errorMessage: string | undefined = $state();
    let isSubmitting = $state(false);

    let normalizedAnswers = $derived(answers.map((answer) => answer.trim()).filter((answer) => answer.length > 0));
    let canAddAnswer = $derived(answers.length < limits.maxAnswers);
    let hasInvalidAnswerLength = $derived(answers.some((answer) => answer.length > limits.answerMaxLength));
    let canSubmit = $derived(
        $canCreatePoll &&
            supportedKinds.length > 0 &&
            question.trim().length > 0 &&
            question.length <= limits.questionMaxLength &&
            normalizedAnswers.length >= limits.minAnswers &&
            !hasInvalidAnswerLength &&
            !isSubmitting,
    );

    function focusChatInput() {
        // Disable input manager to prevent the game from receiving the input
        chatInputFocusStore.set(true);
    }

    function unfocusChatInput() {
        // Enable input manager to allow the game to receive the input
        chatInputFocusStore.set(false);
    }

    function addAnswer() {
        if (!canAddAnswer) {
            return;
        }

        answers = [...answers, ""];
    }

    function removeAnswer(index: number) {
        if (answers.length <= limits.minAnswers) {
            return;
        }

        answers = answers.filter((_, answerIndex) => answerIndex !== index);
    }

    async function createPoll() {
        errorMessage = undefined;

        if (!canSubmit) {
            errorMessage = $LL.chat.poll.create.validationError();
            return;
        }

        isSubmitting = true;
        try {
            await pollCreation.create({
                question: question.trim(),
                answers: normalizedAnswers,
                kind: selectedKind,
            });
            modals.close();
        } catch (error) {
            console.error("Failed to create poll", error);
            errorMessage = $LL.chat.poll.create.submitError();
        } finally {
            isSubmitting = false;
        }
    }
</script>

<Popup isOpen withAction>
    {#snippet title()}
        <h1 class="quanta-poll-create-title">{$LL.chat.poll.create.title()}</h1>
    {/snippet}

    {#snippet content()}
        <div class="quanta-poll-create">
            <!-- svelte-ignore a11y_autofocus -->
            <textarea
                data-testid="createPollQuestionInput"
                id="poll-question"
                rows="2"
                autofocus
                aria-label={$LL.chat.poll.create.question()}
                placeholder={$LL.chat.poll.create.questionPlaceholder()}
                bind:value={question}
                maxlength={limits.questionMaxLength}
                onfocus={focusChatInput}
                onblur={unfocusChatInput}
            ></textarea>

            <div class="quanta-poll-create-answers" role="group" aria-label={$LL.chat.poll.create.answers()}>
                {#each answers as answer, index (index)}
                    <div class="quanta-poll-create-answer">
                        <input
                            data-testid={`createPollAnswerInput-${index}`}
                            bind:value={answers[index]}
                            maxlength={limits.answerMaxLength}
                            placeholder={$LL.chat.poll.create.answerPlaceholder({ index: index + 1 })}
                            onfocus={focusChatInput}
                            onblur={unfocusChatInput}
                        />
                        {#if answers.length > limits.minAnswers}
                            <button
                                type="button"
                                class="quanta-card-action"
                                title={$LL.chat.poll.create.removeAnswer({ index: index + 1 })}
                                aria-label={$LL.chat.poll.create.removeAnswer({ index: index + 1 })}
                                onclick={() => removeAnswer(index)}
                            >
                                <IconX font-size={14} />
                            </button>
                        {/if}
                    </div>
                {/each}
                {#if canAddAnswer}
                    <button type="button" class="quanta-card-action quanta-poll-create-add" onclick={addAnswer}>
                        <IconPlus font-size={14} />
                        {$LL.chat.poll.create.addAnswer()}
                    </button>
                {/if}
            </div>

            {#if supportedKinds.includes("open") && supportedKinds.includes("closed")}
                <label class="quanta-poll-create-hide" data-testid="createPollVisibilityClosed">
                    <input
                        type="checkbox"
                        checked={selectedKind === "closed"}
                        onchange={(event) => (selectedKind = event.currentTarget.checked ? "closed" : "open")}
                    />
                    {$LL.chat.poll.create.closedDescription()}
                </label>
            {/if}

            {#if errorMessage}
                <div class="quanta-card-note quanta-card-error">{errorMessage}</div>
            {/if}
        </div>
    {/snippet}

    {#snippet action()}
        <div class="quanta-poll-create-actions">
            <button type="button" class="quanta-poll-create-cancel" onclick={() => modals.close()}>
                {$LL.chat.poll.create.cancel()}
            </button>
            <button
                type="button"
                class="quanta-poll-create-submit"
                data-testid="submitCreatePollButton"
                disabled={!canSubmit}
                onclick={createPoll}
            >
                {#if isSubmitting}
                    <IconLoader class="animate-[spin_2s_linear_infinite]" font-size={14} />
                {/if}
                {$LL.chat.poll.create.submit()}
            </button>
        </div>
    {/snippet}
</Popup>
