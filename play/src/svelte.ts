import "./front/style/index.css";

import { mount } from "svelte";
import App from "./front/Components/App.svelte";
import { HtmlUtils } from "./front/WebRtc/HtmlUtils";
import { e2eHooks } from "./front/Utils/E2EHooks";
import { QUANTA_UI } from "./front/Enum/EnvironmentVariable";
import "./front/quanta/quanta-ui.css";

// Initialize E2E hooks
declare global {
    interface Window {
        e2eHooks: typeof e2eHooks;
    }
}
window.e2eHooks = e2eHooks;

// quanta: every WA screen takes the room's style, error screens included, before anything is shown.
if (QUANTA_UI) document.documentElement.classList.add("quanta-ui");

const app = mount(App, {
    target: HtmlUtils.getElementByIdOrFail("app"),
});

export default app;
