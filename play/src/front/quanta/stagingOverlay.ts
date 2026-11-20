// quanta: on the staging room only, a stylesheet kept in DEV storage is laid over the room's own and re-read every few
// seconds, so a look fix can be tried on staging in seconds before it is built in. Any other host never fetches it.
const STAGING_HOST = "wa-dev.qed.world";
const OVERLAY_URL =
    "https://devdb.qed.world/storage/v1/object/public/quanta-public/wa-staging/overlay.css";
const EVERY_MS = 3000;

export function startStagingOverlay(): void {
    if (window.location.hostname !== STAGING_HOST) return;
    const style = document.createElement("style");
    style.dataset.quantaStagingOverlay = "";
    let last = "";
    const read = async () => {
        try {
            const response = await fetch(`${OVERLAY_URL}?t=${Date.now()}`, { cache: "no-store" });
            const text = response.ok ? await response.text() : "";
            if (text === last) return;
            last = text;
            style.textContent = text;
            // Last in the head, so it wins over the room's own rules of the same weight.
            document.head.appendChild(style);
        } catch {
            // Staging only: a missed read is tried again on the next tick.
        }
    };
    void read();
    setInterval(() => void read(), EVERY_MS);
}
