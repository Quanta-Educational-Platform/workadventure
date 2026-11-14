// quanta: before anything that might read or report the address: takes a sign-in code out of it.
import "./front/quanta/signInCode";
// quanta: first, before WA's own modules keep the native RTCPeerConnection.
import "./front/quanta/peerConnections";
import "./front/style/index.css";

import { mount } from "svelte";
import App from "./front/Components/App.svelte";
import { HtmlUtils } from "./front/WebRtc/HtmlUtils";
import { e2eHooks } from "./front/Utils/E2EHooks";
import { QUANTA_UI } from "./front/Enum/EnvironmentVariable";
// quanta: Quanta's own typeface, for the room's interface under QUANTA_UI (quanta-ui.css); only fetched where used.
import "@fontsource/fira-sans/400.css";
import "@fontsource/fira-sans/500.css";
import "@fontsource/fira-sans/600.css";
// The weights the map's workspace signs are lettered in (quanta/brandAreas.ts).
import "@fontsource/fira-sans/700.css";
import "@fontsource/fira-sans/800.css";
import "./front/quanta/quanta-ui.css";
import { startRoomBridge } from "./front/quanta/roomBridge";
import { startEmojiCentre } from "./front/quanta/emojiCentre";
import { startStagingOverlay } from "./front/quanta/stagingOverlay";
import { startPageMenu } from "./front/quanta/pageMenu";
import { startPresentBoardBridge } from "./front/quanta/presentBoardBridge";

// Initialize E2E hooks
declare global {
    interface Window {
        e2eHooks: typeof e2eHooks;
    }
}
window.e2eHooks = e2eHooks;

// quanta: every WA screen takes the room's style, error screens included, before anything is shown.
if (QUANTA_UI) {
    document.documentElement.classList.add("quanta-ui");
    startRoomBridge();
    startEmojiCentre();
    startStagingOverlay();
    startPageMenu();
    startPresentBoardBridge();
}

const app = mount(App, {
    target: HtmlUtils.getElementByIdOrFail("app"),
});

export default app;
