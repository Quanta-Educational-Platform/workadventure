import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const area: DeepPartial<Translation["area"]> = {
    noAccess: "На жаль, у вас немає доступу до цієї зони.",
    blocked: {
        locked: "Ця зона зачинена. Увійти не можна.",
        maxUsers: "Ця зона заповнена. Увійти не можна.",
        noAccess: "На жаль, у вас немає доступу до цієї зони.",
        unlockWithTrigger: "{trigger}, щоб відчинити цю зону.",
    },
    personalArea: {
        claimDescription: "Це особиста зона. Зробити її своєю?",
        buttons: {
            yes: "Так",
            no: "Ні",
            confirm: "Підтвердити",
        },
        personalSpaceWithNames: "Особистий простір: {name}",
        alreadyHavePersonalArea: "У вас уже є особиста зона. Якщо ви займете цю, стару буде видалено.",
    },
};

export default area;
