import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const video: DeepPartial<Translation["video"]> = {
    connection_issue: "Проблеми зі з'єднанням",
    no_video_stream_received: "Відео не надходить.",
    user_is_muted: "У {name} вимкнено мікрофон.",
    reduce: "Згорнути",
    connecting: "Підключення...",
    reconnecting: "Повторне підключення...",
    persistent_connection_issue: "Повторне підключення... З'єднання нестабільне...",
    click_and_drag_to_resize: "Потягніть, щоб змінити розмір",
    click_to_unblock: "Натисніть, щоб розблокувати",
};

export default video;
