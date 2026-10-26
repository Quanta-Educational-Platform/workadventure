import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const audio: DeepPartial<Translation["audio"]> = {
    volumeCtrl: "Змінити гучність",
    manager: {
        reduce: "Приглушувати програвач, коли ви говорите",
        allow: "Дозволити звук",
        error: "Не вдалося завантажити звук",
        notAllowed: "▶️ Звук заблоковано. Натисніть [ПРОБІЛ] або клацніть тут, щоб увімкнути його!",
    },
    message: "Аудіоповідомлення",
    disable: "Вимкнути мікрофон",
};

export default audio;
