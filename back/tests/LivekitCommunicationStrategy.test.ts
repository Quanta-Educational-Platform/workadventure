import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterType, SpaceUser } from "@workadventure/messages";
import { emptySpaceState } from "@workadventure/shared-utils";
import {
    LIVEKIT_ROOM_GRACE_PERIOD_MS,
    LivekitCommunicationStrategy,
} from "../src/Model/Strategies/LivekitCommunicationStrategy";
import type { ICommunicationSpace } from "../src/Model/Interfaces/ICommunicationSpace";

function createUser(spaceUserId: string): SpaceUser {
    return SpaceUser.fromPartial({
        spaceUserId,
        uuid: `uuid-${spaceUserId}`,
        name: spaceUserId,
    });
}

describe("LivekitCommunicationStrategy", () => {
    it("stops recording through the server path when the last streaming user leaves an empty audience", async () => {
        const dispatchPrivateEvent = vi.fn();
        const stopRecordingByServer = vi.fn().mockResolvedValue(undefined);

        const space: ICommunicationSpace = {
            getAllUsers: () => [],
            getUsersInFilter: () => [],
            getUsersToNotify: () => [],
            getRecordingState: () => ({ isRecording: true, recorder: "recorder-1", status: "recording" }),
            dispatchPrivateEvent,
            dispatchPublicEvent: vi.fn(),
            getSpaceName: () => "test-space",
            getPropertiesToSync: () => [],
            updateState: vi.fn(),
            stopRecordingByServer,
            getUser: vi.fn(),
            world: "world",
            getState: () => emptySpaceState(),
            filterType: FilterType.ALL_USERS,
        };

        const livekitService = {
            deleteRoom: vi.fn().mockResolvedValue(undefined),
        };

        const strategy = new LivekitCommunicationStrategy(space, livekitService as never);
        const streamer = createUser("streamer-1");

        (
            strategy as unknown as {
                streamingUsers: Map<string, SpaceUser>;
                receivingUsers: Map<string, SpaceUser>;
            }
        ).streamingUsers.set(streamer.spaceUserId, streamer);

        strategy.deleteUser(streamer);

        await vi.waitFor(() => {
            expect(stopRecordingByServer).toHaveBeenCalled();
            expect(livekitService.deleteRoom).toHaveBeenCalledWith("test-space");
        });
    });

    it("keeps recording running while another streaming user remains", async () => {
        const space: ICommunicationSpace = {
            getAllUsers: () => [],
            getUsersInFilter: () => [],
            getUsersToNotify: () => [],
            getRecordingState: () => ({ isRecording: true, recorder: "recorder-1", status: "recording" }),
            dispatchPrivateEvent: vi.fn(),
            dispatchPublicEvent: vi.fn(),
            getSpaceName: () => "test-space",
            getPropertiesToSync: () => [],
            updateState: vi.fn(),
            stopRecordingByServer: vi.fn().mockResolvedValue(undefined),
            getUser: vi.fn(),
            world: "world",
            getState: () => emptySpaceState(),
            filterType: FilterType.ALL_USERS,
        };

        const livekitService = {
            deleteRoom: vi.fn().mockResolvedValue(undefined),
        };

        const strategy = new LivekitCommunicationStrategy(space, livekitService as never);
        const firstStreamer = createUser("streamer-1");
        const secondStreamer = createUser("streamer-2");

        (
            strategy as unknown as {
                streamingUsers: Map<string, SpaceUser>;
            }
        ).streamingUsers.set(firstStreamer.spaceUserId, firstStreamer);
        (
            strategy as unknown as {
                streamingUsers: Map<string, SpaceUser>;
            }
        ).streamingUsers.set(secondStreamer.spaceUserId, secondStreamer);

        strategy.deleteUser(firstStreamer);

        await vi.waitFor(() => {
            expect(
                (
                    strategy as unknown as {
                        streamingUsers: Map<string, SpaceUser>;
                    }
                ).streamingUsers.has(secondStreamer.spaceUserId),
            ).toBe(true);
        });

        expect(space.stopRecordingByServer).not.toHaveBeenCalled();
        expect(livekitService.deleteRoom).not.toHaveBeenCalled();
    });
});

function createSpace() {
    const dispatchPrivateEvent = vi.fn();
    const space: ICommunicationSpace = {
        getAllUsers: () => [],
        getUsersInFilter: () => [],
        getUsersToNotify: () => [],
        getRecordingState: () => ({ isRecording: false, recorder: undefined, status: "idle" }) as never,
        dispatchPrivateEvent,
        dispatchPublicEvent: vi.fn(),
        getSpaceName: () => "test-space",
        getPropertiesToSync: () => [],
        updateState: vi.fn(),
        stopRecordingByServer: vi.fn().mockResolvedValue(undefined),
        getUser: vi.fn(),
        world: "world",
        getState: () => emptySpaceState(),
        filterType: FilterType.ALL_USERS,
    };
    return { space, dispatchPrivateEvent };
}

function createLivekitService() {
    const calls: string[] = [];
    return {
        calls,
        createRoom: vi.fn().mockImplementation(() => {
            calls.push("create");
            return Promise.resolve();
        }),
        deleteRoom: vi.fn().mockImplementation(() => {
            calls.push("delete");
            return Promise.resolve();
        }),
        generateToken: vi.fn().mockResolvedValue("token"),
        getLivekitFrontendUrl: () => "wss://livekit.local",
    };
}

/** The receivers of each LiveKit message dispatched so far, by message kind. */
function dispatched(dispatchPrivateEvent: ReturnType<typeof vi.fn>, kind: string): string[] {
    return dispatchPrivateEvent.mock.calls
        .map(([event]) => event as { receiverUserId: string; spaceEvent: { event: { $case: string } } })
        .filter((event) => event.spaceEvent.event.$case === kind)
        .map((event) => event.receiverUserId);
}

describe("LivekitCommunicationStrategy room lifetime between speakers", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    async function liveRoomWithListeners() {
        vi.useFakeTimers();
        const { space, dispatchPrivateEvent } = createSpace();
        const livekitService = createLivekitService();
        const strategy = new LivekitCommunicationStrategy(space, livekitService as never);
        const teacher = createUser("teacher");
        const listeners = [createUser("student-1"), createUser("student-2")];
        for (const listener of listeners) {
            // eslint-disable-next-line no-await-in-loop -- listeners arrive one after the other
            await strategy.addUserToNotify(listener);
        }
        await strategy.addUser(teacher);
        await vi.waitFor(() => expect(dispatched(dispatchPrivateEvent, "livekitInvitationMessage")).toHaveLength(3));
        dispatchPrivateEvent.mockClear();
        return { space, dispatchPrivateEvent, livekitService, strategy, teacher, listeners };
    }

    it("keeps listeners in the room while the last speaker is briefly away", async () => {
        const { space, dispatchPrivateEvent, livekitService, strategy, teacher } = await liveRoomWithListeners();

        strategy.deleteUser(teacher);
        await vi.advanceTimersByTimeAsync(LIVEKIT_ROOM_GRACE_PERIOD_MS - 1);

        expect(livekitService.deleteRoom).not.toHaveBeenCalled();
        expect(space.stopRecordingByServer).not.toHaveBeenCalled();
        expect(dispatched(dispatchPrivateEvent, "livekitDisconnectMessage")).toEqual(["teacher"]);
    });

    it("does not reconnect listeners when a speaker steps back on within the grace period", async () => {
        const { dispatchPrivateEvent, livekitService, strategy, teacher } = await liveRoomWithListeners();

        strategy.deleteUser(teacher);
        await vi.advanceTimersByTimeAsync(5_000);
        await strategy.addUser(teacher);
        await vi.advanceTimersByTimeAsync(LIVEKIT_ROOM_GRACE_PERIOD_MS * 2);

        // Only the returning speaker gets an invitation: listeners keep the connection they have.
        await vi.waitFor(() =>
            expect(dispatched(dispatchPrivateEvent, "livekitInvitationMessage")).toEqual(["teacher"]),
        );
        expect(livekitService.deleteRoom).not.toHaveBeenCalled();
        expect(livekitService.createRoom).toHaveBeenCalledTimes(1);
    });

    it("closes the room once the grace period passes without a speaker", async () => {
        const { space, dispatchPrivateEvent, livekitService, strategy, teacher } = await liveRoomWithListeners();

        strategy.deleteUser(teacher);
        await vi.advanceTimersByTimeAsync(LIVEKIT_ROOM_GRACE_PERIOD_MS);

        expect(space.stopRecordingByServer).toHaveBeenCalledTimes(1);
        expect(livekitService.deleteRoom).toHaveBeenCalledWith("test-space");
        expect(dispatched(dispatchPrivateEvent, "livekitDisconnectMessage").sort()).toEqual([
            "student-1",
            "student-2",
            "teacher",
        ]);

        // The next speaker opens a new room and invites everyone into it.
        dispatchPrivateEvent.mockClear();
        await strategy.addUser(teacher);
        await vi.waitFor(() =>
            expect(dispatched(dispatchPrivateEvent, "livekitInvitationMessage").sort()).toEqual([
                "student-1",
                "student-2",
                "teacher",
            ]),
        );
        expect(livekitService.calls).toEqual(["create", "delete", "create"]);
    });

    it("closes the room at once when the last listener leaves during the grace period", async () => {
        const { livekitService, strategy, teacher, listeners } = await liveRoomWithListeners();

        strategy.deleteUser(teacher);
        for (const listener of listeners) {
            strategy.deleteUserFromNotify(listener);
        }

        await vi.waitFor(() => expect(livekitService.deleteRoom).toHaveBeenCalledTimes(1));
        await vi.advanceTimersByTimeAsync(LIVEKIT_ROOM_GRACE_PERIOD_MS);
        expect(livekitService.deleteRoom).toHaveBeenCalledTimes(1);
    });

    it("waits for a teardown under way before inviting a new speaker", async () => {
        const { space, dispatchPrivateEvent, livekitService, strategy, teacher } = await liveRoomWithListeners();
        let finishStopping!: () => void;
        vi.mocked(space.stopRecordingByServer).mockImplementation(
            () =>
                new Promise<void>((resolve) => {
                    finishStopping = resolve;
                }),
        );

        strategy.deleteUser(teacher);
        await vi.advanceTimersByTimeAsync(LIVEKIT_ROOM_GRACE_PERIOD_MS);
        const student = createUser("student-3");
        const arriving = strategy.addUser(student);
        await vi.advanceTimersByTimeAsync(0);
        expect(dispatched(dispatchPrivateEvent, "livekitInvitationMessage")).toEqual([]);

        finishStopping();
        await arriving;

        // The new room is created after the old one is gone, never deleted under its new speaker.
        expect(livekitService.calls).toEqual(["create", "delete", "create"]);
        await vi.waitFor(() =>
            expect(dispatched(dispatchPrivateEvent, "livekitInvitationMessage")).toContain("student-3"),
        );
    });
});
