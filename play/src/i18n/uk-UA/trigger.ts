import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const trigger: DeepPartial<Translation["trigger"]> = {
    cowebsite: "[ПРОБІЛ], щоб відкрити сайт 👀",
    jitsiRoom: "[ПРОБІЛ], щоб увійти в Jitsi 👀",
    newTab: "[ПРОБІЛ], щоб відкрити нову вкладку 👀",
    object: "[ПРОБІЛ], щоб взаємодіяти 👀",
    spaceKeyboard: "[ПРОБІЛ]",
    escapeKeyboard: "[ESC]",
    mobile: {
        cowebsite: "👆, щоб відкрити сайт 👀",
        jitsiRoom: "👆, щоб увійти в Jitsi 👀",
        newTab: "👆, щоб відкрити нову вкладку 👀",
        object: "👆, щоб взаємодіяти 👀",
    },
};

export default trigger;
