<script lang="ts">
    import { readable, type Readable } from "svelte/store";
    import { Marked } from "marked";
    import type { ChatMessageContent } from "../../../Connection/ChatConnection";
    import { resolveChatLinkClick } from "../../../Links/ChatLinkPolicy";
    import { openChatLinkAsCoWebsite } from "../../../Utils";
    import { QUANTA_UI } from "../../../../Enum/EnvironmentVariable";
    import { sanitizeHTML } from "./WA-HTML-Sanitizer";
    import { markMentions, type Mention } from "../../../../quanta/mentions";
    import { roomModerationStore } from "../../../../quanta/moderationBridge";
    import { fullNamesStore } from "../../../../quanta/fullNames";

    interface Props {
        content: Readable<ChatMessageContent>;
        hasDepth: false;
        message?: object;
    }

    let { content, hasDepth, message = undefined }: Props = $props();

    // quanta: the people a class chat message names with @ (quanta/mentions.ts), highlighted; the viewer's own stronger.
    const noMentions = readable<Mention[]>([]);
    let mentions = $derived(
        message && "mentions" in message ? (message.mentions as Readable<Mention[]>) : noMentions,
    );

    async function getMarked(body: string): Promise<Marked> {
        let marked: Marked;

        // Let's lazy load hljs and markedHighlight if the message contains ```.
        if (body.includes("```")) {
            const hljsPromise = import("highlight.js");
            const markedHighlightPromise = import("marked-highlight");
            const [hljsModule, markedHighlightModule] = await Promise.all([hljsPromise, markedHighlightPromise]);

            marked = new Marked(
                markedHighlightModule.markedHighlight({
                    langPrefix: "hljs language-",
                    highlight(code, lang) {
                        const language = hljsModule.default.getLanguage(lang) ? lang : "plaintext";
                        return hljsModule.default.highlight(code, { language }).value;
                    },
                }),
            );
        } else {
            marked = new Marked();
        }

        // Custom renderer for links
        const renderer = new marked.Renderer();
        renderer.link = function ({ href, title, tokens }) {
            const titleAttr = title ? `title="${title}"` : "";
            const text = this.parser.parseInline(tokens);
            return `<a href="${href}" target="_blank" rel="noopener noreferrer" ${titleAttr} style="color: white;">${text}</a>`;
        };

        // Apply the custom renderer and enable line breaks
        marked.use({
            renderer,
            breaks: true,
            ...(QUANTA_UI && {
                tokenizer: {
                    emStrong: () => undefined,
                    del: () => undefined,
                },
            }),
        });

        return marked;
    }

    let html = $state("");

    // quanta: follows the content store it is given now: the class chat replaces a message's store when it is edited,
    // and the timeline keeps this component for the same message. A slower parse of an older body never wins.
    let parses = 0;
    $effect(() => {
        return content.subscribe((value) => {
            const parse = ++parses;
            let promiseHtml = getMarked(value.body).then((marked) =>
                // quanta: a class's chat is text and links. Lists, headings, rules and emphasis would eat what a
                // maths class types: "+", "- 3", "+ -", "# 5", "2*3*4".
                QUANTA_UI ? marked.parseInline(value.body, { async: false }) : marked.parse(value.body),
            );
            promiseHtml
                .then((result) => {
                    if (parse === parses) html = result;
                })
                .catch((error) => {
                    console.error("Failed to parse markdown content", error);
                    if (parse === parses) html = value.body;
                });
        });
    });

    let opening = $state(false);

    // Delegated so it covers both the links marked builds from plain bodies and the ones
    // already baked into the formatted_body HTML of a reply, which never reach our renderer.
    function onBubbleClick(event: MouseEvent) {
        const target = event.target;
        if (!(target instanceof Element)) {
            return;
        }
        const anchor = target.closest("a");
        if (!(anchor instanceof HTMLAnchorElement)) {
            return;
        }

        // quanta: a link someone shares in class opens in a new tab; a panel over the room hides the room.
        const url = QUANTA_UI ? undefined : resolveChatLinkClick(anchor, event);
        if (url === undefined) {
            return;
        }

        event.preventDefault();

        // Probing embeddability is a round trip; ignore repeat clicks while one is in flight.
        if (opening) {
            return;
        }
        opening = true;

        (async () => {
            try {
                await openChatLinkAsCoWebsite(url);
            } finally {
                opening = false;
            }
        })().catch((error) => console.error("Failed to open chat link", error));
    }

    /* eslint-disable svelte/no-at-html-tags */
</script>

<!-- The click target is always a real anchor, which already handles Enter and focus itself. -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
    class="message-bubble m-0 {hasDepth ? 'text-xs leading-4' : 'text-sm'} text-white py-1 px-3"
    class:cursor-wait={opening}
    aria-busy={opening}
    lang=""
    onclick={onBubbleClick}
>
    {@html markMentions(sanitizeHTML(html), $mentions, $roomModerationStore?.self, $fullNamesStore)}
</div>

<style>
</style>
