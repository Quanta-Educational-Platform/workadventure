<script lang="ts">
    import { get } from "svelte/store";
    import type { ChatMessage } from "../../Connection/ChatConnection";
    import { selectedChatMessageToEdit } from "../../Stores/ChatStore";
    import LL from "../../../../i18n/i18n-svelte";
    import { chatInputFromBody } from "../../../../common/quanta/chatBody";
    import { QUANTA_UI } from "../../../Enum/EnvironmentVariable";
    import MessageInput from "./MessageInput.svelte";

    interface Props {
        message: ChatMessage;
    }

    let { message }: Props = $props();
    let messageInput: HTMLDivElement | undefined = $state();

    // quanta: the class chat's bodies are the box's text with newlines for its line breaks (common/quanta/chatBody.ts).
    let inputValue = $state(
        (() => {
            const body = get(message.content).body;
            return message.type === "proximity" ? chatInputFromBody(body) : body;
        })(),
    );
    let editError = $state(false);

    async function editMessage(newContent: string) {
        try {
            await message.edit(newContent);
            selectedChatMessageToEdit.set(null);
        } catch (error) {
            console.error(error);
            editError = true;
            setTimeout(() => {
                editError = false;
            }, 2000);
        }
    }
</script>

<div>
    <MessageInput
        bind:message={inputValue}
        bind:messageInput
        dataTestid="editMessageInput"
        inputClass={`p-1 !m-0 px-2 max-h-36 overflow-auto w-full h-full rounded-md !leading-6 block !text-sm placeholder:text-sm border resize-none shadow-none focus:ring-0 ${QUANTA_UI ? "!bg-[#2b3038] !text-[#eceef1]" : "!text-white !bg-white/20 !text-black"}`}
        dataText={$LL.chat.enter()}
    />

    {#if editError}
        <p class="text-red-500 text-xxs p-0 m-0">{$LL.chat.messageEditedError()}</p>
    {/if}
    <div class="flex flew-row gap-1 justify-center p-1">
        <button
            class="hover:bg-white/10 text-white py-0.5 text-sm px-3 w-full text-center items-center justify-center rounded"
            data-testid="cancelMessageEditionButton"
            onclick={() => selectedChatMessageToEdit.set(null)}
        >
            {$LL.chat.createRoom.buttons.cancel()}
        </button>
        <button
            class="bg-white hover:bg-white/80 text-secondary py-0.5 text-sm px-3 w-full text-center items-center justify-center rounded"
            data-testid="saveMessageEditionButton"
            onclick={() => editMessage(inputValue)}
        >
            {$LL.chat.createRoom.buttons.edit()}
        </button>
    </div>
</div>
