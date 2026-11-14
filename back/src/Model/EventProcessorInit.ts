import { EventProcessor } from "./EventProcessor";

export const eventProcessor = new EventProcessor();

eventProcessor.registerPublicEventProcessor("spaceMessage", (event, senderId, space) => {
    if (event.$case !== "spaceMessage") {
        // FIXME: improve the typing of the method to avoid this
        throw new Error("Invalid event type");
    }

    const sender = space.getUser(senderId);

    if (!sender) {
        throw new Error("Sender not found");
    }

    return Promise.resolve({
        $case: "spaceMessage",
        spaceMessage: {
            message: event.spaceMessage.message,
            characterTextures: sender.characterTextures,
            name: sender.name,
            // quanta: the sender's own id for the message, which reactions and edits name (QuantaChatAction).
            id: typeof event.spaceMessage.id === "string" ? event.spaceMessage.id.slice(0, 64) : undefined,
        },
    });
});

// quanta: a nearby chat's reaction, edit or deletion; bounded here, applied by each client (ProximityChatRoom.ts).
const CHAT_ACTION_OPS = new Set(["react", "edit", "delete"]);
eventProcessor.registerPublicEventProcessor("quantaChatAction", (event) => {
    if (event.$case !== "quantaChatAction") {
        throw new Error("Invalid event type");
    }
    const action = event.quantaChatAction;
    if (!CHAT_ACTION_OPS.has(action.op) || !action.messageId || action.messageId.length > 64) {
        throw new Error("Invalid chat action");
    }
    return Promise.resolve({
        $case: "quantaChatAction",
        quantaChatAction: {
            messageId: action.messageId,
            op: action.op,
            emoji: action.op === "react" ? action.emoji.slice(0, 16) : "",
            text: action.op === "edit" ? action.text.slice(0, 4000) : "",
        },
    });
});

eventProcessor.registerPublicEventProcessor("spaceIsTyping", (event, senderId, space) => {
    if (event.$case !== "spaceIsTyping") {
        // FIXME: improve the typing of the method to avoid this
        throw new Error("Invalid event type");
    }

    const sender = space.getUser(senderId);

    if (!sender) {
        throw new Error("Sender not found");
    }

    return Promise.resolve({
        $case: "spaceIsTyping",
        spaceIsTyping: {
            isTyping: event.spaceIsTyping.isTyping,
            characterTextures: sender.characterTextures,
            name: sender.name,
        },
    });
});
