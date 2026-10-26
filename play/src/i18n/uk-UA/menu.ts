import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const menu: DeepPartial<Translation["menu"]> = {
    title: "Меню",
    icon: {
        open: {
            menu: "Відкрити меню",
            invite: "Показати запрошення",
            register: "Зареєструватися",
            chat: "Відкрити чат",
            userlist: "Список користувачів",
            openEmoji: "Відкрити вибір емодзі",
            closeEmoji: "Закрити меню емодзі",
            mobile: "Відкрити мобільне меню",
            calendar: "Календар",
            todoList: "Список справ",
        },
    },
    visitCard: {
        close: "Закрити",
        sendMessage: "Надіслати повідомлення",
    },
    profile: {
        login: "Увійти",
        logout: "Вийти",
        helpAndTips: "Довідка й поради",
    },
    settings: {
        videoBandwidth: {
            title: "Якість відео",
            low: "Низька",
            recommended: "Рекомендована",
            high: "Висока",
        },
        shareScreenBandwidth: {
            title: "Якість демонстрації екрана",
            low: "Низька",
            recommended: "Рекомендована",
            high: "Висока",
        },
        bandwidthConstrainedPreference: {
            title: "Якщо інтернет повільний",
            maintainFramerateTitle: "Зберігати плавність",
            maintainFramerateDescription:
                "Частота кадрів важливіша за роздільність. Підходить, коли потрібна плавна картинка, наприклад під час трансляції відеоігор.",
            maintainResolutionTitle: "Зберігати чіткість тексту",
            maintainResolutionDescription:
                "Роздільність важливіша за частоту кадрів. Підходить, коли текст має бути добре видно, наприклад у презентаціях чи коли показуєте код.",
            balancedTitle: "Баланс плавності й чіткості",
            balancedDescription: "Тримати баланс між частотою кадрів і роздільністю.",
        },
        microphone: {
            title: "Налаштування мікрофона",
            autoGainControl: "Автоматичне регулювання гучності",
            autoGainControlDescription: "Автоматично налаштовує гучність мікрофона.",
            echoCancellation: "Придушення відлуння",
            enableAdvancedNoiseReduction: "Увімкнути розширене шумозаглушення",
            noiseSuppressionMode: "Режим шумозаглушення:",
            workAdventureNoiseSuppression: "Шумозаглушення WorkAdventure",
            workAdventureNoiseSuppressionDescription: "Обробляти звук мікрофона шумозаглушенням WorkAdventure.",
            recommended: "Рекомендовано",
            browserNoiseSuppression: "Шумозаглушення браузера",
            browserNoiseSuppressionDescription: "Використовувати вбудоване шумозаглушення браузера.",
            voiceIsolation: "Виділення голосу",
            voiceIsolationDescription:
                "Використовувати виділення голосу браузера й операційної системи, якщо воно доступне.",
            noiseSuppressionEngine: "Рушій шумозаглушення",
            noiseSuppressionEngineDeepFilterNet: "DeepFilterNet (новий, повний діапазон голосу)",
            noiseSuppressionEngineDtln: "DTLN (попередній рушій)",
        },
        language: {
            title: "Мова",
        },
        privacySettings: {
            title: "Режим «Немає на місці»",
            explanation:
                "Коли ви переходите в інше вікно чи вкладку, WorkAdventure вмикає режим «Немає на місці», якщо ви не в розмові й не ведете трансляцію.",
            cameraToggle: "Не вимикати камеру в режимі «Немає на місці»",
            microphoneToggle: "Не вимикати мікрофон у режимі «Немає на місці»",
        },
        save: "Зберегти",
        otherSettings: "Інші налаштування",
        fullscreen: "На весь екран",
        notifications: "Сповіщення",
        enablePictureInPicture: "Увімкнути «Картинку в картинці»",
        chatSounds: "Звуки чату",
        cowebsiteTrigger: "Завжди питати перед відкриттям сайтів і кімнат Jitsi Meet",
        ignoreFollowRequest: "Ігнорувати запити йти за іншими користувачами",
        proximityDiscussionVolume: "Гучність розмов поблизу",
        blockAudio: "Вимкнути фонові звуки й музику",
        disableAnimations: "Вимкнути анімації мапи",
        bubbleSound: "Звук бульбашки",
        bubbleSoundOptions: {
            ding: "Дзень",
            wobble: "Бульк",
        },
        displayVideoQualityStats: "Показувати статистику якості відео",
    },
    invite: {
        description: "Поділіться посиланням на кімнату!",
        copy: "Копіювати",
        copied: "Скопійовано",
        share: "Поділитися",
        walkAutomaticallyToPosition: "Автоматично привести до мене",
        selectEntryPoint: "Інша точка входу",
        selectEntryPointSelect: "Виберіть точку входу, через яку прийдуть користувачі",
    },
    globalMessage: {
        text: "Текст",
        audio: "Аудіо",
        warning: "Надіслати в усі кімнати світу",
        enter: "Напишіть повідомлення...",
        send: "Надіслати",
    },
    globalAudio: {
        uploadInfo: "Завантажити файл",
        error: "Файл не вибрано. Спершу завантажте файл, а потім надсилайте.",
        errorUpload:
            "Не вдалося завантажити файл. Перевірте файл і спробуйте ще раз. Якщо проблема не зникне, зверніться до адміністратора.",
        dragAndDrop: "Перетягніть файл сюди або натисніть, щоб завантажити 🎧",
    },
    contact: {
        gettingStarted: {
            title: "Початок роботи",
            description:
                "WorkAdventure дає змогу створити онлайн-простір для живого спілкування з іншими. А все починається зі створення власного простору. Виберіть одну з багатьох готових мап від нашої команди.",
        },
        createMap: {
            title: "Створіть свою мапу",
            description: "Також можна створити власну мапу за інструкціями з документації.",
        },
    },
    about: {
        mapInfo: "Інформація про мапу",
        mapLink: "посилання на цю мапу",
        copyrights: {
            map: {
                title: "Авторські права на мапу",
                empty: "Автор мапи не вказав авторських прав на неї.",
            },
            tileset: {
                title: "Авторські права на тайлсети",
                empty: "Автор мапи не вказав авторських прав на тайлсети. Це не означає, що в них немає ліцензії.",
            },
            audio: {
                title: "Авторські права на аудіофайли",
                empty: "Автор мапи не вказав авторських прав на аудіофайли. Це не означає, що в них немає ліцензії.",
            },
        },
    },
    chat: {
        matrixIDLabel: "Ваш Matrix ID",
        settings: "Налаштування",
        resetKeyStorageUpButtonLabel: "Скинути сховище ключів",
        resetKeyStorageConfirmationModal: {
            title: "Підтвердження скидання сховища ключів",
            content: "Ви збираєтеся скинути сховище ключів. Ви впевнені?",
            warning:
                "Скидання сховища ключів видалить поточний сеанс і всіх довірених користувачів. Ви можете втратити доступ до деяких старих повідомлень, і вас більше не вважатимуть довіреним користувачем. Переконайтеся, що повністю розумієте наслідки, перш ніж продовжити.",
            cancel: "Скасувати",
            continue: "Продовжити",
        },
    },
    sub: {
        profile: "Профіль",
        settings: "Налаштування",
        credit: "Про мапу",
        globalMessages: "Повідомлення для всіх",
        contact: "Контакти",
        report: "Повідомити про проблему",
        chat: "Чат",
        help: "Довідка й навчання",
        contextualActions: "Контекстні дії",
        shortcuts: "Гарячі клавіші",
    },
    shortcuts: {
        title: "Гарячі клавіші",
        keys: "Клавіші",
        actions: "Дія",
        moveUp: "Рух угору",
        moveDown: "Рух униз",
        moveLeft: "Рух ліворуч",
        moveRight: "Рух праворуч",
        speedUp: "Бігти",
        interact: "Взаємодіяти",
        follow: "Іти слідом",
        openChat: "Відкрити чат",
        openUserList: "Відкрити список користувачів",
        toggleMapEditor: "Показати/сховати редактор мапи",
        rotatePlayer: "Повернути персонажа",
        emote1: "Емоція 1",
        emote2: "Емоція 2",
        emote3: "Емоція 3",
        emote4: "Емоція 4",
        emote5: "Емоція 5",
        emote6: "Емоція 6",
        openSayPopup: "Сказати",
        openThinkPopup: "Подумати",
        walkMyDesk: "Піти до мого робочого місця",
    },
};

export default menu;
