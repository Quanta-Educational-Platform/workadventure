import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync, mount, unmount } from "svelte";
import { readable, writable } from "svelte/store";

const env = vi.hoisted(() => ({ QUANTA_UI: true }));

vi.mock("../../../Enum/EnvironmentVariable", () => ({
    ENABLE_OPENID: false,
    SENTRY_DSN_FRONT: undefined,
    get QUANTA_UI() {
        return env.QUANTA_UI;
    },
}));

vi.mock("../../../Stores/MenuStore", async () => {
    const { writable, readable } = await import("svelte/store");
    const stub = () => undefined;
    // The right-hand bar as a QUANTA_UI room has it: invite, map tools, participants.
    const rightItem = (id: string) => ({ id, fallsInBurgerMenuStore: writable(true), component: stub, props: {} });
    return {
        openedMenuStore: { close: vi.fn(), subscribe: readable(undefined).subscribe },
        rightActionBarMenuItems: readable([rightItem("invite"), rightItem("maps"), rightItem("participant")]),
        showMenuItem: vi.fn(),
        SubMenusInterface: { settings: "settings" },
        userIsConnected: readable(true),
        helpTextDisabledStore: readable(false),
    };
});

vi.mock("../../../Administration/AnalyticsClient", () => ({ analyticsClient: { trackAdminEvent: vi.fn() } }));
vi.mock("../../../Connection/ConnectionManager", () => ({
    connectionManager: { currentRoom: { opidWokaNamePolicy: "allow_override_opid", isIssueReportEnabled: false } },
}));
vi.mock("../../../Phaser/Game/GameManager", () => ({ gameManager: {} }));
vi.mock("../../../Phaser/Login/EnableCameraScene", () => ({ EnableCameraScene: class {}, EnableCameraSceneName: "" }));
vi.mock("../../../Phaser/Login/LoginScene", () => ({ LoginScene: class {}, LoginSceneName: "" }));
vi.mock("../../../Phaser/Login/PwaInstallScene", () => ({ PwaInstallScene: class {}, PwaInstallSceneName: "" }));
vi.mock("../../../Phaser/Login/SelectCharacterScene", () => ({
    SelectCharacterScene: class {},
    SelectCharacterSceneName: "",
}));
vi.mock("../../../Phaser/Login/SelectCompanionScene", () => ({
    SelectCompanionScene: class {},
    SelectCompanionSceneName: "",
}));
vi.mock("../../../Stores/LoginSceneStore", () => ({ loginSceneVisibleStore: writable(false) }));
vi.mock("../../../Stores/MediaStore", () => ({ enableCameraSceneVisibilityStore: {} }));
vi.mock("../../../Stores/OnboardingStore", () => ({ onboardingStore: {} }));
vi.mock("../../../Stores/PwaInstallStore", () => ({ pwaInstallProfileMenuEligibleStore: writable(true) }));
vi.mock("../../../Stores/SelectCharacterStore", () => ({ selectCharacterSceneVisibleStore: writable(false) }));
vi.mock("../../../Stores/SelectCompanionStore", () => ({ selectCompanionSceneVisibleStore: writable(false) }));
vi.mock("../../../Utils/AvailabilityStatus", () => ({ getStatusInformation: () => [] }));

vi.mock("../../../../i18n/i18n-svelte", () => {
    const LL = readable({
        menu: {
            sub: { profile: () => "Profile", settings: () => "Settings" },
            profile: { helpAndTips: () => "Help & tips", logout: () => "Log out" },
        },
        actionbar: {
            profil: () => "Edit your name",
            woka: () => "Customize your avatar",
            companion: () => "Add companion",
            editCamMic: () => "Edit cam / mic",
            allSettings: () => "All settings",
            installPwa: () => "Install the app",
            help: { shortcut: () => "" },
        },
    });
    return { LL, default: LL, locale: readable("en-US") };
});

// The status list has its own stores: a marker shows whether it is there.
function marker(text: string) {
    return {
        default: (anchor: Node) => {
            anchor.parentNode?.insertBefore(document.createTextNode(`[${text}]`), anchor);
        },
    };
}
vi.mock("../AvailabilityStatus/AvailabilityStatusList.svelte", () => marker("statuses"));
vi.mock("../../Companion/Companion.svelte", () => ({ default: () => undefined }));
vi.mock("../../ExternalModules/ExternalComponents.svelte", () => ({ default: () => undefined }));
vi.mock("../../Woka/WokaFromUserId.svelte", () => ({ default: () => undefined }));
vi.mock("./AdditionalMenuItems.svelte", () => ({ default: () => undefined }));
vi.mock("./ContextualMenuItems.svelte", () => ({ default: () => undefined }));

const { default: ProfileMenuContent } = await import("./ProfileMenuContent.svelte");

let target: HTMLElement;

function rows(): string[] {
    return [...target.querySelectorAll("button")].map((button) => button.textContent?.trim() ?? "");
}

beforeEach(() => {
    target = document.createElement("div");
    document.body.appendChild(target);
});

afterEach(() => {
    target.remove();
});

describe("ProfileMenuContent", () => {
    it("is the avatar and the audio and video settings in a class", async () => {
        env.QUANTA_UI = true;
        const component = mount(ProfileMenuContent, { target, props: { showContextualMenuItems: true } });
        flushSync();

        expect(rows()).toEqual(["Customize your avatar", "Audio & video settings"]);
        expect(target.textContent).not.toContain("[statuses]");
        expect(target.querySelectorAll(".uppercase").length).toBe(0);

        await unmount(component);
    });

    it("keeps WA's menu without the Quanta UI", async () => {
        env.QUANTA_UI = false;
        const component = mount(ProfileMenuContent, { target, props: { showContextualMenuItems: true } });
        flushSync();

        expect(rows()).toEqual([
            "Edit your name",
            "Customize your avatar",
            "Add companion",
            "Edit cam / mic",
            "All settings",
            "Install the app",
            "Help & tips",
        ]);
        expect(target.querySelectorAll(".uppercase").length).toBe(2);
        expect(target.textContent).toContain("[statuses]");

        await unmount(component);
    });
});
