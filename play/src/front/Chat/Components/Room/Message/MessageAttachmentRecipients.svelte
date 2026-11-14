<script lang="ts">
    import type { Readable } from "svelte/store";
    import type { ChatAttachmentRecipient } from "../../../Connection/ChatConnection";
    import { fullNamesStore, shownName } from "../../../../quanta/fullNames";
    import Avatar from "../../Avatar.svelte";
    import LL from "../../../../../i18n/i18n-svelte";
    import { IconCheck, IconChevronDown } from "@wa-icons";

    interface Props {
        recipients: Readable<ChatAttachmentRecipient[]>;
    }

    let { recipients }: Props = $props();

    let received = $derived($recipients.filter((recipient) => recipient.state === "received").length);
    let pending = $derived($recipients.filter((recipient) => recipient.state === "waiting").length);
    let failed = $derived($recipients.filter((recipient) => recipient.state === "failed"));
    let allReceived = $derived(received === $recipients.length);

    // quanta: one line that says whether it arrived; names only when asked for, or for those it did not reach.
    const STACK_MAX = 5;
    let expanded = $state(false);
    let shown = $derived(expanded ? $recipients : failed);

    function label(recipient: ChatAttachmentRecipient): string {
        return recipient.state === "sending"
            ? `${Math.floor(recipient.progress * 100)}%`
            : $LL.chat.file.recipient[recipient.state]();
    }

    const labelClass: Record<ChatAttachmentRecipient["state"], string> = {
        waiting: "recipient-waiting text-warning-400",
        sending: "font-bold",
        received: "recipient-received text-success-300",
        declined: "opacity-70",
        failed: "recipient-failed text-danger-100",
    };
</script>

{#if $recipients.length > 0}
    <div class="quanta-attachment-recipients px-2 pb-2 text-white text-xs">
        <button
            type="button"
            class="w-full flex items-center gap-2 m-0 p-0.5 bg-transparent border-0 text-inherit text-left cursor-pointer"
            aria-expanded={expanded}
            onclick={() => (expanded = !expanded)}
        >
            {#if allReceived}
                <span class="recipient-received text-success-300 flex shrink-0"><IconCheck font-size="14" /></span>
            {/if}
            <span class="font-bold min-w-0"
                >{$LL.chat.file.recipient.summary({ received, total: $recipients.length })}</span
            >
            {#if pending > 0}
                <span class="recipient-waiting text-warning-400 min-w-0"
                    >{$LL.chat.file.recipient.pending({ pending })}</span
                >
            {/if}
            <span class="ml-auto flex items-center shrink-0" aria-hidden="true">
                {#each $recipients.slice(0, STACK_MAX) as recipient, index (recipient.spaceUserId)}
                    <span class="block w-5 h-5 rounded-full overflow-hidden {index > 0 ? '-ml-1.5' : ''}">
                        <Avatar
                            pictureStore={recipient.pictureStore}
                            fallbackName={shownName($fullNamesStore, recipient.uuid, recipient.name)}
                            color={recipient.color}
                            compact
                        />
                    </span>
                {/each}
                {#if $recipients.length > STACK_MAX}
                    <span class="ml-1 opacity-80">+{$recipients.length - STACK_MAX}</span>
                {/if}
                <span class="ml-1 flex transition-transform {expanded ? 'rotate-180' : ''}"
                    ><IconChevronDown font-size="14" /></span
                >
            </span>
        </button>
        {#if shown.length > 0}
            <ul class="list-none m-0 p-0 pt-2 flex flex-col gap-1.5">
                {#each shown as recipient (recipient.spaceUserId)}
                    <li class="flex items-center gap-2" data-testid="attachmentRecipient">
                        <span class="block w-6 h-6 shrink-0 rounded-full overflow-hidden">
                            <Avatar
                                pictureStore={recipient.pictureStore}
                                fallbackName={shownName($fullNamesStore, recipient.uuid, recipient.name)}
                                color={recipient.color}
                                compact
                            />
                        </span>
                        <span class="min-w-0 flex-1">{shownName($fullNamesStore, recipient.uuid, recipient.name)}</span>
                        {#if recipient.state === "sending"}
                            <span
                                role="progressbar"
                                aria-label={$LL.chat.file.recipient.sending()}
                                aria-valuemin="0"
                                aria-valuemax="100"
                                aria-valuenow={Math.floor(recipient.progress * 100)}
                                class="shrink-0 {labelClass.sending}">{label(recipient)}</span
                            >
                        {:else}
                            <span class="shrink-0 whitespace-nowrap {labelClass[recipient.state]}"
                                >{label(recipient)}</span
                            >
                        {/if}
                    </li>
                {/each}
            </ul>
        {/if}
    </div>
{/if}
