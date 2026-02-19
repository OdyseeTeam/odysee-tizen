(function (global) {
    var Odysee = global.Odysee || (global.Odysee = {});
    var debug = Odysee.debug || { enabled: false, verbose: false, log: function () {}, warn: function () {}, error: function () {} };

    function PlayerService(videoElement, onStateChange) {
        this.videoElement = videoElement;
        this.onStateChange = onStateChange || function () {};
        this.state = "idle";
        this.avplay = null;
        this.useAvPlay = false;
        this.currentUrl = "";
        this.currentTimeMs = 0;
        this.durationMs = 0;
        this.lastPlaytimeLogSec = -1;
        this.avplaySessionId = 0;
        this.pendingAvErrorTimer = null;
        this.pendingAvError = null;
        this.pendingAvCompleteTimer = null;
        this.pendingAvComplete = null;
        this.avplaySeekingUntilMs = 0;
        this.lastAvPlayStartAtMs = 0;

        if (global.webapis && global.webapis.avplay) {
            this.avplay = global.webapis.avplay;
            this.useAvPlay = true;
            this.videoElement.style.display = "none";
            this.configureAvPlayListeners();
            debug.log("[player] using AVPlay backend");
        } else {
            debug.warn("[player] AVPlay unavailable; using HTML5 video backend");
        }

        if (!this.useAvPlay) {
            this.bindHtmlVideoEvents();
        }
    }

    PlayerService.prototype.bindHtmlVideoEvents = function () {
        var self = this;
        this.videoElement.addEventListener("playing", function () {
            self.setState("playing");
        });
        this.videoElement.addEventListener("pause", function () {
            if (self.state !== "stopped") {
                self.setState("paused");
            }
        });
        this.videoElement.addEventListener("ended", function () {
            self.setState("ended");
        });
        this.videoElement.addEventListener("error", function () {
            self.setState("error");
        });
    };

    PlayerService.prototype.configureAvPlayListeners = function (sessionId) {
        var self = this;
        if (!this.avplay || !this.avplay.setListener) {
            return;
        }
        var activeSessionId = typeof sessionId === "number" ? sessionId : this.avplaySessionId;
        this.avplay.setListener({
            onbufferingstart: function () {
                if (!self.isAvPlaySessionActive(activeSessionId)) {
                    return;
                }
                self.clearPendingAvError();
                self.clearPendingAvComplete();
                debug.log("[player][avplay] buffering start");
                if (self.state !== "paused") {
                    self.setState("buffering");
                }
            },
            onbufferingprogress: function () {},
            onbufferingcomplete: function () {
                if (!self.isAvPlaySessionActive(activeSessionId)) {
                    return;
                }
                self.clearPendingAvError();
                self.clearPendingAvComplete();
                debug.log("[player][avplay] buffering complete");
                var avState = self.getAvPlayState();
                if (avState === "PLAYING" || self.state === "playing") {
                    self.setState("playing");
                    return;
                }
                if (self.state === "paused") {
                    return;
                }
                self.setState("ready");
            },
            onstreamcompleted: function () {
                if (!self.isAvPlaySessionActive(activeSessionId)) {
                    return;
                }
                self.handleAvPlayStreamCompleted(activeSessionId);
            },
            oncurrentplaytime: function (timeMs) {
                if (!self.isAvPlaySessionActive(activeSessionId)) {
                    return;
                }
                self.currentTimeMs = Number(timeMs) || 0;
                self.clearPendingAvError();
                if (!debug.verbose) {
                    return;
                }
                var sec = Math.floor((Number(timeMs) || 0) / 1000);
                if (sec < 0) {
                    sec = 0;
                }
                if (self.lastPlaytimeLogSec >= 0 && sec - self.lastPlaytimeLogSec < 10) {
                    return;
                }
                self.lastPlaytimeLogSec = sec;
                debug.log("[player][avplay] current playtime (s)", sec);
            },
            onevent: function (eventType, eventData) {
                if (!self.isAvPlaySessionActive(activeSessionId)) {
                    return;
                }
                if (!debug.verbose) {
                    return;
                }
                debug.log("[player][avplay] event", String(eventType), safeStringify(eventData));
            },
            onerror: function (error) {
                if (!self.isAvPlaySessionActive(activeSessionId)) {
                    return;
                }
                self.handleAvPlayListenerError(error, activeSessionId);
            }
        });
    };

    PlayerService.prototype.setState = function (nextState) {
        if (this.state !== nextState) {
            debug.log("[player] state", this.state, "->", nextState);
        }
        this.state = nextState;
        this.onStateChange(nextState);
    };

    PlayerService.prototype.getAvPlayState = function () {
        if (!this.useAvPlay || !this.avplay || !this.avplay.getState) {
            return "";
        }
        try {
            return this.avplay.getState();
        } catch (error) {
            return "";
        }
    };

    PlayerService.prototype.open = function (url) {
        this.currentUrl = url;
        debug.log("[player] open", url);
        if (this.useAvPlay) {
            return this.openWithAvPlay(url);
        }
        return this.openWithHtmlVideo(url);
    };

    PlayerService.prototype.openWithHtmlVideo = function (url) {
        this.videoElement.src = url;
        this.videoElement.preload = "auto";
        this.videoElement.load();
        this.setState("loading");
        return Promise.resolve();
    };

    PlayerService.prototype.openWithAvPlay = function (url) {
        var self = this;
        return new Promise(function (resolve, reject) {
            if (!self.avplay) {
                reject(new Error("AVPlay unavailable"));
                return;
            }

            try {
                var sessionId = self.beginAvPlaySession();
                self.configureAvPlayListeners(sessionId);
                self.resetAvPlay();
                self.avplay.open(url);
                debug.log("[player][avplay] open success, state", self.getAvPlayState());
                self.setAvPlayDisplayRect();
                self.setAvPlayDisplayMethod();
                self.configureAvPlayStreamingProperties();
                self.setState("loading");
                resolve();
            } catch (error) {
                debug.error("[player][avplay] open failed", getErrorMessage(error));
                reject(error);
            }
        });
    };

    PlayerService.prototype.setAvPlayDisplayRect = function () {
        if (!this.avplay || !this.avplay.setDisplayRect) {
            return;
        }
        var dpr = Math.max(1, Number(global.devicePixelRatio) || 1);
        var panelWidth = global.screen && global.screen.width ? Number(global.screen.width) : 0;
        var panelHeight = global.screen && global.screen.height ? Number(global.screen.height) : 0;
        var innerWidthPx = Math.floor((global.innerWidth || 1920) * dpr);
        var innerHeightPx = Math.floor((global.innerHeight || 1080) * dpr);
        var width = Math.max(1, panelWidth || innerWidthPx || 1920);
        var height = Math.max(1, panelHeight || innerHeightPx || 1080);
        try {
            this.avplay.setDisplayRect(0, 0, width, height);
            debug.log("[player][avplay] display rect", width, height);
        } catch (error) {
            debug.warn("[player][avplay] setDisplayRect failed", error.message || error);
        }
    };

    PlayerService.prototype.setAvPlayDisplayMethod = function () {
        if (!this.avplay || !this.avplay.setDisplayMethod) {
            return;
        }
        try {
            this.avplay.setDisplayMethod("PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO");
            debug.log("[player][avplay] display mode AUTO_ASPECT_RATIO");
        } catch (primaryError) {
            try {
                this.avplay.setDisplayMethod("PLAYER_DISPLAY_MODE_FULL_SCREEN");
                debug.log("[player][avplay] display mode FULL_SCREEN");
            } catch (fallbackError) {
                debug.warn("[player][avplay] setDisplayMethod failed", (fallbackError && fallbackError.message) || fallbackError || primaryError);
            }
        }
    };

    PlayerService.prototype.configureAvPlayStreamingProperties = function () {
        if (!this.avplay || !this.avplay.setStreamingProperty) {
            return;
        }
        try {
            var userAgent = (global.navigator && global.navigator.userAgent) ? String(global.navigator.userAgent) : "";
            if (userAgent) {
                this.avplay.setStreamingProperty("USER_AGENT", userAgent);
                if (debug.verbose) {
                    debug.log("[player][avplay] USER_AGENT applied");
                }
            }
        } catch (error) {
            debug.warn("[player][avplay] set USER_AGENT failed", error.message || error);
        }
        try {
            if (this.currentUrl && this.currentUrl.indexOf(".m3u8") !== -1) {
                this.avplay.setStreamingProperty("ADAPTIVE_INFO", "STARTBITRATE=HIGHEST|SKIPBITRATE=LOWEST");
                if (debug.verbose) {
                    debug.log("[player][avplay] ADAPTIVE_INFO applied for HLS");
                }
            }
        } catch (error) {
            debug.warn("[player][avplay] set ADAPTIVE_INFO failed", error.message || error);
        }
    };

    PlayerService.prototype.resetAvPlay = function () {
        if (!this.avplay) {
            return;
        }
        try {
            var state = this.getAvPlayState();
            if (state === "PLAYING" || state === "PAUSED") {
                this.avplay.stop();
            }
            if (state !== "NONE") {
                this.avplay.close();
            }
        } catch (error) {
            debug.warn("[player][avplay] reset warning", error.message || error);
        }
    };

    PlayerService.prototype.prepare = function () {
        if (this.useAvPlay) {
            return this.prepareWithAvPlay();
        }
        return this.prepareWithHtmlVideo();
    };

    PlayerService.prototype.prepareWithHtmlVideo = function () {
        var self = this;
        return new Promise(function (resolve, reject) {
            if (self.videoElement.readyState >= 2) {
                resolve();
                return;
            }

            var timerId = setTimeout(function () {
                cleanup();
                reject(new Error("Player preparation timeout"));
            }, 15000);

            function onReady() {
                cleanup();
                resolve();
            }

            function onError() {
                cleanup();
                reject(new Error("Player failed to prepare"));
            }

            function cleanup() {
                clearTimeout(timerId);
                self.videoElement.removeEventListener("loadedmetadata", onReady);
                self.videoElement.removeEventListener("canplay", onReady);
                self.videoElement.removeEventListener("error", onError);
            }

            self.videoElement.addEventListener("loadedmetadata", onReady);
            self.videoElement.addEventListener("canplay", onReady);
            self.videoElement.addEventListener("error", onError);
        });
    };

    PlayerService.prototype.prepareWithAvPlay = function () {
        var self = this;
        return new Promise(function (resolve, reject) {
            if (!self.avplay) {
                reject(new Error("AVPlay unavailable"));
                return;
            }

            var state = self.getAvPlayState();
            debug.log("[player][avplay] prepare start, state", state, "url", self.currentUrl);
            if (state === "READY" || state === "PLAYING" || state === "PAUSED") {
                debug.log("[player][avplay] prepare skipped due state", state);
                resolve();
                return;
            }

            var done = false;
            var timerId = setTimeout(function () {
                if (done) {
                    return;
                }
                done = true;
                reject(new Error("Player preparation timeout"));
            }, 15000);

            function onSuccess() {
                if (done) {
                    return;
                }
                clearTimeout(timerId);
                self.setAvPlayDisplayRect();
                var trackInfo = self.inspectAvTracks();
                if (trackInfo && trackInfo.totalTracks > 0 && trackInfo.videoTrackIndex < 0 && trackInfo.audioTrackIndex >= 0) {
                    done = true;
                    debug.warn("[player][avplay] audio-only candidate detected, rejecting");
                    reject(new Error("AVPlay prepared audio-only candidate (no video track)"));
                    return;
                }
                done = true;
                self.refreshDurationMs();
                self.setState("ready");
                resolve();
            }

            function onError(error) {
                if (done) {
                    return;
                }
                done = true;
                clearTimeout(timerId);
                debug.error("[player][avplay] prepare error", String(error));
                reject(new Error("AVPlay prepare failed: " + String(error)));
            }

            try {
                if (self.avplay.setTimeoutForBuffering) {
                    self.avplay.setTimeoutForBuffering(15);
                    debug.log("[player][avplay] buffering timeout set to 15s");
                }
                self.configureAvPlayStreamingProperties();
                if (self.avplay.prepareAsync) {
                    debug.log("[player][avplay] prepareAsync invoked");
                    self.avplay.prepareAsync(onSuccess, onError);
                } else {
                    debug.log("[player][avplay] prepare sync invoked");
                    self.avplay.prepare();
                    onSuccess();
                }
            } catch (error) {
                onError(error);
            }
        });
    };

    PlayerService.prototype.play = function () {
        if (this.useAvPlay) {
            return this.playWithAvPlay();
        }
        var playResult = this.videoElement.play();
        if (playResult && typeof playResult.then === "function") {
            return playResult;
        }
        return Promise.resolve();
    };

    PlayerService.prototype.playWithAvPlay = function () {
        var state = this.getAvPlayState();
        debug.log("[player][avplay] play requested at state", state);
        if (state === "PLAYING") {
            if (!this.lastAvPlayStartAtMs) {
                this.lastAvPlayStartAtMs = Date.now();
            }
            this.clearPendingAvError();
            this.clearPendingAvComplete();
            this.setState("playing");
            return Promise.resolve();
        }

        if (state === "READY" || state === "PAUSED") {
            this.avplay.play();
            debug.log("[player][avplay] play invoked");
            this.lastAvPlayStartAtMs = Date.now();
            this.clearPendingAvError();
            this.clearPendingAvComplete();
            this.setAvPlayDisplayRect();
            this.refreshDurationMs();
            this.setState("playing");
            var self = this;
            setTimeout(function () {
                self.setAvPlayDisplayRect();
            }, 250);
            return this.validateAvVideoPresence();
        }

        return Promise.reject(new Error("Cannot play from state " + state));
    };

    PlayerService.prototype.inspectAvTracks = function () {
        if (!this.avplay || !this.avplay.getTotalTrackInfo) {
            return null;
        }
        try {
            var tracks = this.avplay.getTotalTrackInfo();
            if (!tracks || !tracks.length) {
                return {
                    totalTracks: 0,
                    videoTrackIndex: -1,
                    audioTrackIndex: -1
                };
            }

            var videoTrackIndex = -1;
            var audioTrackIndex = -1;
            for (var i = 0; i < tracks.length; i += 1) {
                var track = tracks[i];
                var type = String(track.type || track.trackType || "").toUpperCase();
                var index = typeof track.index === "number" ? track.index : i;
                if (type === "VIDEO" && videoTrackIndex < 0) {
                    videoTrackIndex = index;
                }
                if (type === "AUDIO" && audioTrackIndex < 0) {
                    audioTrackIndex = index;
                }
            }

            debug.log("[player][avplay] tracks", "video=", videoTrackIndex, "audio=", audioTrackIndex, "total=", tracks.length);
            return {
                totalTracks: tracks.length,
                videoTrackIndex: videoTrackIndex,
                audioTrackIndex: audioTrackIndex
            };
        } catch (error) {
            debug.warn("[player][avplay] track inspect failed", error.message || error);
            return null;
        }
    };

    PlayerService.prototype.selectDefaultAvTracks = function (trackInfo) {
        if (!this.avplay || !this.avplay.setSelectTrack) {
            return;
        }
        var info = trackInfo || this.inspectAvTracks();
        if (!info) {
            return;
        }
        try {
            if (info.videoTrackIndex >= 0) {
                this.avplay.setSelectTrack("VIDEO", info.videoTrackIndex);
                debug.log("[player][avplay] selected VIDEO track", info.videoTrackIndex);
            }
            if (info.audioTrackIndex >= 0) {
                this.avplay.setSelectTrack("AUDIO", info.audioTrackIndex);
                debug.log("[player][avplay] selected AUDIO track", info.audioTrackIndex);
            }
        } catch (error) {
            debug.warn("[player][avplay] track selection failed", error.message || error);
        }
    };

    PlayerService.prototype.inspectCurrentStreamInfo = function () {
        if (!this.avplay || !this.avplay.getCurrentStreamInfo) {
            return null;
        }
        try {
            var info = this.avplay.getCurrentStreamInfo();
            debug.log("[player][avplay] currentStreamInfo", safeStringify(info));
            return info;
        } catch (error) {
            debug.warn("[player][avplay] currentStreamInfo failed", error.message || error);
            return null;
        }
    };

    PlayerService.prototype.validateAvVideoPresence = function () {
        var self = this;
        return new Promise(function (resolve, reject) {
            setTimeout(function () {
                var trackInfo = self.inspectAvTracks();
                var streamInfo = self.inspectCurrentStreamInfo();
                var hasVideoStream = detectVideoInCurrentStreamInfo(streamInfo);
                if (trackInfo && trackInfo.totalTracks > 0 && trackInfo.videoTrackIndex < 0 && trackInfo.audioTrackIndex >= 0) {
                    reject(new Error("AVPlay audio-only playback (no video track)"));
                    return;
                }
                if (hasVideoStream === false && trackInfo && trackInfo.audioTrackIndex >= 0) {
                    reject(new Error("AVPlay stream info reports no video track"));
                    return;
                }
                resolve();
            }, 400);
        });
    };

    PlayerService.prototype.pause = function () {
        if (this.useAvPlay) {
            var state = this.getAvPlayState();
            if (state === "PLAYING") {
                this.avplay.pause();
                debug.log("[player][avplay] pause invoked");
                this.setState("paused");
            }
            return;
        }
        this.videoElement.pause();
    };

    PlayerService.prototype.stop = function () {
        debug.log("[player] stop requested");
        this.currentTimeMs = 0;
        this.durationMs = 0;
        this.lastAvPlayStartAtMs = 0;
        this.endAvPlaySession();
        if (this.useAvPlay) {
            this.resetAvPlay();
            this.setState("stopped");
            return;
        }
        this.pause();
        this.videoElement.removeAttribute("src");
        this.videoElement.load();
        this.setState("stopped");
    };

    PlayerService.prototype.seek = function (ms) {
        var currentMs = this.getCurrentTimeMs();
        var targetMs = (Number(currentMs) || 0) + (Number(ms) || 0);
        this.seekTo(targetMs);
    };

    PlayerService.prototype.normalizeSeekTargetMs = function (targetMs) {
        var nextTargetMs = Number(targetMs) || 0;
        if (nextTargetMs < 0) {
            nextTargetMs = 0;
        }
        var durationMs = this.getDurationMs();
        if (durationMs > 0 && isFinite(durationMs) && nextTargetMs > durationMs) {
            nextTargetMs = durationMs;
        }
        return nextTargetMs;
    };

    PlayerService.prototype.markAvPlaySeekingWindow = function (windowMs) {
        var now = Date.now();
        var durationMs = Number(windowMs) || 0;
        if (durationMs < 0) {
            durationMs = 0;
        }
        this.avplaySeekingUntilMs = Math.max(Number(this.avplaySeekingUntilMs) || 0, now + durationMs);
    };

    PlayerService.prototype.isAvPlaySeeking = function () {
        return Date.now() < (Number(this.avplaySeekingUntilMs) || 0);
    };

    PlayerService.prototype.seekToAsync = function (targetMs) {
        var self = this;
        var nextTargetMs = this.normalizeSeekTargetMs(targetMs);

        if (this.useAvPlay) {
            var avState = this.getAvPlayState();
            if (avState !== "PLAYING" && avState !== "PAUSED" && avState !== "READY") {
                return Promise.resolve(nextTargetMs);
            }
            debug.log("[player][avplay] seekTo", "targetMs", nextTargetMs, "state", avState);
            this.markAvPlaySeekingWindow(2400);

            return new Promise(function (resolve, reject) {
                var done = false;
                var callbackSupported = false;
                var fallbackTimer = null;

                function finish(error) {
                    if (done) {
                        return;
                    }
                    done = true;
                    if (fallbackTimer) {
                        clearTimeout(fallbackTimer);
                        fallbackTimer = null;
                    }
                    if (error) {
                        self.markAvPlaySeekingWindow(600);
                        reject(error);
                        return;
                    }
                    self.currentTimeMs = nextTargetMs;
                    self.markAvPlaySeekingWindow(700);
                    resolve(nextTargetMs);
                }

                try {
                    if (typeof self.avplay.seekTo !== "function") {
                        finish(new Error("AVPlay seekTo unavailable"));
                        return;
                    }
                    if (self.avplay.seekTo.length >= 2) {
                        callbackSupported = true;
                        self.avplay.seekTo(nextTargetMs, function () {
                            finish();
                        }, function (error) {
                            finish(new Error("AVPlay seekTo failed: " + String(error || "unknown")));
                        });
                    } else {
                        self.avplay.seekTo(nextTargetMs);
                    }
                } catch (error) {
                    finish(error);
                    return;
                }

                fallbackTimer = setTimeout(function () {
                    finish();
                }, callbackSupported ? 1400 : 350);
            });
        }

        var seconds = nextTargetMs / 1000;
        this.videoElement.currentTime = seconds;
        this.currentTimeMs = nextTargetMs;
        return Promise.resolve(nextTargetMs);
    };

    PlayerService.prototype.seekTo = function (targetMs) {
        this.seekToAsync(targetMs).catch(function (error) {
            debug.warn("[player] seekTo failed", getErrorMessage(error));
        });
    };

    PlayerService.prototype.setSpeed = function (rate) {
        if (this.useAvPlay) {
            if (this.avplay && this.avplay.setSpeed) {
                this.avplay.setSpeed(rate);
            }
            return;
        }
        this.videoElement.playbackRate = rate;
    };

    PlayerService.prototype.isNativePlayer = function () {
        return this.useAvPlay;
    };

    PlayerService.prototype.getState = function () {
        return this.state;
    };

    PlayerService.prototype.refreshDurationMs = function () {
        if (this.useAvPlay && this.avplay && this.avplay.getDuration) {
            try {
                var nextDuration = Number(this.avplay.getDuration()) || 0;
                if (nextDuration > 0) {
                    this.durationMs = nextDuration;
                }
            } catch (error) {}
            return this.durationMs;
        }
        var htmlDuration = Number(this.videoElement.duration) || 0;
        if (isFinite(htmlDuration) && htmlDuration > 0) {
            this.durationMs = Math.floor(htmlDuration * 1000);
        }
        return this.durationMs;
    };

    PlayerService.prototype.getCurrentTimeMs = function () {
        if (this.useAvPlay && this.avplay && this.avplay.getCurrentTime) {
            try {
                this.currentTimeMs = Number(this.avplay.getCurrentTime()) || 0;
            } catch (error) {}
            return this.currentTimeMs;
        }
        var htmlCurrent = Number(this.videoElement.currentTime) || 0;
        if (isFinite(htmlCurrent) && htmlCurrent > 0) {
            this.currentTimeMs = Math.floor(htmlCurrent * 1000);
        }
        return this.currentTimeMs;
    };

    PlayerService.prototype.getDurationMs = function () {
        return this.refreshDurationMs();
    };

    PlayerService.prototype.beginAvPlaySession = function () {
        this.avplaySessionId += 1;
        this.clearPendingAvError();
        this.clearPendingAvComplete();
        return this.avplaySessionId;
    };

    PlayerService.prototype.endAvPlaySession = function () {
        this.avplaySessionId += 1;
        this.clearPendingAvError();
        this.clearPendingAvComplete();
    };

    PlayerService.prototype.isAvPlaySessionActive = function (sessionId) {
        return Number(sessionId) === Number(this.avplaySessionId);
    };

    PlayerService.prototype.clearPendingAvError = function () {
        if (this.pendingAvErrorTimer) {
            clearTimeout(this.pendingAvErrorTimer);
            this.pendingAvErrorTimer = null;
        }
        this.pendingAvError = null;
    };

    PlayerService.prototype.clearPendingAvComplete = function () {
        if (this.pendingAvCompleteTimer) {
            clearTimeout(this.pendingAvCompleteTimer);
            this.pendingAvCompleteTimer = null;
        }
        this.pendingAvComplete = null;
    };

    PlayerService.prototype.handleAvPlayListenerError = function (error, sessionId) {
        if (this.isAvPlaySeeking()) {
            if (debug.verbose) {
                debug.warn("[player][avplay] listener error ignored during seek", String(error || "unknown"));
            }
            return;
        }
        var self = this;
        var message = String(error || "unknown");
        var baselineState = this.getAvPlayState();
        var baselineTimeMs = this.getCurrentTimeMs();

        debug.warn("[player][avplay] listener error received", message, "state", baselineState, "timeMs", baselineTimeMs);
        this.clearPendingAvError();
        this.pendingAvError = {
            sessionId: sessionId,
            message: message,
            baselineState: baselineState,
            baselineTimeMs: baselineTimeMs
        };

        this.pendingAvErrorTimer = setTimeout(function () {
            var info = self.pendingAvError;
            self.pendingAvErrorTimer = null;
            self.pendingAvError = null;
            if (!info) {
                return;
            }
            if (!self.isAvPlaySessionActive(info.sessionId)) {
                return;
            }
            if (self.state === "stopped") {
                return;
            }

            var avState = self.getAvPlayState();
            var currentTimeMs = self.getCurrentTimeMs();
            var progressed = currentTimeMs > info.baselineTimeMs + 750;
            var recovered = avState === "PLAYING" || avState === "PAUSED" || avState === "READY";
            if (progressed || recovered) {
                debug.warn("[player][avplay] listener error ignored (playback recovered)", info.message, "state", avState, "timeMs", currentTimeMs);
                return;
            }

            debug.error("[player][avplay] listener error promoted", info.message, "state", avState, "timeMs", currentTimeMs);
            self.setState("error");
            self.onStateChange("error: " + info.message);
        }, 1400);
    };

    PlayerService.prototype.handleAvPlayStreamCompleted = function (sessionId) {
        if (this.isAvPlaySeeking()) {
            if (debug.verbose) {
                debug.warn("[player][avplay] stream completed ignored during seek");
            }
            return;
        }
        var self = this;
        var baselineTimeMs = this.getCurrentTimeMs();
        var baselineDurationMs = this.getDurationMs();
        var baselineState = this.getAvPlayState();
        debug.log("[player][avplay] stream completed event", "state", baselineState, "timeMs", baselineTimeMs, "durationMs", baselineDurationMs);

        this.clearPendingAvComplete();
        this.pendingAvComplete = {
            sessionId: sessionId,
            baselineTimeMs: baselineTimeMs
        };

        this.pendingAvCompleteTimer = setTimeout(function () {
            var info = self.pendingAvComplete;
            self.pendingAvCompleteTimer = null;
            self.pendingAvComplete = null;
            if (!info) {
                return;
            }
            if (!self.isAvPlaySessionActive(info.sessionId)) {
                return;
            }
            if (self.state === "stopped") {
                return;
            }

            var avState = self.getAvPlayState();
            var currentTimeMs = self.getCurrentTimeMs();
            var durationMs = self.getDurationMs();
            var hasKnownDuration = durationMs > 0 && isFinite(durationMs);
            var nearEnd = durationMs > 0 && currentTimeMs >= Math.max(0, durationMs - 2500);
            var playAgeMs = self.lastAvPlayStartAtMs ? (Date.now() - self.lastAvPlayStartAtMs) : 0;
            var looksTooEarlyToEnd = playAgeMs > 0 && (playAgeMs < 12000 || currentTimeMs < 5000);
            var stillPlaying = avState === "PLAYING";
            var progressed = currentTimeMs > info.baselineTimeMs + 800;

            if (!nearEnd) {
                if (!hasKnownDuration) {
                    debug.warn("[player][avplay] ignoring stream completed without known duration", "state", avState, "timeMs", currentTimeMs);
                    return;
                }
                if (looksTooEarlyToEnd) {
                    debug.warn("[player][avplay] ignoring early stream completed", "ageMs", playAgeMs, "timeMs", currentTimeMs, "durationMs", durationMs);
                    return;
                }
            }
            if ((stillPlaying && !nearEnd) || (!nearEnd && progressed)) {
                debug.warn("[player][avplay] ignoring premature stream completed", "state", avState, "timeMs", currentTimeMs, "durationMs", durationMs);
                return;
            }

            self.currentTimeMs = durationMs > 0 ? durationMs : currentTimeMs;
            self.setState("ended");
        }, 500);
    };

    Odysee.PlayerService = PlayerService;

    function getErrorMessage(error) {
        if (!error) {
            return "unknown";
        }
        if (error.message) {
            return error.message;
        }
        return String(error);
    }

    function safeStringify(value) {
        try {
            return JSON.stringify(value);
        } catch (error) {
            return String(value);
        }
    }

    function detectVideoInCurrentStreamInfo(streamInfo) {
        if (!streamInfo || !Array.isArray(streamInfo)) {
            return null;
        }
        var hasVideo = false;
        var hasAudio = false;
        for (var i = 0; i < streamInfo.length; i += 1) {
            var item = streamInfo[i] || {};
            var type = String(item.type || item.trackType || "").toUpperCase();
            if (type === "VIDEO") {
                hasVideo = true;
            }
            if (type === "AUDIO") {
                hasAudio = true;
            }
        }
        if (!hasVideo && hasAudio) {
            return false;
        }
        if (hasVideo) {
            return true;
        }
        return null;
    }
})(window);
