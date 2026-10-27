import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const woka: DeepPartial<Translation["woka"]> = {
    customWoka: {
        title: "Створіть свого WOKA",
        navigation: {
            finish: "Готово",
            backToDefaultWoka: "Назад до стандартного WOKA",
        },
        randomize: "Випадково",
    },
    selectWoka: {
        title: "Виберіть свого WOKA",
        continue: "Продовжити",
        customize: "Створити свого WOKA",
        randomize: "Вибрати випадково",
    },
    menu: {
        businessCard: "Візитка",
    },
};

export default woka;
