import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const notification: DeepPartial<Translation["notification"]> = {
    discussion: "{name} хоче з вами поговорити",
    message: "{name} надсилає повідомлення",
    askToMuteMicrophone: "Можна вимкнути ваш мікрофон?",
    askToMuteCamera: "Можна вимкнути вашу камеру?",
    microphoneMuted: "Модератор вимкнув ваш мікрофон",
    cameraMuted: "Модератор вимкнув вашу камеру",
    givenTheFloor: "Ваша черга говорити",
    givenTheFloorEnableMicrophone: "Ваша черга говорити — увімкніть мікрофон",
    floorRevoked: "У вас більше немає слова",
    floorGivenBack: "Ви повернули слово",
    handLowered: "Модератор опустив вашу руку",
    removedFromConversation: "Модератор вилучив вас із розмови.",
    actionFailed: "Не вдалося виконати цю дію",
    announcement: "Оголошення",
    help: {
        title: "Доступ до сповіщень заборонено",
        permissionDenied: "Доступ заборонено",
        content:
            "Не пропускайте жодної розмови. Увімкніть сповіщення, щоб знати, коли хтось хоче з вами поговорити, навіть якщо ви не на вкладці WorkAdventure.",
        firefoxContent: "Поставте позначку «Запам'ятати це рішення», якщо не хочете, щоб Firefox щоразу питав дозвіл.",
        refresh: "Оновити",
        continue: "Продовжити без сповіщень",
        screen: {
            chrome: "/resources/help-setting-notification-permission/en-US-chrome.png",
        },
        screenAlt: "Дозвіл сповіщень в адресному рядку Chrome",
    },
    addNewTag: "додати новий тег: «{tag}»",
    screenSharingError: "Не вдалося почати демонстрацію екрана",
    recordingStarted: "Хтось у розмові почав запис.",
    urlCopiedToClipboard: "Посилання скопійовано",
};

export default notification;
