import type { DeepPartial } from "../DeepPartial";
import type { Translation } from "../i18n-types";

const follow: DeepPartial<Translation["follow"]> = {
    interactStatus: {
        following: "Ви йдете за {leader}",
        waitingFollowers: "Чекаємо, поки інші погодяться йти за вами",
        followed: {
            one: "{follower} йде за вами",
            two: "{firstFollower} і {secondFollower} йдуть за вами",
            many: "{followers} і {lastFollower} йдуть за вами",
        },
    },
    interactMenu: {
        title: {
            interact: "Взаємодія",
            follow: "Піти за {leader}?",
        },
        stop: {
            leader: "Більше не вести за собою?",
            follower: "Більше не йти за {leader}?",
        },
        yes: "Так",
        no: "Ні",
    },
    actionName: "Знайти",
};

export default follow;
