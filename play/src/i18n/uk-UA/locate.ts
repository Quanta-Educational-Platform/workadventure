import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const locate: DeepPartial<Translation["locate"]> = {
    userSearching: "Шукаємо користувача...",
    progressMessages: {
        scanning: "🔍 Оглядаємо мапу...",
        lookingAround: "👀 Роззираємося...",
        checkingCorners: "🚶 Зазираємо в кожен куток...",
        stillSearching: "🔎 Досі шукаємо...",
        maybeHiding: "💭 Може, ховається?",
        searchingWorld: "🌍 Шукаємо по всьому світу...",
        almostThere: "⏳ Майже знайшли...",
        gettingCloser: "🎯 Уже ближче...",
        justMomentMore: "✨ Ще хвилинку...",
        finalCheck: "🎪 Остання перевірка...",
    },
    errorMessage: "😢 Схоже, цей користувач вийшов із кімнати або перебуває в іншій зоні!",
};

export default locate;
