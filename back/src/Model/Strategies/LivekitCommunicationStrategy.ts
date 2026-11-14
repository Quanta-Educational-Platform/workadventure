import type {
    HandleRecordingWebhookRequest,
    MeetingConnectionRestartMessage,
    SpaceUser,
} from "@workadventure/messages";
import * as Sentry from "@sentry/node";
import type { ICommunicationSpace } from "../Interfaces/ICommunicationSpace";
import type { IRecordableStrategy } from "../Interfaces/ICommunicationStrategy";
import type { LiveKitService, RecordingStartInfo } from "../Services/LivekitService";

/**
 * How long the room outlives its last speaker while people still listen. A speaker stepping off and back on
 * (crossing the podium, a reconnect, the floor passing to a student) would otherwise disconnect every listener
 * and make them all join a new room seconds later.
 */
export const LIVEKIT_ROOM_GRACE_PERIOD_MS = 120_000;

export class LivekitCommunicationStrategy implements IRecordableStrategy {
    private usersReady: Set<string> = new Set();
    private createRoomPromise: Promise<void> | null = null;
    private teardownTimer: ReturnType<typeof setTimeout> | undefined;
    private teardownInFlight: Promise<void> | undefined;
    private disposed = false;

    private streamingUsers: Map<string, SpaceUser> = new Map<string, SpaceUser>();
    private receivingUsers: Map<string, SpaceUser> = new Map<string, SpaceUser>();

    /**
     * Queue of pending operations per user to prevent race conditions
     * when users rapidly move between zones.
     */
    private pendingOperations: Map<string, Promise<void>> = new Map();

    constructor(
        private space: ICommunicationSpace,
        private livekitService: LiveKitService,
        private readonly gracePeriodMs: number = LIVEKIT_ROOM_GRACE_PERIOD_MS,
    ) {}

    /**
     * Queues an operation for a specific user to ensure sequential execution.
     * This prevents race conditions when addUser/deleteUser are called in rapid succession.
     */
    private queueUserOperation(userId: string, operation: () => Promise<void>): Promise<void> {
        const previousOperation = this.pendingOperations.get(userId) ?? Promise.resolve();

        const newOperation = previousOperation
            .catch(() => {
                // Ignore errors from previous operations to continue the queue
            })
            .then(async () => {
                await operation();
            });

        this.pendingOperations.set(userId, newOperation);

        // Clean up the map when the operation completes
        newOperation
            .finally(() => {
                if (this.pendingOperations.get(userId) === newOperation) {
                    this.pendingOperations.delete(userId);
                }
            })
            .catch(() => {
                // Ignore cleanup errors
            });

        return newOperation;
    }

    async addUser(user: SpaceUser): Promise<void> {
        return this.queueUserOperation(user.spaceUserId, async () => {
            // Check if the user is already streaming
            if (this.streamingUsers.has(user.spaceUserId)) {
                console.warn("User already streaming in the room", user.spaceUserId);
                Sentry.captureMessage(`User already streaming in the room ${user.spaceUserId}`);
                return;
            }

            // A room kept through its grace period still has its listeners connected: they need no new invitation.
            const resumed = this.cancelScheduledTeardown();
            // A teardown already under way would delete the room this speaker is about to be invited to.
            await this.teardownInFlight?.catch(() => undefined);

            // Ensure the Livekit room is created (only once)
            if (!this.createRoomPromise) {
                // A failed creation is retried by the next arrival instead of failing every later one.
                this.createRoomPromise = this.livekitService.createRoom(this.space.getSpaceName()).catch((e) => {
                    this.createRoomPromise = null;
                    throw e;
                });
            }

            await this.createRoomPromise;

            // Send invitation to all receiving users if this is the first room creation
            if (!resumed && this.receivingUsers.size > 0 && this.streamingUsers.size === 0) {
                for (const receivingUser of this.receivingUsers.values()) {
                    this.sendLivekitInvitationMessage(receivingUser).catch((error) => {
                        console.error(
                            `Error generating token for user ${receivingUser.spaceUserId} in Livekit:`,
                            error,
                        );
                        Sentry.captureException(error);
                    });
                }
            }
            // Register the user as streaming
            this.streamingUsers.set(user.spaceUserId, user);

            // Send invitation to the new user if not already receiving
            if (!this.receivingUsers.has(user.spaceUserId)) {
                this.sendLivekitInvitationMessage(user).catch((error) => {
                    console.error(`Error generating token for user ${user.spaceUserId} in Livekit:`, error);
                    Sentry.captureException(error);
                });
            }
        });
    }

    private sendLivekitDisconnectMessage(user: SpaceUser): void {
        try {
            this.space.dispatchPrivateEvent({
                spaceName: this.space.getSpaceName(),
                receiverUserId: user.spaceUserId,
                senderUserId: user.spaceUserId,
                spaceEvent: {
                    event: {
                        $case: "livekitDisconnectMessage",
                        livekitDisconnectMessage: {},
                    },
                },
            });
        } catch (error) {
            console.error(`Error dispatching livekitDisconnectMessage for user ${user.spaceUserId}:`, error);
            Sentry.captureException(error);
        }
    }

    deleteUser(user: SpaceUser): void {
        this.queueUserOperation(user.spaceUserId, async () => {
            const deleted = this.streamingUsers.delete(user.spaceUserId);

            if (!deleted) {
                console.warn("User to delete not found in streaming users", user.spaceUserId);
            }

            // Let's only disconnect from Livekit if the user is not watching in the room anymore
            if (!this.receivingUsers.has(user.spaceUserId)) {
                this.sendLivekitDisconnectMessage(user);
            }

            if (this.streamingUsers.size === 0) {
                if (this.receivingUsers.size === 0 || this.gracePeriodMs <= 0 || this.disposed) {
                    await this.teardownRoom();
                } else {
                    this.scheduleTeardown();
                }
            }
        }).catch((error) => {
            console.error(`Error in deleteUser for ${user.spaceUserId}:`, error);
            Sentry.captureException(error);
        });
    }

    private scheduleTeardown(): void {
        this.cancelScheduledTeardown();
        this.teardownTimer = setTimeout(() => {
            this.teardownTimer = undefined;
            this.teardownRoom().catch((error) => {
                console.error(`Error tearing down Livekit room ${this.space.getSpaceName()}:`, error);
                Sentry.captureException(error);
            });
        }, this.gracePeriodMs);
        this.teardownTimer.unref?.();
    }

    /** Says whether a teardown was pending. */
    private cancelScheduledTeardown(): boolean {
        if (this.teardownTimer === undefined) {
            return false;
        }
        clearTimeout(this.teardownTimer);
        this.teardownTimer = undefined;
        return true;
    }

    private teardownRoom(): Promise<void> {
        if (this.streamingUsers.size > 0) {
            return Promise.resolve();
        }
        // Cleared first: a listener arriving meanwhile must wait for the next room, not be invited to this one.
        this.createRoomPromise = null;
        const teardown = (async () => {
            try {
                await this.space.stopRecordingByServer();
            } catch (error) {
                console.error(`Error stopping recording for space ${this.space.getSpaceName()}:`, error);
                Sentry.captureException(error);
            }

            for (const receivingUser of this.receivingUsers.values()) {
                this.sendLivekitDisconnectMessage(receivingUser);
            }

            await this.livekitService.deleteRoom(this.space.getSpaceName());
        })();
        const inFlight = teardown.finally(() => {
            if (this.teardownInFlight === inFlight) {
                this.teardownInFlight = undefined;
            }
        });
        this.teardownInFlight = inFlight;
        return inFlight;
    }

    updateUser(user: SpaceUser): void {}

    /** quanta: a teacher turned someone's microphone or camera off (Space.dispatchPrivateEvent). */
    forceMute(spaceUserId: string, source: "microphone" | "camera"): Promise<void> {
        return this.livekitService.muteParticipantSource(this.space.getSpaceName(), spaceUserId, source);
    }

    async initialize(
        users: ReadonlyMap<string, SpaceUser>,
        usersToNotify: ReadonlyMap<string, SpaceUser>,
    ): Promise<void> {
        for (const user of users.values()) {
            // We want to add users sequentially
            // The first user will trigger the room creation (which is async) but for other users, the
            // room will already be created, and the execution will not wait at all.
            // eslint-disable-next-line no-await-in-loop
            await this.addUser(user).catch((error) => {
                console.error(`Error adding user ${user.spaceUserId} to Livekit:`, error);
                Sentry.captureException(error);
            });
        }

        for (const user of usersToNotify.values()) {
            // We want to add users sequentially
            // The first user will trigger the room creation (which is async) but for other users, the
            // room will already be created, and the execution will not wait at all.
            // eslint-disable-next-line no-await-in-loop
            await this.addUserToNotify(user).catch((error) => {
                console.error(`Error adding user ${user.spaceUserId} to Livekit:`, error);
                Sentry.captureException(error);
            });
        }
    }

    addUserReady(userId: string): void {
        this.usersReady.add(userId);
    }

    canSwitch(): boolean {
        return this.usersReady.size === this.space.getAllUsers().length;
    }

    async addUserToNotify(user: SpaceUser): Promise<void> {
        return this.queueUserOperation(user.spaceUserId, async () => {
            if (this.receivingUsers.has(user.spaceUserId)) {
                console.warn("User already receiving in the room", user.spaceUserId);
                Sentry.captureMessage(`User already receiving in the room ${user.spaceUserId}`);
                return;
            }

            this.receivingUsers.set(user.spaceUserId, user);

            if (!this.createRoomPromise) {
                return;
            }
            await this.createRoomPromise;

            // Let's only send the invitation if the user is not already streaming in the room
            if (!this.streamingUsers.has(user.spaceUserId)) {
                await this.sendLivekitInvitationMessage(user);
            }
        });
    }

    deleteUserFromNotify(user: SpaceUser): void {
        this.queueUserOperation(user.spaceUserId, () => {
            const deleted = this.receivingUsers.delete(user.spaceUserId);
            if (!deleted) {
                console.warn("User to delete not found in receiving users", user.spaceUserId);
            }

            // Let's only disconnect from Livekit if the user is not streaming in the room anymore
            if (!this.streamingUsers.has(user.spaceUserId)) {
                this.sendLivekitDisconnectMessage(user);
            }

            // Nobody left to keep a speakerless room for.
            if (this.receivingUsers.size === 0 && this.streamingUsers.size === 0 && this.cancelScheduledTeardown()) {
                return this.teardownRoom();
            }
            return Promise.resolve();
        }).catch((error) => {
            console.error(`Error in deleteUserFromNotify for ${user.spaceUserId}:`, error);
            Sentry.captureException(error);
        });
    }

    private async sendLivekitInvitationMessage(user: SpaceUser): Promise<void> {
        const token = await this.livekitService.generateToken(this.space.getSpaceName(), user);

        this.space.dispatchPrivateEvent({
            spaceName: this.space.getSpaceName(),
            receiverUserId: user.spaceUserId,
            senderUserId: user.spaceUserId,
            spaceEvent: {
                event: {
                    $case: "livekitInvitationMessage",
                    livekitInvitationMessage: {
                        token: token,
                        serverUrl: this.livekitService.getLivekitFrontendUrl(),
                    },
                },
            },
        });
    }

    public handleMeetingConnectionRestartMessage(
        meetingConnectionRestartMessage: MeetingConnectionRestartMessage,
        senderUserId: string,
    ): void {
        const senderUser = this.space.getUser(senderUserId);
        if (!senderUser) {
            console.warn("User not found in space", senderUserId);
            return;
        }
        this.sendLivekitInvitationMessage(senderUser).catch((error) => {
            console.error(`Error generating token for user ${senderUser.spaceUserId} in Livekit:`, error);
            Sentry.captureException(error);
        });
    }

    cleanup(): void {
        this.disposed = true;
        this.cancelScheduledTeardown();
        for (const user of this.streamingUsers.values()) {
            this.deleteUser(user);
        }
        for (const user of this.receivingUsers.values()) {
            this.deleteUserFromNotify(user);
        }
        this.livekitService.deleteRoom(this.space.getSpaceName()).catch((error) => {
            console.error(error);
            Sentry.captureException(error);
        });
    }
    async startRecording(user: SpaceUser, recordingSessionId: string): Promise<RecordingStartInfo> {
        if (!this.createRoomPromise) {
            console.warn("Room not created yet");
            Sentry.captureMessage("[LivekitCommunicationStrategy] Room not created yet when starting recording");
            throw new Error("Livekit room not created yet");
        }

        await this.createRoomPromise;
        return await this.livekitService.startRecording(this.space.getSpaceName(), user, user.uuid, recordingSessionId);
    }
    async stopRecording(egressId?: string): Promise<void> {
        await this.livekitService.stopRecording(egressId);
    }

    async handleLivekitWebhook(
        rawBody: Buffer | Uint8Array,
        authorizationHeader: string | undefined,
        spaceName: string,
        recordingSessionId: string,
    ): Promise<HandleRecordingWebhookRequest | "ignored"> {
        return this.livekitService.handleLivekitWebhook(rawBody, authorizationHeader, spaceName, recordingSessionId);
    }
}
