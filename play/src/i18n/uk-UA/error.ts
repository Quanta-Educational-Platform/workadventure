import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const error: DeepPartial<Translation["error"]> = {
    accessLink: {
        title: "Неправильне посилання для входу",
        subTitle: "Мапу не знайдено. Перевірте посилання.",
        details: "Щоб дізнатися більше, зверніться до адміністратора або напишіть нам: hello@workadventu.re",
    },
    connectionRejected: {
        title: "З'єднання відхилено",
        subTitle: "Не вдається увійти у світ. Спробуйте пізніше {error}.",
        details: "Щоб дізнатися більше, зверніться до адміністратора або напишіть нам: hello@workadventu.re",
    },
    connectionRetry: {
        unableConnect: "Зв'язок із сервером втрачено. Ви не зможете говорити з іншими.",
    },
    errorDialog: {
        title: "Помилка 😱",
        hasReportIssuesUrl: "Щоб дізнатися більше, зверніться до адміністратора або повідомте про проблему тут:",
        noReportIssuesUrl: "Щоб дізнатися більше, зверніться до адміністратора світу.",
        messageFAQ: "Також можна переглянути наші:",
        reload: "Перезавантажити",
        close: "Закрити",
    },
};

export default error;
