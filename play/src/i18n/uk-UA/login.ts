import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const login: DeepPartial<Translation["login"]> = {
    input: {
        name: {
            placeholder: "Введіть ім'я",
            empty: "Ім'я не вказано",
            tooLongError: "Ім'я задовге",
            notValidError: "Неправильний формат імені",
        },
    },
    genericError: "Сталася помилка",
    terms: "Продовжуючи, ви погоджуєтеся з такими документами: {links}.",
    termsOfUse: "умови використання",
    privacyPolicy: "політика конфіденційності",
    cookiePolicy: "політика щодо файлів cookie",
    continue: "Продовжити",
};

export default login;
