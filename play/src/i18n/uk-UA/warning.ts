import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const warning: DeepPartial<Translation["warning"]> = {
    title: "Увага!",
    content: `Цей світ майже заповнений! Збільшити його місткість можна <a href="{upgradeLink}" target="_blank">тут</a>`,
    limit: "Цей світ майже заповнений!",
    accessDenied: {
        camera: "Доступ до камери заборонено. Натисніть тут і перевірте дозволи браузера.",
        teleport: "Ви не маєте права телепортуватися до цього користувача.",
        room: "Доступ заборонено. Вам не можна входити в цю кімнату.",
    },
    connectionLost: "З'єднання втрачено. Підключаємося знову...",
    connectionLostTitle: "З'єднання втрачено",
    connectionLostSubtitle: "Підключаємося знову",
    waitingConnectionTitle: "Очікування з'єднання",
    waitingConnectionSubtitle: "Підключення",
    megaphoneNeeds: "Щоб скористатися мегафоном, увімкніть камеру чи мікрофон або покажіть свій екран.",
    mapEditorShortCut: "Не вдалося відкрити редактор мапи.",
    mapEditorNotEnabled: "Редактор мапи вимкнено в цьому світі.",
    popupBlocked: {
        title: "Спливне вікно заблоковано",
        content: "Дозвольте спливні вікна для цього сайту в налаштуваннях браузера.",
        done: "Гаразд",
    },
    backgroundProcessing: {
        failedToApply: "Не вдалося застосувати ефекти фону",
        notSupportedOnThisBrowser: "Цей браузер не підтримує ефекти фону",
    },
    duplicateUserConnected: {
        title: "Ви вже підключені",
        message:
            "Ви вже підключені до цієї кімнати з іншої вкладки чи пристрою. Щоб уникнути конфліктів, закрийте іншу вкладку або вікно.",
        confirmContinue: "Зрозуміло, продовжити",
        dontRemindAgain: "Більше не показувати",
    },
    browserNotSupported: {
        title: "😢 Браузер не підтримується",
        message: "WorkAdventure більше не підтримує ваш браузер ({browserName}).",
        description: "Ваш браузер застарий для WorkAdventure. Оновіть його до останньої версії, щоб продовжити.",
        whatToDo: "Що можна зробити?",
        option1: "Оновити {browserName} до останньої версії",
        option2: "Вийти з WorkAdventure й відкрити інший браузер",
        updateBrowser: "Оновити браузер",
        leave: "Вийти",
    },
    pwaInstall: {
        title: "Встановіть WorkAdventure",
        description:
            "Встановіть застосунок, щоб було зручніше: швидкий доступ, запуск разом із комп'ютером і робота як у звичайній програмі.",
        descriptionIos: "Додайте WorkAdventure на початковий екран для зручності й швидкого доступу.",
        feature1Title: "Швидкий доступ",
        feature1Description: "Запускайте WorkAdventure з меню «Пуск», Dock або робочого столу.",
        feature2Title: "Окреме вікно",
        feature2Description:
            "WorkAdventure відкривається окремо від вкладок браузера, і його легко знайти на панелі завдань.",
        feature3Title: "Запуск разом із комп'ютером",
        feature3Description: "WorkAdventure запускається, коли вмикається ваш пристрій.",
        iosStepsTitle: "Як встановити",
        iosStep1: "Торкніться кнопки «Поділитися» (квадрат зі стрілкою) внизу Safari.",
        iosStep2: "Прокрутіть униз і торкніться «На початковий екран».",
        iosStep3: "Торкніться «Додати», щоб підтвердити.",
        install: "Встановити застосунок WorkAdventure",
        installing: "Встановлення…",
        skip: "Продовжуємо в браузері",
        continue: "Продовжити в браузері",
        neverShowPage: "Більше не питати",
    },
};

export default warning;
