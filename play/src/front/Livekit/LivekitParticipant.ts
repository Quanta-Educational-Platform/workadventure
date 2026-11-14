import type {
    RemoteParticipant,
    RemoteTrack,
    RemoteTrackPublication,
    TrackPublication,
    RemoteVideoTrack,
} from "livekit-client";
import * as Sentry from "@sentry/svelte";
import { Track, ParticipantEvent, VideoQuality } from "livekit-client";
import type { ConnectionQuality } from "livekit-client";
import type { Readable, Unsubscriber, Writable } from "svelte/store";
import { derived, get, writable } from "svelte/store";
import type { SpaceInterface, SpaceUserExtended } from "../Space/SpaceInterface";
import type { StreamableSubjects } from "../Space/SpacePeerManager/SpacePeerManager";
import { decrementLivekitConnectionsCount, incrementLivekitConnectionsCount } from "../Utils/E2EHooks";
import { volumeProximityDiscussionStore } from "../Stores/PeerStore";
import type { WebRtcStats } from "../Components/Video/WebRtcStats";
import { videoQualityStore } from "../Stores/MediaStore";
import { screenShareQualityStore } from "../Stores/ScreenSharingStore";

import { subscribeToVideoQualityAnalytics } from "../WebRtc/VideoQualityAnalytics";
import { createLivekitWebRtcStats } from "../WebRtc/WebRtcStatsFactory";
import { registerAudioQualitySource } from "../WebRtc/AudioQualityAnalytics";
import type { Streamable } from "../Space/Streamable";
import { analyticsClient } from "../Administration/AnalyticsClient";
import { SCRIPTING_AUDIO_TRACK_NAME } from "./LivekitConstants";
import { createWeakConnectionTracker, weakConnectionStore } from "./WeakConnection";

// Maximize/minimize can briefly mount 2 video components for the same participant.
// Delaying the final unsubscribe avoids sending a false->true bounce to LiveKit during that handoff.
const VIDEO_UNSUBSCRIBE_DELAY_MS = 75;

// quanta: a voice the space says is on but this browser does not play. Checked this often, and acted on once it lasted
// long enough not to be a microphone that is just being published or a subscription on its way.
const AUDIO_CHECK_MS = 4_000;
const AUDIO_MISSING_MS = 8_000;
const AUDIO_REPAIR_EVERY_MS = 20_000;
// A first subscription on a weak link can take this long: asking again sooner would only start it over.
const AUDIO_RESUBSCRIBE_AFTER_MS = 20_000;

type MissingAudioReason = "missed_publication" | "state_lost" | "resubscribe" | "not_published" | "muted_publication";
type MissingAudioEnd = "microphone_off" | "blocked" | "audio_muted" | "speaker_side" | "closed";

export class LiveKitParticipant {
    private _isSpeakingStore: Writable<boolean>;
    private _audioStreamStore: Writable<MediaStream | undefined> = writable<MediaStream | undefined>(undefined);
    private _actualVideo: Streamable | undefined;
    private _actualScreenShare: Streamable | undefined;

    private _audioScreenShareStreamStore: Writable<MediaStream | undefined> = writable<MediaStream | undefined>(
        undefined,
    );

    private _nameStore: Writable<string>;
    private _hasVideo = writable<boolean>(false);
    private _hasMicrophoneAudio = writable<boolean>(false);
    private _hasScriptingAudio = writable<boolean>(false);
    private _hasAudio: Readable<boolean> = derived(
        [this._hasMicrophoneAudio, this._hasScriptingAudio],
        ([$hasMicrophoneAudio, $hasScriptingAudio]) => $hasMicrophoneAudio || $hasScriptingAudio,
    );
    private _hasScreenShareVideo = writable<boolean>(false);
    private _canEmitScreenShareAudio = writable<boolean>(false);
    private _hasScreenShareAudio = writable<boolean>(false);
    private _spaceUser: SpaceUserExtended;
    private _videoRemoteTrack: Writable<RemoteVideoTrack | undefined> = writable<RemoteVideoTrack | undefined>(
        undefined,
    );
    private _screenShareRemoteTrack: Writable<RemoteVideoTrack | undefined> = writable<RemoteVideoTrack | undefined>(
        undefined,
    );
    private _muteAudioStore: Writable<boolean> = writable<boolean>(false);
    // quanta: this person's own link, as LiveKit rates it, held for a while like our own (WeakConnection.ts): their tile
    // says so, so a lagging voice or board is put down to the right person.
    private _weakConnection = writable<boolean>(false);
    private readonly weakLink = createWeakConnectionTracker((weak) => this._weakConnection.set(weak), { own: false });
    private readonly boundHandleConnectionQualityChanged = (quality: ConnectionQuality) =>
        this.weakLink.update(quality);
    private _cameraVideoSubscriptions = new Set<symbol>();
    private _screenShareVideoSubscriptions = new Set<symbol>();
    private _cameraVideoSubscribed = false;
    private _screenShareVideoSubscribed = false;
    private _cameraUnsubscribeTimeout: ReturnType<typeof setTimeout> | undefined;
    private _screenShareUnsubscribeTimeout: ReturnType<typeof setTimeout> | undefined;
    private readonly videoWebrtcStats: Readable<WebRtcStats | undefined>;
    private readonly screenShareWebrtcStats: Readable<WebRtcStats | undefined>;
    private readonly analyticsStatsUnsubscribers: Unsubscriber[] = [];
    private audioMissingSince: number | undefined;
    private audioRepairedAt = 0;
    private audioMissingReported: MissingAudioReason | undefined;
    private readonly audioCheckTimer: ReturnType<typeof setInterval>;

    private _cameraPublication: RemoteTrackPublication | undefined;
    private _microphonePublication: RemoteTrackPublication | undefined;
    private _scriptingAudioPublication: RemoteTrackPublication | undefined;
    private _screenSharePublication: RemoteTrackPublication | undefined;
    private _screenShareAudioPublication: RemoteTrackPublication | undefined;
    private _microphoneStream: MediaStream | undefined;
    private _scriptingAudioStream: MediaStream | undefined;

    private boundHandleTrackPublished: (publication: RemoteTrackPublication) => void;
    private boundHandleTrackSubscribed: (track: RemoteTrack, publication: RemoteTrackPublication) => void;
    private boundHandleTrackUnpublished: (publication: RemoteTrackPublication) => void;
    private boundHandleTrackUnsubscribed: (track: RemoteTrack, publication: RemoteTrackPublication) => void;
    private boundHandleTrackMuted: (publication: TrackPublication) => void;
    private boundHandleTrackUnmuted: (publication: TrackPublication) => void;
    private boundHandleIsSpeakingChanged: (isSpeaking: boolean) => void;
    private readonly unsubscribeWeakConnection: Unsubscriber;

    constructor(
        public participant: RemoteParticipant,
        spaceUser: SpaceUserExtended,
        private space: SpaceInterface,
        private livekitServerUrl: string,
        private _streamableSubjects: StreamableSubjects,
        private _blockedUsersStore: Readable<Set<string>>,
        private abortSignal: AbortSignal,
        private getLivekitRegion: () => string | undefined = () => undefined,
        private defaultVolume: number = get(volumeProximityDiscussionStore),
        private getConnectionId: () => string | undefined = () => undefined,
        private isRoomConnected: () => boolean = () => true,
        private isReceivingSettled: () => boolean = () => true,
        private reportsSpeakerSide: () => boolean = () => true,
    ) {
        incrementLivekitConnectionsCount();
        this.boundHandleTrackPublished = this.handleTrackPublished.bind(this);
        this.boundHandleTrackSubscribed = this.handleTrackSubscribed.bind(this);
        this.boundHandleTrackUnpublished = this.handleTrackUnpublished.bind(this);
        this.boundHandleTrackUnsubscribed = this.handleTrackUnsubscribed.bind(this);
        this.boundHandleTrackMuted = this.handleTrackMuted.bind(this);
        this.boundHandleTrackUnmuted = this.handleTrackUnmuted.bind(this);
        this.boundHandleIsSpeakingChanged = this.handleIsSpeakingChanged.bind(this);

        this.participant.on(ParticipantEvent.TrackPublished, this.boundHandleTrackPublished);
        this.participant.on(ParticipantEvent.TrackSubscribed, this.boundHandleTrackSubscribed);
        this.participant.on(ParticipantEvent.TrackUnpublished, this.boundHandleTrackUnpublished);
        this.participant.on(ParticipantEvent.TrackUnsubscribed, this.boundHandleTrackUnsubscribed);
        this.participant.on(ParticipantEvent.TrackMuted, this.boundHandleTrackMuted);
        this.participant.on(ParticipantEvent.TrackUnmuted, this.boundHandleTrackUnmuted);
        this.participant.on(ParticipantEvent.IsSpeakingChanged, this.boundHandleIsSpeakingChanged);
        this.participant.on(ParticipantEvent.ConnectionQualityChanged, this.boundHandleConnectionQualityChanged);

        // quanta: a weak link of our own steps the camera down to its lowest layer, and back up once it recovers.
        let firstWeakValue = true;
        this.unsubscribeWeakConnection = weakConnectionStore.subscribe(() => {
            if (firstWeakValue) {
                firstWeakValue = false;
                return;
            }
            const publication = this._cameraPublication;
            if (publication?.isSubscribed) publication.setVideoQuality(this.cameraMaxQuality());
        });

        this._spaceUser = spaceUser;
        this._isSpeakingStore = writable(this.participant.isSpeaking);
        this._nameStore = writable(this.participant.name);
        this.videoWebrtcStats = this.getWebrtcStats("video");
        this.screenShareWebrtcStats = this.getWebrtcStats("screenShare");
        for (const publication of this.participant.getTrackPublications()) {
            if (publication.isLocal) {
                continue;
            }

            const remotePublication = publication as RemoteTrackPublication;
            this.handleTrackPublished(remotePublication);

            const track = remotePublication.track;
            if (track) {
                this.handleTrackSubscribed(track, remotePublication);
            }
        }

        this.updateLivekitVideoStreamStore();
        this.analyticsStatsUnsubscribers.push(this.subscribeToAnalyticsStats("video", this.videoWebrtcStats));
        this.analyticsStatsUnsubscribers.push(
            this.subscribeToAnalyticsStats("screenShare", this.screenShareWebrtcStats),
        );
        // The microphone only: a scripting audio track is not a voice
        this.analyticsStatsUnsubscribers.push(
            registerAudioQualitySource(
                "SFU",
                async () => this._microphonePublication?.track?.getRTCStatsReport(),
                this._spaceUser.reactiveUser.microphoneState,
            ),
        );
        this.audioCheckTimer = setInterval(() => this.checkMicrophoneAudio(), AUDIO_CHECK_MS);
    }

    /** The speaker's microphone as LiveKit has it: not the scripting track, which publishes under the same source. */
    private findMicrophonePublication(): RemoteTrackPublication | undefined {
        for (const publication of this.participant.audioTrackPublications.values()) {
            if (publication.source === Track.Source.Microphone && !this.isScriptingAudioPublication(publication)) {
                return publication;
            }
        }
        return undefined;
    }

    /**
     * The space says this person's microphone is on, but nothing plays here: repairs what this browser can (an event it
     * missed, a state an unsubscribe left behind, a subscription the server dropped) and reports what it found, once per
     * episode, so a speaker-side cause (nothing published, a muted track) can be told from a listener-side one.
     */
    private checkMicrophoneAudio(): void {
        if (this.abortSignal.aborted) return;
        const micOn = get(this._spaceUser.reactiveUser.microphoneState) === true;
        const blocked = get(this._blockedUsersStore).has(this._spaceUser.spaceUserId);
        // An attendee shown in a megaphone space: their microphone is on for the app, but they never publish here.
        const audioMuted = get(this._muteAudioStore);
        const playing = get(this._hasMicrophoneAudio);
        if (!micOn || blocked || audioMuted || playing) {
            this.closeMissingAudio(
                playing ? undefined : !micOn ? "microphone_off" : blocked ? "blocked" : "audio_muted",
            );
            this.audioMissingSince = undefined;
            return;
        }
        // Our own room reconnecting: nothing plays and nothing here would help; the wait starts again once it is back.
        if (!this.isRoomConnected()) {
            this.audioMissingSince = undefined;
            return;
        }
        const now = Date.now();
        this.audioMissingSince ??= now;
        const missingFor = now - this.audioMissingSince;
        if (missingFor < AUDIO_MISSING_MS) return;

        const publication = this.findMicrophonePublication();
        let reason: MissingAudioReason;
        if (!publication) {
            reason = "not_published";
        } else if (publication.isMuted) {
            reason = "muted_publication";
        } else if (publication !== this._microphonePublication) {
            reason = "missed_publication";
        } else if (publication.track) {
            reason = "state_lost";
        } else {
            reason = "resubscribe";
        }

        if (reason === "not_published" || reason === "muted_publication") {
            // Every listener sees the same: one of them reports it, and the speaker's own client has their side.
            if (!this.reportsSpeakerSide()) {
                this.closeMissingAudio("speaker_side");
                return;
            }
        } else if (
            reason === "resubscribe" &&
            (missingFor < AUDIO_RESUBSCRIBE_AFTER_MS || !this.isReceivingSettled())
        ) {
            return;
        }

        if (
            reason !== "not_published" &&
            reason !== "muted_publication" &&
            publication &&
            now - this.audioRepairedAt >= AUDIO_REPAIR_EVERY_MS
        ) {
            this.audioRepairedAt = now;
            if (reason === "missed_publication") {
                this.handleTrackPublished(publication);
                if (publication.track) this.handleTrackSubscribed(publication.track, publication);
            } else if (reason === "state_lost" && publication.track) {
                this.handleTrackSubscribed(publication.track, publication);
            } else {
                // Desired but never delivered: asking again makes the server set the subscription up anew.
                if (publication.isDesired) publication.setSubscribed(false);
                publication.setSubscribed(true);
            }
        }

        if (this.audioMissingReported !== reason) {
            this.audioMissingReported = reason;
            this.reportMissingAudio("media.remote_audio.missing", reason);
        }
    }

    /** Ends a reported episode, so none is left open on dashboards: recovered, or ended for the given cause. */
    private closeMissingAudio(end?: MissingAudioEnd): void {
        const reason = this.audioMissingReported;
        if (reason === undefined) return;
        this.audioMissingReported = undefined;
        if (end) {
            analyticsClient.trackAdminEvent("media.remote_audio.ended", {
                ...this.missingAudioProperties(reason),
                end,
            });
        } else {
            this.reportMissingAudio("media.remote_audio.recovered", reason);
        }
    }

    private reportMissingAudio(
        event: "media.remote_audio.missing" | "media.remote_audio.recovered",
        reason: MissingAudioReason,
    ): void {
        analyticsClient.trackAdminEvent(event, this.missingAudioProperties(reason));
    }

    private missingAudioProperties(reason: MissingAudioReason) {
        return {
            reason,
            durationMs: this.audioMissingSince === undefined ? 0 : Date.now() - this.audioMissingSince,
            connectionId: this.getConnectionId() ?? null,
            participantSid: this.participant.sid,
            trackSid: this.findMicrophonePublication()?.trackSid ?? null,
        };
    }

    private acquireVideoSubscription(type: "camera" | "screenShare"): () => void {
        const subscriptions = type === "camera" ? this._cameraVideoSubscriptions : this._screenShareVideoSubscriptions;
        const token = Symbol(type);
        let released = false;

        subscriptions.add(token);
        if (subscriptions.size === 1) {
            // A new viewer arrived before the delayed unsubscribe fired. Keep the current server-side
            // subscription alive so layout churn does not trigger unnecessary LiveKit updates.
            this.clearPendingVideoUnsubscribe(type);
            this.setVideoSubscribed(type, true);
        }

        return () => {
            if (released) {
                return;
            }

            released = true;
            subscriptions.delete(token);
            if (subscriptions.size === 0) {
                this.scheduleVideoUnsubscribe(type);
            }
        };
    }

    private clearPendingVideoUnsubscribe(type: "camera" | "screenShare") {
        const timeout = type === "camera" ? this._cameraUnsubscribeTimeout : this._screenShareUnsubscribeTimeout;
        if (timeout === undefined) {
            return;
        }

        clearTimeout(timeout);

        if (type === "camera") {
            this._cameraUnsubscribeTimeout = undefined;
        } else {
            this._screenShareUnsubscribeTimeout = undefined;
        }
    }

    private scheduleVideoUnsubscribe(type: "camera" | "screenShare") {
        this.clearPendingVideoUnsubscribe(type);

        const timeout = setTimeout(() => {
            if (type === "camera") {
                this._cameraUnsubscribeTimeout = undefined;
                if (this._cameraVideoSubscriptions.size === 0) {
                    // Only unsubscribe if nobody reacquired the video during the short grace period.
                    this.setVideoSubscribed("camera", false);
                }
                return;
            }

            this._screenShareUnsubscribeTimeout = undefined;
            if (this._screenShareVideoSubscriptions.size === 0) {
                // Only unsubscribe if nobody reacquired the screen share during the short grace period.
                this.setVideoSubscribed("screenShare", false);
            }
        }, VIDEO_UNSUBSCRIBE_DELAY_MS);

        if (type === "camera") {
            this._cameraUnsubscribeTimeout = timeout;
        } else {
            this._screenShareUnsubscribeTimeout = timeout;
        }
    }

    private setVideoSubscribed(type: "camera" | "screenShare", subscribed: boolean) {
        if (type === "camera") {
            if (this._cameraVideoSubscribed === subscribed) {
                return;
            }

            this._cameraVideoSubscribed = subscribed;
            this._cameraPublication?.setSubscribed(subscribed);
            return;
        }

        if (this._screenShareVideoSubscribed === subscribed) {
            return;
        }

        this._screenShareVideoSubscribed = subscribed;
        this._screenSharePublication?.setSubscribed(subscribed);
    }

    private syncVideoSubscriptionState(type: "camera" | "screenShare") {
        if (type === "camera") {
            this._cameraPublication?.setSubscribed(this._cameraVideoSubscribed);
            return;
        }

        this._screenSharePublication?.setSubscribed(this._screenShareVideoSubscribed);
    }

    private isScriptingAudioPublication(publication: TrackPublication): boolean {
        return (
            publication.source === Track.Source.Microphone &&
            publication.kind === Track.Kind.Audio &&
            publication.trackName === SCRIPTING_AUDIO_TRACK_NAME
        );
    }

    private refreshLivekitAudioStreamStore() {
        const audioTracks = [
            ...(this._microphoneStream?.getAudioTracks() ?? []),
            ...(this._scriptingAudioStream?.getAudioTracks() ?? []),
        ];

        if (audioTracks.length === 0) {
            this._audioStreamStore.set(undefined);
            return;
        }

        if (this._microphoneStream && audioTracks.length === this._microphoneStream.getAudioTracks().length) {
            this._audioStreamStore.set(this._microphoneStream);
            return;
        }

        if (this._scriptingAudioStream && audioTracks.length === this._scriptingAudioStream.getAudioTracks().length) {
            this._audioStreamStore.set(this._scriptingAudioStream);
            return;
        }

        this._audioStreamStore.set(new MediaStream(audioTracks));
    }

    private handleTrackPublished(publication: RemoteTrackPublication) {
        if (this.abortSignal.aborted) {
            return;
        }

        if (publication.source === Track.Source.Camera) {
            if (this._cameraPublication && this._cameraPublication !== publication) {
                console.warn(
                    "Camera track received on a publication that is not the one we expected. This should not happen.",
                );
                Sentry.captureMessage(
                    "Camera track received on a publication that is not the one we expected. This should not happen.",
                );
                this._cameraPublication.setSubscribed(false);
            }
            this._cameraPublication = publication;
            this._hasVideo.set(!publication.isMuted);
            this.syncVideoSubscriptionState("camera");
        } else if (publication.source === Track.Source.ScreenShare) {
            if (this._screenSharePublication && this._screenSharePublication !== publication) {
                console.warn(
                    "Screen share track received on a publication that is not the one we expected. This should not happen.",
                );
                Sentry.captureMessage(
                    "Screen share track received on a publication that is not the one we expected. This should not happen.",
                );
                this._screenSharePublication.setSubscribed(false);
            }
            this._screenSharePublication = publication;
            this._hasScreenShareVideo.set(!publication.isMuted);
            this.syncVideoSubscriptionState("screenShare");
            this.refreshLivekitScreenShareStreamStore();
        } else if (publication.source === Track.Source.ScreenShareAudio) {
            if (this._screenShareAudioPublication && this._screenShareAudioPublication !== publication) {
                console.warn(
                    "Screen share audio track received on a publication that is not the one we expected. This should not happen.",
                );
                Sentry.captureMessage(
                    "Screen share audio track received on a publication that is not the one we expected. This should not happen.",
                );
                this._screenShareAudioPublication.setSubscribed(false);
            }
            publication.setSubscribed(true);
            this._screenShareAudioPublication = publication;
            this._canEmitScreenShareAudio.set(true);
            this._hasScreenShareAudio.set(!publication.isMuted);
            this.refreshLivekitScreenShareStreamStore();
        } else if (this.isScriptingAudioPublication(publication)) {
            if (this._scriptingAudioPublication && this._scriptingAudioPublication !== publication) {
                console.warn(
                    "Scripting audio track received on a publication that is not the one we expected. This should not happen.",
                );
                Sentry.captureMessage(
                    "Scripting audio track received on a publication that is not the one we expected. This should not happen.",
                );
                this._scriptingAudioPublication.setSubscribed(false);
            }
            publication.setSubscribed(true);
            this._scriptingAudioPublication = publication;
            this._hasScriptingAudio.set(!publication.isMuted);
        } else if (publication.source === Track.Source.Microphone) {
            if (this._microphonePublication && this._microphonePublication !== publication) {
                console.warn(
                    "Microphone track received on a publication that is not the one we expected. This should not happen.",
                );
                Sentry.captureMessage(
                    "Microphone track received on a publication that is not the one we expected. This should not happen.",
                );
                this._microphonePublication.setSubscribed(false);
            }
            publication.setSubscribed(true);
            this._microphonePublication = publication;
            this._hasMicrophoneAudio.set(!publication.isMuted);
        }
    }

    private handleTrackSubscribed(track: RemoteTrack, publication: RemoteTrackPublication) {
        if (this.abortSignal.aborted) {
            return;
        }
        if (publication.source === Track.Source.Camera) {
            this._videoRemoteTrack.set(track as RemoteVideoTrack);

            // Always set, HIGH too: LiveKit keeps a publication's requested quality across an unsubscribe, so a camera
            // capped while the link was weak and off screen when it recovered would otherwise come back capped.
            publication.setVideoQuality(this.cameraMaxQuality());
        } else if (publication.source === Track.Source.ScreenShare) {
            this._screenShareRemoteTrack.set(track as RemoteVideoTrack);

            // Apply video quality based on screen share bandwidth setting
            const screenShareQualitySetting = get(screenShareQualityStore);
            // If the setting is low, do not go in resolution above MEDIUM
            if (screenShareQualitySetting === "low") {
                publication.setVideoQuality(VideoQuality.MEDIUM);
            }
        } else if (publication.source === Track.Source.ScreenShareAudio) {
            this._audioScreenShareStreamStore.set(track.mediaStream);
            // An unsubscribe cleared it, and a resubscription to the same publication sends no unmute
            if (this._screenShareAudioPublication === publication) {
                this._hasScreenShareAudio.set(!publication.isMuted);
                this.refreshLivekitScreenShareStreamStore();
            }
        } else if (this.isScriptingAudioPublication(publication)) {
            this._scriptingAudioStream = track.mediaStream;
            this.refreshLivekitAudioStreamStore();
            if (this._scriptingAudioPublication === publication) this._hasScriptingAudio.set(!publication.isMuted);
        } else if (publication.source === Track.Source.Microphone) {
            this._microphoneStream = track.mediaStream;
            this.refreshLivekitAudioStreamStore();
            // The audio element only plays while hasAudio holds (AudioStreamWrapper): a track that ended and came back on
            // the same publication (the SFU dropped and re-added it) would otherwise stay silent with the speaker "on".
            if (this._microphonePublication === publication) this._hasMicrophoneAudio.set(!publication.isMuted);
        }
    }

    /** The low bandwidth setting caps cameras at MEDIUM; a weak link of our own at LOW. */
    private cameraMaxQuality(): VideoQuality {
        if (get(weakConnectionStore)) return VideoQuality.LOW;
        return get(videoQualityStore) === "low" ? VideoQuality.MEDIUM : VideoQuality.HIGH;
    }

    private handleTrackUnpublished(publication: RemoteTrackPublication) {
        if (publication.source === Track.Source.Camera) {
            publication.setSubscribed(false);
            if (this._cameraPublication === publication) {
                this._cameraPublication = undefined;
            }
            this._videoRemoteTrack.set(undefined);
            this._hasVideo.set(false);
        } else if (publication.source === Track.Source.ScreenShare) {
            publication.setSubscribed(false);
            if (this._screenSharePublication === publication) {
                this._screenSharePublication = undefined;
            }
            this._screenShareRemoteTrack.set(undefined);
            this._hasScreenShareVideo.set(false);
            this.refreshLivekitScreenShareStreamStore();
        } else if (publication.source === Track.Source.ScreenShareAudio) {
            publication.setSubscribed(false);
            if (this._screenShareAudioPublication === publication) {
                this._screenShareAudioPublication = undefined;
                this._audioScreenShareStreamStore.set(undefined);
                this._canEmitScreenShareAudio.set(false);
                this._hasScreenShareAudio.set(false);
                this.refreshLivekitScreenShareStreamStore();
            }
        } else if (this.isScriptingAudioPublication(publication)) {
            publication.setSubscribed(false);
            if (this._scriptingAudioPublication === publication) {
                this._scriptingAudioPublication = undefined;
                this._scriptingAudioStream = undefined;
                this.refreshLivekitAudioStreamStore();
                this._hasScriptingAudio.set(false);
            }
        } else if (publication.source === Track.Source.Microphone) {
            publication.setSubscribed(false);
            if (this._microphonePublication === publication) {
                this._microphonePublication = undefined;
                this._microphoneStream = undefined;
                this.refreshLivekitAudioStreamStore();
                this._hasMicrophoneAudio.set(false);
            }
        }
    }

    private handleTrackUnsubscribed(track: RemoteTrack, publication: RemoteTrackPublication) {
        if (publication.source === Track.Source.Camera) {
            if (get(this._videoRemoteTrack) === track) {
                this._videoRemoteTrack.set(undefined);
            }
        } else if (publication.source === Track.Source.ScreenShare) {
            if (get(this._screenShareRemoteTrack) === track) {
                this._screenShareRemoteTrack.set(undefined);
            }
        } else if (publication.source === Track.Source.ScreenShareAudio) {
            if (this._screenShareAudioPublication === publication) {
                this._audioScreenShareStreamStore.set(undefined);
                this._hasScreenShareAudio.set(false);
                this.refreshLivekitScreenShareStreamStore();
            }
        } else if (this.isScriptingAudioPublication(publication)) {
            if (this._scriptingAudioPublication === publication) {
                this._scriptingAudioStream = undefined;
                this.refreshLivekitAudioStreamStore();
                this._hasScriptingAudio.set(false);
            }
        } else if (publication.source === Track.Source.Microphone) {
            if (this._microphonePublication === publication) {
                this._microphoneStream = undefined;
                this.refreshLivekitAudioStreamStore();
                this._hasMicrophoneAudio.set(false);
            }
        }
    }

    private handleTrackMuted(publication: TrackPublication) {
        if (this.isScriptingAudioPublication(publication) && this._scriptingAudioPublication === publication) {
            this._hasScriptingAudio.set(false);
        } else if (publication.source === Track.Source.Microphone && this._microphonePublication === publication) {
            this._hasMicrophoneAudio.set(false);
        } else if (publication.source === Track.Source.Camera) {
            this._hasVideo.set(false);
        } else if (publication.source === Track.Source.ScreenShare) {
            this._hasScreenShareVideo.set(false);
            this.refreshLivekitScreenShareStreamStore();
        } else if (
            publication.source === Track.Source.ScreenShareAudio &&
            this._screenShareAudioPublication === publication
        ) {
            this._hasScreenShareAudio.set(false);
        }
    }

    private handleTrackUnmuted(publication: TrackPublication) {
        if (this.isScriptingAudioPublication(publication) && this._scriptingAudioPublication === publication) {
            this._hasScriptingAudio.set(true);
        } else if (publication.source === Track.Source.Microphone && this._microphonePublication === publication) {
            this._hasMicrophoneAudio.set(true);
        } else if (publication.source === Track.Source.Camera) {
            this._hasVideo.set(true);
        } else if (publication.source === Track.Source.ScreenShare) {
            this._hasScreenShareVideo.set(true);
            this.refreshLivekitScreenShareStreamStore();
        } else if (
            publication.source === Track.Source.ScreenShareAudio &&
            this._screenShareAudioPublication === publication
        ) {
            this._hasScreenShareAudio.set(true);
        }
    }

    private handleIsSpeakingChanged(isSpeaking: boolean) {
        this._isSpeakingStore.set(isSpeaking);
    }

    private updateLivekitVideoStreamStore() {
        //Old stream
        const actualVideo = this._actualVideo;

        if (actualVideo) {
            this._streamableSubjects.videoPeerRemoved.next(actualVideo);
        }

        // New Stream
        this._actualVideo = this.getVideoStream();
        this._streamableSubjects.videoPeerAdded.next(this._actualVideo);
    }

    private refreshLivekitScreenShareStreamStore() {
        const shouldHaveScreenShareStream = get(this._hasScreenShareVideo) || get(this._canEmitScreenShareAudio);

        if (!shouldHaveScreenShareStream) {
            if (this._actualScreenShare) {
                const actualScreenShare = this._actualScreenShare;
                this._actualScreenShare = undefined;
                this._streamableSubjects.screenSharingPeerRemoved.next(actualScreenShare);
            }
            return;
        }

        if (!this._actualScreenShare) {
            this._actualScreenShare = this.getScreenShareStream();
            this._streamableSubjects.screenSharingPeerAdded.next(this._actualScreenShare);
        }
    }

    private getVideoStream(): Streamable {
        return {
            uniqueId: this.participant.identity,
            hasVideo: this._hasVideo,
            hasAudio: this._hasAudio,
            statusStore: writable("connected"),
            spaceUserId: this._spaceUser.spaceUserId,
            name: this._nameStore,
            showVoiceIndicator: this._isSpeakingStore,
            flipX: false,
            muteAudio: this._muteAudioStore,
            displayMode: "cover",
            usePresentationMode: false,
            media: {
                type: "livekit",
                remoteVideoTrack: this._videoRemoteTrack,
                // Important note: the stream store only contains the audio track:
                streamStore: this._audioStreamStore,
                isBlocked: derived(this._blockedUsersStore, ($blockedUsersStore) =>
                    $blockedUsersStore.has(this._spaceUser.spaceUserId),
                ),
                acquireVideoSubscription: () => this.acquireVideoSubscription("camera"),
            },
            volumeStore: writable(undefined),
            volume: writable(this.defaultVolume),
            closeStreamable: () => {},
            canCloseStreamable: () => false,
            videoType: "video",
            webrtcStats: this.videoWebrtcStats,
            weakConnection: this._weakConnection,
        };
    }

    private getScreenShareStream(): Streamable {
        return {
            uniqueId: this.participant.sid,
            hasVideo: this._hasScreenShareVideo,
            hasAudio: this._hasScreenShareAudio,
            statusStore: writable("connected"),
            spaceUserId: this._spaceUser.spaceUserId,
            name: this._nameStore,
            showVoiceIndicator: writable(false),
            flipX: false,
            muteAudio: writable(false),
            displayMode: "fit",
            usePresentationMode: true,
            media: {
                type: "livekit",
                remoteVideoTrack: this._screenShareRemoteTrack,
                // Important note: the stream store contains the audio track from ScreenShareAudio
                streamStore: this._audioScreenShareStreamStore,
                isBlocked: derived(this._blockedUsersStore, ($blockedUsersStore) =>
                    $blockedUsersStore.has(this._spaceUser.spaceUserId),
                ),
                acquireVideoSubscription: () => this.acquireVideoSubscription("screenShare"),
            },
            volumeStore: writable(undefined),
            volume: writable(this.defaultVolume),
            closeStreamable: () => {},
            canCloseStreamable: () => false,
            videoType: "screenSharing",
            webrtcStats: this.screenShareWebrtcStats,
            weakConnection: this._weakConnection,
        };
    }

    private getWebrtcStats(type: "video" | "screenShare"): Readable<WebRtcStats | undefined> {
        const trackStore = type === "video" ? this._videoRemoteTrack : this._screenShareRemoteTrack;
        return derived([trackStore], ([$track], set) => {
            if ($track) {
                const statsStore = createLivekitWebRtcStats($track, type === "video" ? "video" : "screenSharing");
                const statsUnsubscribe = statsStore.subscribe(set);
                return () => {
                    statsUnsubscribe();
                };
            } else {
                set(undefined);
                return () => {};
            }
        });
    }

    private subscribeToAnalyticsStats(
        type: "video" | "screenShare",
        statsStore: Readable<WebRtcStats | undefined>,
    ): Unsubscriber {
        return subscribeToVideoQualityAnalytics(
            statsStore,
            {
                streamId: `${this.participant.sid}:${type}`,
                getStreamId: () =>
                    `${this.participant.sid}:${(type === "video" ? this._cameraPublication : this._screenSharePublication)?.trackSid ?? "unpublished"}:${type}`,
                getConnectionId: this.getConnectionId,
                getMediaTrackId: () =>
                    (type === "video" ? this._cameraPublication : this._screenSharePublication)?.track?.mediaStreamTrack
                        .id,
                streamCategory: type === "video" ? "video" : "screenSharing",
                transportType: "Livekit",
                remoteSpaceUserId: this._spaceUser.spaceUserId,
                remoteUserUuid: this._spaceUser.uuid,
                spaceName: this.space.getName(),
                livekitServerUrl: this.livekitServerUrl,
                getLivekitRegion: this.getLivekitRegion,
            },
            (message) => this.space.emitVideoQualityReport(message),
        );
    }

    public getStreamable(): Streamable {
        return this.getVideoStream();
    }

    public getScreenSharingStreamable(): Streamable {
        return this.getScreenShareStream();
    }

    /** `replaced`: LiveKit holds a newer object for this person with the same tracks, so their subscriptions stay. */
    public destroy(options: { replaced?: boolean } = {}) {
        decrementLivekitConnectionsCount();
        clearInterval(this.audioCheckTimer);
        this.closeMissingAudio("closed");
        this.analyticsStatsUnsubscribers.forEach((unsubscribe) => unsubscribe());
        this.analyticsStatsUnsubscribers.length = 0;

        if (this._actualVideo) {
            this._streamableSubjects.videoPeerRemoved.next(this._actualVideo);
            this._actualVideo = undefined;
        }

        if (this._actualScreenShare) {
            this._streamableSubjects.screenSharingPeerRemoved.next(this._actualScreenShare);
            this._actualScreenShare = undefined;
        }

        this.clearPendingVideoUnsubscribe("camera");
        this.clearPendingVideoUnsubscribe("screenShare");
        this._cameraVideoSubscriptions.clear();
        this._screenShareVideoSubscriptions.clear();
        this._cameraVideoSubscribed = false;
        this._screenShareVideoSubscribed = false;
        // An unsubscribe goes out by track id on the room's shared signal connection: for a replaced object it would
        // cut the new one's live tracks too.
        if (!options.replaced) {
            this._cameraPublication?.setSubscribed(false);
            this._microphonePublication?.setSubscribed(false);
            this._scriptingAudioPublication?.setSubscribed(false);
            this._screenSharePublication?.setSubscribed(false);
            this._screenShareAudioPublication?.setSubscribed(false);
        }

        this.participant.off(ParticipantEvent.TrackPublished, this.boundHandleTrackPublished);
        this.participant.off(ParticipantEvent.TrackSubscribed, this.boundHandleTrackSubscribed);
        this.participant.off(ParticipantEvent.TrackUnpublished, this.boundHandleTrackUnpublished);
        this.participant.off(ParticipantEvent.TrackUnsubscribed, this.boundHandleTrackUnsubscribed);
        this.participant.off(ParticipantEvent.TrackMuted, this.boundHandleTrackMuted);
        this.participant.off(ParticipantEvent.TrackUnmuted, this.boundHandleTrackUnmuted);
        this.participant.off(ParticipantEvent.IsSpeakingChanged, this.boundHandleIsSpeakingChanged);
        this.participant.off(ParticipantEvent.ConnectionQualityChanged, this.boundHandleConnectionQualityChanged);
        this.weakLink.stop();
        this.unsubscribeWeakConnection();
    }
}
