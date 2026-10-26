import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const messageScreen: DeepPartial<Translation["messageScreen"]> = {
    connecting: "Підключення...",
    pleaseWait: "Зачекайте, ми підключаємо вас до кімнати.",
};

export default messageScreen;
