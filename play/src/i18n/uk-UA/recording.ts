import type { RequiredParams } from "typesafe-i18n";
import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const recording: DeepPartial<Translation["recording"]> = {
    refresh: "Оновити",
    title: "Ваші записи",
    noRecordings: "Записів не знайдено",
    errorFetchingRecordings: "Не вдалося завантажити записи",
    // `{s}` is an English plural suffix; Ukrainian needs its own plural forms of "day".
    expireIn: "Зберігається ще {days} {{days:|день||дні|днів|дня}}" as RequiredParams<"days" | "s">,
    expiresOn: "Зберігається до {date}",
    download: "Завантажити",
    close: "Закрити",
    recordingList: "Записи",
    viewList: "Список",
    viewCards: "Картки",
    back: "Назад",
    actions: "Дії",
    contextMenu: {
        openInNewTab: "Відкрити в новій вкладці",
        delete: "Видалити",
    },
    notification: {
        deleteNotification: "Запис видалено",
        deleteFailedNotification: "Не вдалося видалити запис",
        startFailedNotification: "Не вдалося почати запис",
        stopFailedNotification: "Не вдалося зупинити запис",
        recordingStarted: "{name} розпочинає запис.",
        downloadFailedNotification: "Не вдалося завантажити запис",
        recordingComplete: "Запис завершено",
        recordingIsInProgress: "Іде запис",
        unexpectedlyStoppedNotification: "Запис несподівано зупинився",
        recordingSaved: "Ваш запис збережено.",
        howToAccess: "Де знайти записи:",
        viewRecordings: "Переглянути записи",
    },
    actionbar: {
        title: {
            start: "Почати запис",
            stop: "Зупинити запис",
            inProgress: "Іде запис",
        },
        desc: {
            needLogin: "Щоб записувати, потрібно увійти.",
            advert: "Усі учасники отримають сповіщення про початок запису.",
            yourRecordInProgress: "Іде запис. Натисніть, щоб зупинити.",
            inProgress: "Іде запис",
        },
        spacePicker: {
            megaphone: "Записати трансляцію мегафона",
            discussion: "Записати розмову",
        },
    },
};

export default recording;
