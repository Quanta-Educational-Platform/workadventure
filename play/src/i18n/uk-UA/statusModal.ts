import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const statusModal: DeepPartial<Translation["statusModal"]> = {
    accept: "Прийняти",
    close: "Закрити",
    confirm: "Підтвердити",
    goBackToOnlineStatusLabel: "Повернутися в мережу?",
    allowNotification: "Дозволити сповіщення?",
    allowNotificationExplanation: "Отримуйте сповіщення на робочому столі, коли хтось хоче з вами поговорити.",
    audioPlaybackBlocked: "Браузер заблокував відтворення звуку.",
    audioPlaybackInterrupted: "Браузер або операційна система перервали відтворення звуку.",
    turnSoundOn: "Увімкнути звук",
};

export default statusModal;
