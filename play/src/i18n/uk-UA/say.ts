import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const say: DeepPartial<Translation["say"]> = {
    type: {
        say: "Сказати",
        think: "Подумати",
    },
    placeholder: "Напишіть повідомлення...",
    button: "Створити бульбашку",
    tooltip: {
        description: {
            say: "Показує бульбашку з текстом над вашим персонажем. Її бачать усі, хто бачить вашого персонажа, протягом 5 секунд.",
            think: "Показує бульбашку думок над вашим персонажем. Її бачать усі, хто бачить вашого персонажа, поки ви не рушите з місця.",
        },
    },
};

export default say;
