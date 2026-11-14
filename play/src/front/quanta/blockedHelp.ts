// quanta: where a person allows something the browser blocked for the room (camera, microphone, pop-ups).

export type BlockedFixPlace = "addressBar" | "safariMac" | "iosSafari" | "iosApp" | "android";

export function blockedFixPlace(userAgent: string, maxTouchPoints = 0): BlockedFixPlace {
    if (/Android/i.test(userAgent)) return "android";
    // iPadOS asks for the desktop site and names itself a Mac, but has a touch screen.
    const ios = /iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
    // Every iOS browser runs on WebKit; only Safari itself has the aA menu, the others keep the switch in Settings.
    if (ios) return /CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser/.test(userAgent) ? "iosApp" : "iosSafari";
    if (/Safari\//.test(userAgent) && !/Chrome\/|Chromium\/|Edg\/|OPR\/|Firefox\//.test(userAgent)) return "safariMac";
    return "addressBar";
}

export function currentBlockedFixPlace(): BlockedFixPlace {
    return blockedFixPlace(navigator.userAgent, navigator.maxTouchPoints);
}

type Text = (params?: Record<string, string | number>) => string;
type BlockedStrings = Record<
    | "blockedFixAddressBar"
    | "blockedFixSafariMac"
    | "blockedFixIosSafari"
    | "blockedFixIosApp"
    | "blockedFixAndroid"
    | "blockedPopupsAddressBar"
    | "blockedPopupsSafariMac"
    | "blockedPopupsIosSafari"
    | "blockedPopupsOther",
    Text
>;

/** One sentence: where this browser allows `device` ("the camera"...), then try again. */
export function blockedFixText(ql: BlockedStrings, device: string, place = currentBlockedFixPlace()): string {
    const text = {
        addressBar: ql.blockedFixAddressBar,
        safariMac: ql.blockedFixSafariMac,
        iosSafari: ql.blockedFixIosSafari,
        iosApp: ql.blockedFixIosApp,
        android: ql.blockedFixAndroid,
    }[place];
    return text({ device });
}

export function blockedPopupsText(ql: BlockedStrings, place = currentBlockedFixPlace()): string {
    if (place === "addressBar") return ql.blockedPopupsAddressBar();
    if (place === "safariMac") return ql.blockedPopupsSafariMac();
    if (place === "iosSafari") return ql.blockedPopupsIosSafari();
    return ql.blockedPopupsOther();
}
