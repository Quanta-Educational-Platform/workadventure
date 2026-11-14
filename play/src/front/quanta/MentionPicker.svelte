<script lang="ts">
    // quanta: the people "@" offers in a chat's box (mentions.ts), over the box. The box keeps the keyboard: arrows move
    // the choice, Enter or Tab takes it, Escape closes; a tap takes one without the box losing focus.
    import type { MentionPerson } from "./mentions";
    import { QL } from "./i18n";

    let {
        people,
        active,
        id,
        onpick,
        insertsName = false,
    }: {
        people: MentionPerson[];
        active: number;
        id: string;
        onpick: (person: MentionPerson) => void;
        /** The box writes the server's name (the class chat): shown beside a real name, so the teacher knows. */
        insertsName?: boolean;
    } = $props();

    let list: HTMLUListElement | undefined = $state();
    $effect(() => {
        list?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
    });
</script>

<ul class="quanta-mention-picker" role="listbox" {id} aria-label={$QL.mentionPeople()} bind:this={list}>
    {#each people as person, index (person.id)}
        <li
            id="{id}-{index}"
            role="option"
            aria-selected={index === active}
            data-index={index}
            data-testid="mentionOption"
            onpointerdown={(event) => event.preventDefault()}
            onclick={() => onpick(person)}
            onkeydown={() => {}}
        >
            <span class="name"
                >{person.shown}{#if insertsName && person.name !== person.shown}<span class="handle"
                        >@{person.name}</span
                    >{/if}</span
            >
            {#if person.staff}<span class="role">{$QL.mentionTeacher()}</span>{/if}
        </li>
    {/each}
</ul>

<style>
    .quanta-mention-picker {
        position: absolute;
        left: 8px;
        right: 8px;
        bottom: calc(100% + 4px);
        z-index: 40;
        max-height: 232px;
        margin: 0;
        padding: 4px;
        overflow-y: auto;
        list-style: none;
        border-radius: 12px;
        background: #2b3038;
        box-shadow:
            0 0 0 1px rgb(255 255 255 / 0.08),
            0 8px 24px rgb(0 0 0 / 0.45);
    }

    li {
        display: flex;
        align-items: baseline;
        gap: 8px;
        min-height: 36px;
        padding: 8px 10px;
        border-radius: 8px;
        font-size: 14px;
        line-height: 20px;
        color: #eceef1;
        cursor: pointer;
        user-select: none;
    }

    li[aria-selected="true"] {
        background: rgb(255 255 255 / 0.1);
    }

    @media (hover: hover) {
        li:hover {
            background: rgb(255 255 255 / 0.07);
        }
    }

    .name {
        min-width: 0;
        overflow-wrap: anywhere;
    }

    .handle {
        margin-left: 6px;
        font-size: 12px;
        color: #8b919b;
    }

    .role {
        flex: none;
        margin-left: auto;
        font-size: 12px;
        color: #8b919b;
    }
</style>
