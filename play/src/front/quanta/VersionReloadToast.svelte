<script lang="ts">
    // quanta: the room is moving to a new build (quanta/versionReload.ts); the page reloads in a few seconds. In the
    // room's notice shape, over the top of the whole frame rather than in the stack: the room is going away, and beside
    // a board the map's window is too narrow to hold it.
    import Notice from "./Notice.svelte";
    import { QL } from "./i18n";
</script>

<div class="version-reload-notice" data-testid="version-reload-toast">
    <Notice icon="busy" text={$QL.roomUpdating()} />
</div>

<style>
    .version-reload-notice {
        position: fixed;
        top: 12px;
        left: var(--quanta-room-x, 50%);
        z-index: 2000;
        max-width: calc(var(--quanta-room-w, 100vw) - 24px);
        transform: translateX(-50%);
        pointer-events: none;
    }
</style>
