import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const companion: DeepPartial<Translation["companion"]> = {
    select: {
        title: "Виберіть компаньйона",
        any: "Без компаньйона",
        continue: "Продовжити",
    },
};

export default companion;
