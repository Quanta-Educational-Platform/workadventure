import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const camera: DeepPartial<Translation["camera"]> = {
    editCam: "Змінити камеру",
    editSpeaker: "Змінити пристрій виведення звуку",
    active: "Активна",
    disabled: "Вимкнено",
    notRecommended: "Не рекомендовано",
    enable: {
        title: "Увімкніть камеру та мікрофон",
        start: "Вітаємо на сторінці налаштування аудіо- та відеопристроїв! Тут є все, щоб вас було добре чути й видно. Змініть налаштування під себе, щоб усунути можливі проблеми. Перевірте, чи пристрої правильно підключені й оновлені. Спробуйте різні варіанти й виберіть той, що працює найкраще.",
    },
    help: {
        title: "Потрібен доступ до камери й мікрофона",
        cameraTitle: "Потрібен доступ до камери",
        microphoneTitle: "Потрібен доступ до мікрофона",
        cameraPermissionDenied: "Доступ до камери заборонено",
        microphonePermissionDenied: "Доступ до мікрофона заборонено",
        cameraMicrophonePermissionDenied: "Доступ до камери й мікрофона заборонено",
        content: "Дозвольте браузеру доступ до камери й мікрофона.",
        cameraContent: "Дозвольте браузеру доступ до камери.",
        microphoneContent: "Дозвольте браузеру доступ до мікрофона.",
        firefoxContent: "Поставте позначку «Запам'ятати це рішення», якщо не хочете, щоб Firefox щоразу питав дозвіл.",
        allow: "Дозволити камеру",
        allowMicrophone: "Дозволити мікрофон",
        allowCameraMicrophone: "Дозволити камеру й мікрофон",
        continue: "Продовжити без камери",
        continueWithoutMicrophone: "Продовжити без мікрофона",
        continueCameraMicrophone: "Продовжити без камери й мікрофона",
        screen: {
            firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
            chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
        },
        tooltip: {
            permissionDeniedTitle: "Доступ до камери заблоковано",
            permissionDeniedDesc:
                "Браузер заборонив цьому сайту доступ до камери. Дозвольте його в адресному рядку (значок замка або камери) чи в налаштуваннях сайту. Ілюстрація нижче відповідає вашому браузеру.",
            noDeviceTitle: "Немає доступної камери",
            noDeviceDesc:
                "Браузер не бачить жодної камери, яку можна використати. Спробуйте інший браузер, перевірте, чи підключена камера, перегляньте налаштування комп'ютера (конфіденційність, пристрої) або перезавантажте комп'ютер, якщо пристрій мав би працювати.",
            permissionMedia: {
                firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
                chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
                safari: "/resources/help-setting-camera-permission/en-US-firefox.png",
                android: "/resources/help-setting-camera-permission/en-US-firefox.png",
                default: "/resources/help-setting-camera-permission/en-US-firefox.png",
            },
        },
        microphoneTooltip: {
            permissionDeniedTitle: "Доступ до мікрофона заблоковано",
            permissionDeniedDesc:
                "Браузер заборонив цьому сайту доступ до мікрофона. Дозвольте його в адресному рядку (значок замка або мікрофона) чи в налаштуваннях сайту. Ілюстрація нижче відповідає вашому браузеру.",
            noDeviceTitle: "Немає доступного мікрофона",
            noDeviceDesc:
                "Браузер не бачить жодного мікрофона, який можна використати. Спробуйте інший браузер, перевірте, чи підключений мікрофон, перегляньте налаштування комп'ютера (конфіденційність, пристрої) або перезавантажте комп'ютер, якщо пристрій мав би працювати.",
            permissionMedia: {
                firefox: "/resources/help-setting-camera-permission/en-US-firefox.png",
                chrome: "/resources/help-setting-camera-permission/en-US-firefox.png",
                safari: "/resources/help-setting-camera-permission/en-US-firefox.png",
                android: "/resources/help-setting-camera-permission/en-US-firefox.png",
                default: "/resources/help-setting-camera-permission/en-US-firefox.png",
            },
        },
    },
    webrtc: {
        title: "Помилка з'єднання з відеосервером",
        titlePending: "З'єднання з відеосервером...",
        error: "TURN-сервер недоступний",
        content: "Відеосервер недоступний. Можливо, ви не зможете спілкуватися з іншими.",
        solutionVpn: "Якщо ви <strong>підключені через VPN</strong>, вимкніть VPN і оновіть сторінку.",
        solutionVpnNotAskAgain: "Зрозуміло. Більше не попереджати 🫡",
        solutionHotspot:
            "Якщо ви в мережі з обмеженнями (наприклад, шкільній чи робочій), спробуйте іншу мережу. Наприклад, увімкніть на телефоні <strong>точку доступу Wi-Fi</strong> і підключіться через неї.",
        solutionNetworkAdmin: "Якщо ви <strong>адміністратор мережі</strong>, перегляньте ",
        preparingYouNetworkGuide: "посібник «Підготовка мережі»",
        refresh: "Оновити",
        continue: "Продовжити",
        newDeviceDetected: "Знайдено новий пристрій: {device} 🎉 Перемкнутися? [ПРОБІЛ] Ігнорувати [ESC]",
    },
    my: {
        silentZone: "Тиха зона",
        silentZoneDesc: "Ви в тихій зоні. Тут з вами ніхто не може говорити, а ваші мікрофон і камера вимкнені.",
        nameTag: "Ви",
        loading: "Завантаження камери...",
    },
    disable: "Вимкнути камеру",
    menu: {
        moreAction: "Інші дії",
        closeMenu: "Закрити меню",
        senPrivateMessage: "Надіслати особисте повідомлення (незабаром)",
        giveFloor: "Надати слово",
        revokeFloor: "Забрати слово",
        muteAudioUser: "Вимкнути звук",
        askToMuteAudioUser: "Попросити вимкнути звук",
        muteAudioEveryBody: "Вимкнути звук усім",
        muteVideoUser: "Вимкнути відео",
        askToMuteVideoUser: "Попросити вимкнути відео",
        muteVideoEveryBody: "Вимкнути відео всім",
        blockOrReportUser: "Модерація",
    },
};

export default camera;
