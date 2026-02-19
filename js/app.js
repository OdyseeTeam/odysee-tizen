(function (global) {
    var Odysee = global.Odysee || (global.Odysee = {});
    var KEY = Odysee.keys;
    var debug = Odysee.debug || { enabled: false, verbose: false, log: function () {}, warn: function () {}, error: function () {} };

    function App() {
        this.config = Odysee.constants.getDefaultConfig();
        this.baseCategories = [];
        this.categories = [];
        this.videos = [];
        this.feedRequestId = 0;
        this.focus = new Odysee.FocusManager();
        this.playerOpen = false;
        this.activeVideo = null;
        this.pendingViewLog = null;
        this.playerFocusTarget = "controls";
        this.playerReaction = "";
        this.playerReactionBusy = false;
        this.playerReactionClaimId = "";
        this.playerReactionRequestId = 0;
        this.playerChannelFollowRequestId = 0;
        this.playerChannelFollowClaimId = "";
        this.playerChannelFollowKnown = false;
        this.playerChannelFollowing = false;
        this.playerChannelFollowBusy = false;
        this.playerUiVisible = true;
        this.playerUiHideTimer = null;
        this.playerTickTimer = null;
        this.scrubHoldState = {
            code: null,
            startedAt: 0,
            lastAt: 0
        };
        this.scrubPreviewActive = false;
        this.scrubPreviewMs = 0;
        this.scrubPreviewResumePlayback = false;
        this.scrubCommitPending = false;
        this.scrubCommitRequestId = 0;
        this.searchOpen = false;
        this.searchDialogFocus = 0;
        this.authOpen = false;
        this.authDialogFocus = 0;
        this.backPressAt = 0;
        this.lastSearchQuery = "";
        this.currentSearchQuery = "";
        this.authUser = null;
        this.authStage = "collect";
        this.authPendingEmail = "";
        this.authBusy = false;
        this.authPollTimer = null;
        this.authChannels = [];
        this.authChannelIndex = 0;
        this.authChannelLoading = false;
        this.ownedChannelIds = {};
        this.ownedChannelsLoaded = false;
        this.ownedChannelsLoading = false;
        this.ownedChannelsRequestId = 0;
        this.watchLaterAvailable = false;
        this.watchLaterRequestId = 0;
        this.channelContext = null;
        this.channelFollowRequestId = 0;
        this.activeDynamicCategory = null;
        this.categoryChangeTimer = null;
        this.selectedCategoryId = "";
        this.categoryCache = {};
        this.inFlightCategoryRequests = {};
        this.categoryCacheTtlMs = 5 * 60 * 1000;
        this.categoryPageSize = 36;
        this.activeCategoryPage = 1;
        this.activeCategoryHasMore = true;
        this.activeCategoryLoadingMore = false;
        this.activeGridCategoryId = "";
        this.playbackCandidateStorageKey = "odysee_tizen_candidate_scores_v2";
        this.playbackCandidateScores = this.loadPlaybackCandidateScores();
        this.playbackAttemptTimeoutMs = 4500;
        this.playbackAttemptSlowTimeoutMs = 7000;
        this.maxNativeCandidates = 3;

        this.nodes = {
            statusText: document.getElementById("statusText"),
            searchButton: document.getElementById("searchButton"),
            signInButton: document.getElementById("signInButton"),
            followChannelButton: document.getElementById("followChannelButton"),
            accountBadge: document.getElementById("accountBadge"),
            accountAvatar: document.getElementById("accountAvatar"),
            accountInitial: document.getElementById("accountInitial"),
            pageTitle: document.getElementById("pageTitle"),
            categoryList: document.getElementById("categoryList"),
            contentTitle: document.getElementById("contentTitle"),
            contentMeta: document.getElementById("contentMeta"),
            videoGrid: document.getElementById("videoGrid"),
            emptyState: document.getElementById("emptyState"),
            playerLayer: document.getElementById("playerLayer"),
            playerChannelButton: document.getElementById("playerChannelButton"),
            playerChannelAvatar: document.getElementById("playerChannelAvatar"),
            playerChannelInitial: document.getElementById("playerChannelInitial"),
            playerChannelName: document.getElementById("playerChannelName"),
            playerReactionActions: document.getElementById("playerReactionActions"),
            playerFollowButton: document.getElementById("playerFollowButton"),
            playerFireButton: document.getElementById("playerFireButton"),
            playerSlimeButton: document.getElementById("playerSlimeButton"),
            playerTitle: document.getElementById("playerTitle"),
            playerMeta: document.getElementById("playerMeta"),
            playerTransportState: document.getElementById("playerTransportState"),
            playerTransportPlay: document.getElementById("playerTransportPlay"),
            playerTransportPause: document.getElementById("playerTransportPause"),
            playerLoadingSpinner: document.getElementById("playerLoadingSpinner"),
            playerControls: document.getElementById("playerControls"),
            playerProgressFill: document.getElementById("playerProgressFill"),
            playerProgressThumb: document.getElementById("playerProgressThumb"),
            playerTime: document.getElementById("playerTime"),
            videoElement: document.getElementById("videoElement"),
            toast: document.getElementById("toast"),
            searchModal: document.getElementById("searchModal"),
            searchInput: document.getElementById("searchInput"),
            searchSubmit: document.getElementById("searchSubmit"),
            searchCancel: document.getElementById("searchCancel"),
            authModal: document.getElementById("authModal"),
            authTitle: document.getElementById("authTitle"),
            authMessage: document.getElementById("authMessage"),
            authPendingStatus: document.getElementById("authPendingStatus"),
            authEmailInput: document.getElementById("authEmailInput"),
            authChannelList: document.getElementById("authChannelList"),
            authPrimary: document.getElementById("authPrimary"),
            authCancel: document.getElementById("authCancel"),
            authSignOut: document.getElementById("authSignOut")
        };

        var self = this;
        this.player = new Odysee.PlayerService(this.nodes.videoElement, function (state) {
            self.onPlayerStateChanged(state);
        });
        this.playerEngine = this.player.isNativePlayer && this.player.isNativePlayer() ? "AVPlay" : "HTML5";
        if (this.player.isNativePlayer && this.player.isNativePlayer()) {
            this.nodes.playerLayer.classList.add("native-player-layer");
        }
    }

    function normalizeClaimId(value) {
        var text = String(value || "").trim().toLowerCase();
        if (!/^[a-f0-9]{40}$/.test(text)) {
            return "";
        }
        return text;
    }

    App.prototype.start = function () {
        debug.log("[app] start");
        this.bindEvents();
        Odysee.platform.initRemoteKeys();
        return this.bootstrapData();
    };

    App.prototype.bindEvents = function () {
        var self = this;
        document.addEventListener("keydown", function (event) {
            self.handleKey(event);
        });
        document.addEventListener("keyup", function (event) {
            self.handleKeyUp(event);
        });

        document.addEventListener("visibilitychange", function () {
            if (document.hidden && self.playerOpen) {
                self.player.pause();
            }
        });

        if (this.nodes.searchButton) {
            this.nodes.searchButton.addEventListener("click", function () {
                self.openSearchDialog();
            });
        }
        if (this.nodes.signInButton) {
            this.nodes.signInButton.addEventListener("click", function () {
                self.openSignInDialog();
            });
        }
        if (this.nodes.followChannelButton) {
            this.nodes.followChannelButton.addEventListener("click", function () {
                self.handleChannelFollowAction();
            });
        }
        if (this.nodes.searchSubmit) {
            this.nodes.searchSubmit.addEventListener("click", function () {
                self.submitSearchDialog();
            });
        }
        if (this.nodes.searchCancel) {
            this.nodes.searchCancel.addEventListener("click", function () {
                self.closeSearchDialog();
            });
        }
        if (this.nodes.searchInput) {
            this.nodes.searchInput.addEventListener("keydown", function (event) {
                if (event.keyCode === KEY.ENTER) {
                    event.preventDefault();
                    event.stopPropagation();
                    self.submitSearchDialog();
                }
            });
        }
        if (this.nodes.authPrimary) {
            this.nodes.authPrimary.addEventListener("click", function () {
                self.handleAuthPrimaryAction();
            });
        }
        if (this.nodes.authCancel) {
            this.nodes.authCancel.addEventListener("click", function () {
                self.handleAuthCancelAction();
            });
        }
        if (this.nodes.authSignOut) {
            this.nodes.authSignOut.addEventListener("click", function () {
                self.signOutCurrentUser();
            });
        }
        if (this.nodes.authEmailInput) {
            this.nodes.authEmailInput.addEventListener("keydown", function (event) {
                if (event.keyCode === KEY.ENTER) {
                    event.preventDefault();
                    event.stopPropagation();
                    self.handleAuthPrimaryAction();
                }
            });
        }
        if (this.nodes.accountBadge) {
            this.nodes.accountBadge.addEventListener("click", function () {
                if (self.authUser) {
                    self.openSignedInDefaultChannel();
                    return;
                }
                self.openSignInDialog();
            });
        }
        if (this.nodes.accountAvatar) {
            this.nodes.accountAvatar.addEventListener("error", function () {
                self.showAccountInitialOnly();
            });
        }
        if (this.nodes.playerChannelButton) {
            this.nodes.playerChannelButton.addEventListener("click", function () {
                self.openActiveVideoChannelFromPlayer();
            });
        }
        if (this.nodes.playerFireButton) {
            this.nodes.playerFireButton.addEventListener("click", function () {
                self.handlePlayerReactionAction("fire");
            });
        }
        if (this.nodes.playerFollowButton) {
            this.nodes.playerFollowButton.addEventListener("click", function () {
                self.handlePlayerFollowAction();
            });
        }
        if (this.nodes.playerSlimeButton) {
            this.nodes.playerSlimeButton.addEventListener("click", function () {
                self.handlePlayerReactionAction("slime");
            });
        }
        if (this.nodes.playerChannelAvatar) {
            this.nodes.playerChannelAvatar.addEventListener("error", function () {
                self.showPlayerChannelInitialOnly();
            });
        }
    };

    App.prototype.bootstrapData = function () {
        var self = this;
        this.setStatus("Loading configuration...");
        debug.log("[app] bootstrap loading config");
        return Odysee.api.loadRuntimeConfig(this.config).then(function (config) {
            self.config = config;
            return Odysee.api.checkSignedInUser(self.config).then(function (user) {
                self.setAuthUser(user);
            }).catch(function (error) {
                debug.warn("[app] initial auth check failed", getErrorMessage(error));
                self.setAuthUser(null);
            }).then(function () {
                self.setStatus("Loading categories...");
                debug.log("[app] config ready, loading categories");
                return Odysee.api.loadCategories(self.config);
            });
        }).then(function (categories) {
            self.baseCategories = categories || [];
            self.rebuildCategories();
            debug.log("[app] categories loaded", self.categories.length);
        }).catch(function () {
            self.baseCategories = self.config.FALLBACK_CATEGORIES;
            self.rebuildCategories();
            self.showToast("Using offline category defaults.");
            debug.warn("[app] using fallback categories", self.categories.length);
        }).then(function () {
            self.renderCategories();
            self.focus.setZone("sidebar", 0);
            self.applyFocus();
            return self.loadCategory(self.focus.getIndex("sidebar")).then(function () {
                if (self.videos && self.videos.length > 0) {
                    return;
                }
                var fallbackIndex = self.findFallbackCategoryIndex();
                if (fallbackIndex > 0) {
                    self.showToast("Trying a fallback category...");
                    debug.warn("[app] initial category empty, trying fallback index", fallbackIndex);
                    return self.loadCategory(fallbackIndex);
                }
            });
        });
    };

    App.prototype.buildFollowingCategory = function () {
        return {
            id: "following",
            title: "Following",
            isFollowing: true,
            orderBy: ["release_time"]
        };
    };

    App.prototype.buildWatchLaterCategory = function () {
        return {
            id: "watchlater",
            title: "Watch Later",
            isWatchLater: true,
            orderBy: ["release_time"]
        };
    };

    App.prototype.getCategoryCacheKey = function (category, page) {
        var categoryId = category && category.id ? String(category.id) : "unknown";
        return categoryId + "::" + String(page || 1);
    };

    App.prototype.getCachedCategoryVideos = function (cacheKey) {
        var entry = this.categoryCache[cacheKey];
        if (!entry) {
            return null;
        }
        if ((Date.now() - entry.cachedAt) > this.categoryCacheTtlMs) {
            delete this.categoryCache[cacheKey];
            return null;
        }
        if (!Array.isArray(entry.videos)) {
            return null;
        }
        return entry.videos.slice(0);
    };

    App.prototype.setCachedCategoryVideos = function (cacheKey, videos) {
        this.categoryCache[cacheKey] = {
            cachedAt: Date.now(),
            videos: Array.isArray(videos) ? videos.slice(0) : []
        };
    };

    App.prototype.clearCategoryCache = function () {
        this.categoryCache = {};
        this.inFlightCategoryRequests = {};
    };

    App.prototype.rebuildCategories = function () {
        var categories = [];
        var i;
        if (this.authUser) {
            categories.push(this.buildFollowingCategory());
            if (this.watchLaterAvailable) {
                categories.push(this.buildWatchLaterCategory());
            }
        }
        for (i = 0; i < this.baseCategories.length; i += 1) {
            var baseCategory = this.baseCategories[i];
            var baseId = String(baseCategory && baseCategory.id ? baseCategory.id : "").toLowerCase();
            if (!baseCategory || baseId === "following" || baseId === "watchlater" || baseId === "watch-later") {
                continue;
            }
            categories.push(baseCategory);
        }
        this.categories = categories;
    };

    App.prototype.syncCategoriesForAuthChange = function () {
        if (!this.baseCategories.length) {
            return;
        }

        var previous = this.categories[this.focus.getIndex("sidebar")];
        var previousId = previous && previous.id ? String(previous.id) : "";
        this.rebuildCategories();

        var nextIndex = 0;
        if (previousId) {
            for (var i = 0; i < this.categories.length; i += 1) {
                if (String(this.categories[i].id) === previousId) {
                    nextIndex = i;
                    break;
                }
            }
        }
        this.focus.setIndex("sidebar", Math.max(0, Math.min(nextIndex, this.categories.length - 1)));
        this.renderCategories();
        this.applyFocus();

        var selected = this.categories[this.focus.getIndex("sidebar")];
        if (!this.currentSearchQuery && (!selected || String(selected.id) !== previousId)) {
            this.loadCategory(this.focus.getIndex("sidebar"));
        }
    };

    App.prototype.findFallbackCategoryIndex = function () {
        for (var i = 1; i < this.categories.length; i += 1) {
            var category = this.categories[i];
            if (!category) {
                continue;
            }
            var id = String(category.id || "").toLowerCase();
            if (id.indexOf("trend") !== -1 || id.indexOf("hot") !== -1 || id.indexOf("popular") !== -1) {
                return i;
            }
            if (Array.isArray(category.channelIds) && category.channelIds.length > 0) {
                return i;
            }
        }
        return -1;
    };

    App.prototype.loadCategory = function (index) {
        if (!this.categories.length) {
            return Promise.resolve();
        }
        var category = this.categories[index];
        if (!category) {
            return Promise.resolve();
        }
        this.channelContext = null;
        this.activeDynamicCategory = null;
        this.updateChannelFollowButton();
        this.currentSearchQuery = "";
        this.selectedCategoryId = String(category.id || "");
        this.activeCategoryPage = 1;
        this.activeCategoryHasMore = true;
        this.activeCategoryLoadingMore = false;
        this.focus.setIndex("grid", 0);
        if (this.categoryChangeTimer) {
            clearTimeout(this.categoryChangeTimer);
            this.categoryChangeTimer = null;
        }

        this.focus.setIndex("sidebar", index);
        debug.log("[app] load category", index, category.id, category.title);
        this.setStatus("Loading " + category.title + "...");
        this.setPageTitle(category.title, false);
        this.nodes.contentMeta.textContent = "";
        this.resetVideoGridScroll();
        this.renderCategories();
        var cacheKey = this.getCategoryCacheKey(category, 1);

        var requestId = this.feedRequestId + 1;
        this.feedRequestId = requestId;
        var cachedVideos = this.getCachedCategoryVideos(cacheKey);
        if (cachedVideos) {
            this.activeGridCategoryId = String(category.id || "");
            this.videos = cachedVideos;
            this.activeCategoryPage = 1;
            this.activeCategoryHasMore = cachedVideos.length >= this.categoryPageSize;
            this.renderVideos();
            this.setStatus("Ready");
            debug.log("[app] category videos cache hit", category.id, cachedVideos.length);
            return Promise.resolve(null);
        }

        var self = this;
        if (!this.inFlightCategoryRequests[cacheKey]) {
            this.inFlightCategoryRequests[cacheKey] = Odysee.api.loadCategoryVideos(this.config, category, 1).then(function (videos) {
                delete self.inFlightCategoryRequests[cacheKey];
                return videos;
            }).catch(function (error) {
                delete self.inFlightCategoryRequests[cacheKey];
                throw error;
            });
        }

        return this.inFlightCategoryRequests[cacheKey].then(function (videos) {
            if (requestId !== self.feedRequestId) {
                return null;
            }
            self.setCachedCategoryVideos(cacheKey, videos);
            self.activeGridCategoryId = String(category.id || "");
            self.videos = videos;
            self.activeCategoryPage = 1;
            self.activeCategoryHasMore = videos.length >= self.categoryPageSize;
            self.renderVideos();
            self.setStatus("Ready");
            debug.log("[app] category videos loaded", category.id, videos.length);
            if (!videos.length) {
                self.showToast("No items returned for this category.");
            }
            return null;
        }).catch(function (error) {
            if (requestId !== self.feedRequestId) {
                return;
            }
            debug.error("[app] feed load error", category && category.id, getErrorMessage(error));
            self.activeGridCategoryId = String(category && category.id || "");
            self.videos = [];
            self.activeCategoryHasMore = false;
            self.renderVideos();
            self.setStatus("Feed load failed: " + getErrorMessage(error));
            self.showToast("Feed load failed. Open logs/status.");
        });
    };

    App.prototype.getCategoryById = function (id) {
        var normalized = String(id || "");
        if (this.activeDynamicCategory && String(this.activeDynamicCategory.id || "") === normalized) {
            return this.activeDynamicCategory;
        }
        for (var i = 0; i < this.categories.length; i += 1) {
            if (String(this.categories[i] && this.categories[i].id || "") === normalized) {
                return this.categories[i];
            }
        }
        return null;
    };

    App.prototype.appendUniqueVideos = function (incomingVideos) {
        var existing = Array.isArray(this.videos) ? this.videos : [];
        var incoming = Array.isArray(incomingVideos) ? incomingVideos : [];
        if (!incoming.length) {
            return existing.slice(0);
        }
        var seen = {};
        var out = [];
        var i;
        for (i = 0; i < existing.length; i += 1) {
            var existingVideo = existing[i];
            var existingKey = String(
                (existingVideo && existingVideo.claimId) ||
                (existingVideo && existingVideo.canonicalUrl) ||
                ""
            );
            if (existingKey) {
                seen[existingKey] = true;
            }
            out.push(existingVideo);
        }
        for (i = 0; i < incoming.length; i += 1) {
            var incomingVideo = incoming[i];
            var incomingKey = String(
                (incomingVideo && incomingVideo.claimId) ||
                (incomingVideo && incomingVideo.canonicalUrl) ||
                ""
            );
            if (incomingKey && seen[incomingKey]) {
                continue;
            }
            if (incomingKey) {
                seen[incomingKey] = true;
            }
            out.push(incomingVideo);
        }
        return out;
    };

    App.prototype.loadNextPageForCurrentCategory = function () {
        var self = this;
        if (this.currentSearchQuery) {
            return Promise.resolve(false);
        }
        if (!this.selectedCategoryId || this.activeCategoryLoadingMore || !this.activeCategoryHasMore) {
            return Promise.resolve(false);
        }
        var selectedCategoryId = String(this.selectedCategoryId || "");
        var category = this.getCategoryById(selectedCategoryId);
        if (!category) {
            return Promise.resolve(false);
        }

        var nextPage = this.activeCategoryPage + 1;
        var cacheKey = this.getCategoryCacheKey(category, nextPage);
        this.activeCategoryLoadingMore = true;

        function finish() {
            self.activeCategoryLoadingMore = false;
        }

        function applyPage(videos) {
            if (String(self.selectedCategoryId || "") !== selectedCategoryId || self.currentSearchQuery) {
                return false;
            }
            self.activeCategoryPage = nextPage;
            self.activeCategoryHasMore = videos.length >= self.categoryPageSize;
            if (videos.length) {
                self.videos = self.appendUniqueVideos(videos);
                self.renderVideos();
            }
            self.setStatus("Ready");
            return videos.length > 0;
        }

        var cachedVideos = this.getCachedCategoryVideos(cacheKey);
        if (cachedVideos) {
            var hadCached = applyPage(cachedVideos);
            finish();
            return Promise.resolve(hadCached);
        }

        if (!this.inFlightCategoryRequests[cacheKey]) {
            this.inFlightCategoryRequests[cacheKey] = Odysee.api.loadCategoryVideos(this.config, category, nextPage).then(function (videos) {
                delete self.inFlightCategoryRequests[cacheKey];
                return videos;
            }).catch(function (error) {
                delete self.inFlightCategoryRequests[cacheKey];
                throw error;
            });
        }

        return this.inFlightCategoryRequests[cacheKey].then(function (videos) {
            var pageVideos = Array.isArray(videos) ? videos : [];
            self.setCachedCategoryVideos(cacheKey, pageVideos);
            return applyPage(pageVideos);
        }).catch(function (error) {
            debug.warn("[app] load more failed", selectedCategoryId, "page", nextPage, getErrorMessage(error));
            if (String(self.selectedCategoryId || "") === selectedCategoryId) {
                self.activeCategoryHasMore = false;
            }
            return false;
        }).then(function (value) {
            finish();
            return value;
        });
    };

    App.prototype.maybeLoadMoreForGridIndex = function (gridIndex) {
        if (this.currentSearchQuery || !this.activeCategoryHasMore || this.activeCategoryLoadingMore) {
            return;
        }
        var remaining = (this.videos.length - 1) - Number(gridIndex || 0);
        if (remaining > 8) {
            return;
        }
        this.loadNextPageForCurrentCategory();
    };

    App.prototype.renderCategories = function () {
        var html = [];
        for (var i = 0; i < this.categories.length; i += 1) {
            var item = this.categories[i];
            var active = i === this.focus.getIndex("sidebar") ? " active" : "";
            var iconSvg = getCategoryIconSvg(item && item.id, item && item.title);
            html.push(
                '<button class="category-item focusable' + active + '" data-zone="sidebar" data-index="' + i + '">' +
                '<span class="category-item-content">' +
                '<span class="category-icon" aria-hidden="true">' + iconSvg + "</span>" +
                '<span class="category-label">' + escapeHtml(item.title) + "</span>" +
                "</span>" +
                "</button>"
            );
        }
        this.nodes.categoryList.innerHTML = html.join("");
    };

    App.prototype.renderVideos = function () {
        if (this.currentSearchQuery) {
            this.setPageTitle('Search: "' + this.currentSearchQuery + '"', true);
        }
        if (!this.videos.length) {
            this.nodes.videoGrid.innerHTML = "";
            this.nodes.emptyState.classList.remove("hidden");
            this.nodes.contentMeta.textContent = "0 videos";
            return;
        }

        this.nodes.emptyState.classList.add("hidden");
        this.nodes.contentMeta.textContent = this.videos.length + " videos";
        var html = [];
        for (var i = 0; i < this.videos.length; i += 1) {
            var video = this.videos[i];
            var thumb = video.thumbnailUrl || "";
            var durationLabel = formatVideoCardDuration(video.durationSeconds);
            var durationHtml = durationLabel ? '<span class="video-duration-badge">' + escapeHtml(durationLabel) + "</span>" : "";
            var imgHtml = '<img alt="" />';
            if (thumb) {
                imgHtml = '<div class="video-thumb"><img loading="lazy" src="' + escapeAttr(thumb) + '" alt="Thumbnail" />' + durationHtml + "</div>";
            } else {
                imgHtml = '<div class="video-thumb"><img alt="" />' + durationHtml + "</div>";
            }

            html.push(
                '<button class="video-card focusable" data-zone="grid" data-index="' + i + '">' +
                imgHtml +
                '<p class="video-title">' + escapeHtml(video.title) + "</p>" +
                '<div class="video-meta-row">' +
                '<p class="video-subtitle">' + escapeHtml(video.channelName) + "</p>" +
                '<p class="video-age">' + escapeHtml(formatVideoCardAge(video.publishTime)) + "</p>" +
                "</div>" +
                "</button>"
            );
        }

        this.nodes.videoGrid.innerHTML = html.join("");
        var gridIndex = Math.min(this.focus.getIndex("grid"), this.videos.length - 1);
        this.focus.setIndex("grid", Math.max(0, gridIndex));
        this.applyFocus();
    };

    App.prototype.getVisibleTopActions = function () {
        var nodes = document.querySelectorAll(".top-action:not(.hidden)");
        return Array.prototype.slice.call(nodes || []);
    };

    App.prototype.getTopActionAt = function (index) {
        var actions = this.getVisibleTopActions();
        if (!actions.length) {
            return null;
        }
        var safeIndex = Math.max(0, Math.min(actions.length - 1, Number(index) || 0));
        return actions[safeIndex] || null;
    };

    App.prototype.applyFocus = function () {
        var focused = document.querySelectorAll(".is-focused");
        for (var i = 0; i < focused.length; i += 1) {
            focused[i].classList.remove("is-focused");
        }

        var zone = this.focus.getZone();
        var index = this.focus.getIndex(zone);
        var selector = ".video-card";
        if (zone === "sidebar") {
            selector = ".category-item";
        } else if (zone === "topbar") {
            selector = ".top-action:not(.hidden)";
        }
        var items = document.querySelectorAll(selector);
        if (!items.length) {
            return;
        }
        var safeIndex = Math.min(index, items.length - 1);
        this.focus.setIndex(zone, safeIndex);
        var node = items[safeIndex];
        node.classList.add("is-focused");
        if (zone === "grid") {
            this.ensureGridFocusVisibility(node);
        } else if (zone === "sidebar") {
            this.ensureSidebarFocusVisibility(node);
        } else {
            node.scrollIntoView({ block: "nearest", inline: "nearest" });
        }
    };

    App.prototype.ensureGridFocusVisibility = function (node) {
        if (!node || !this.nodes || !this.nodes.videoGrid) {
            return;
        }
        var container = this.nodes.videoGrid;
        var containerRect = container.getBoundingClientRect();
        var nodeRect = node.getBoundingClientRect();
        var topBuffer = 22;
        var bottomBuffer = 18;

        if (nodeRect.top < (containerRect.top + topBuffer)) {
            container.scrollTop -= (containerRect.top + topBuffer - nodeRect.top);
            return;
        }
        if (nodeRect.bottom > (containerRect.bottom - bottomBuffer)) {
            container.scrollTop += (nodeRect.bottom - (containerRect.bottom - bottomBuffer));
        }
    };

    App.prototype.snapSidebarScrollPosition = function () {
        if (!this.nodes || !this.nodes.categoryList) {
            return;
        }
        var container = this.nodes.categoryList;
        var firstItem = container.querySelector(".category-item");
        if (!firstItem) {
            return;
        }
        var itemStyle = window.getComputedStyle(firstItem);
        var rowStep = firstItem.offsetHeight + parseFloat(itemStyle.marginBottom || "0");
        if (!rowStep || !isFinite(rowStep)) {
            return;
        }

        var maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
        var snapped = Math.round(container.scrollTop / rowStep) * rowStep;
        if (snapped < 0) {
            snapped = 0;
        } else if (snapped > maxScroll) {
            snapped = maxScroll;
        }
        container.scrollTop = snapped;
    };

    App.prototype.ensureSidebarFocusVisibility = function (node) {
        if (!node || !this.nodes || !this.nodes.categoryList) {
            return;
        }
        var container = this.nodes.categoryList;
        var containerRect = container.getBoundingClientRect();
        var nodeRect = node.getBoundingClientRect();
        var topBuffer = 4;
        var bottomBuffer = 6;

        if (nodeRect.top < (containerRect.top + topBuffer)) {
            container.scrollTop -= (containerRect.top + topBuffer - nodeRect.top);
            this.snapSidebarScrollPosition();
            return;
        }
        if (nodeRect.bottom > (containerRect.bottom - bottomBuffer)) {
            container.scrollTop += (nodeRect.bottom - (containerRect.bottom - bottomBuffer));
            this.snapSidebarScrollPosition();
        }
    };

    App.prototype.handleKey = function (event) {
        var code = event.keyCode;

        if (this.playerOpen) {
            this.handlePlayerKey(code);
            event.preventDefault();
            return;
        }
        if (this.authOpen) {
            if (this.handleAuthKey(code)) {
                event.preventDefault();
            }
            return;
        }
        if (this.searchOpen) {
            if (this.handleSearchKey(code)) {
                event.preventDefault();
            }
            return;
        }

        if (code === KEY.LEFT || code === KEY.RIGHT || code === KEY.UP || code === KEY.DOWN) {
            this.handleDirectionalKey(code);
            event.preventDefault();
            return;
        }

        if (code === KEY.ENTER) {
            this.handleEnter();
            event.preventDefault();
            return;
        }

        if (code === KEY.BLUE) {
            this.openSearchPrompt();
            event.preventDefault();
            return;
        }

        if (code === KEY.BACK) {
            this.handleBack();
            event.preventDefault();
        }
    };

    App.prototype.handleKeyUp = function (event) {
        var code = event && event.keyCode;
        if (!this.playerOpen) {
            return;
        }
        if (code === KEY.LEFT || code === KEY.RIGHT || code === KEY.FF || code === KEY.RW) {
            this.commitScrubPreview();
            this.resetScrubHoldState(code);
        }
    };

    App.prototype.resetScrubHoldState = function (code) {
        if (!this.scrubHoldState) {
            return;
        }
        if (typeof code !== "number" || this.scrubHoldState.code === code) {
            this.scrubHoldState.code = null;
            this.scrubHoldState.startedAt = 0;
            this.scrubHoldState.lastAt = 0;
        }
    };

    App.prototype.getScrubDeltaMs = function (code) {
        var base = 0;
        if (code === KEY.LEFT) {
            base = -10000;
        } else if (code === KEY.RIGHT) {
            base = 10000;
        } else if (code === KEY.RW) {
            base = -30000;
        } else if (code === KEY.FF) {
            base = 30000;
        } else {
            this.resetScrubHoldState();
            return 0;
        }

        var now = Date.now();
        if (!this.scrubHoldState) {
            this.scrubHoldState = {
                code: null,
                startedAt: 0,
                lastAt: 0
            };
        }

        var repeatWindowMs = 420;
        if (this.scrubHoldState.code !== code || !this.scrubHoldState.lastAt || (now - this.scrubHoldState.lastAt) > repeatWindowMs) {
            this.scrubHoldState.code = code;
            this.scrubHoldState.startedAt = now;
        }
        this.scrubHoldState.lastAt = now;

        var heldMs = Math.max(0, now - this.scrubHoldState.startedAt);
        var multiplier = 1;
        if (heldMs >= 6000) {
            multiplier = 16;
        } else if (heldMs >= 3500) {
            multiplier = 8;
        } else if (heldMs >= 2200) {
            multiplier = 4;
        } else if (heldMs >= 1200) {
            multiplier = 2;
        }

        var delta = base * multiplier;
        var maxStepMs = 300000;
        if (delta > maxStepMs) {
            delta = maxStepMs;
        } else if (delta < -maxStepMs) {
            delta = -maxStepMs;
        }
        return delta;
    };

    App.prototype.updateScrubPreview = function (code) {
        if (!this.playerOpen) {
            return;
        }
        if (this.scrubCommitPending) {
            return;
        }
        var deltaMs = this.getScrubDeltaMs(code);
        if (!deltaMs) {
            return;
        }

        if (!this.scrubPreviewActive) {
            this.scrubPreviewActive = true;
            this.scrubPreviewMs = this.player.getCurrentTimeMs ? this.player.getCurrentTimeMs() : 0;
            this.scrubPreviewResumePlayback = this.player.getState && this.player.getState() === "playing";
            if (this.scrubPreviewResumePlayback) {
                this.player.pause();
            }
            this.updatePlayerTransportState("paused");
        }

        var durationMs = this.player.getDurationMs ? this.player.getDurationMs() : 0;
        var targetMs = (Number(this.scrubPreviewMs) || 0) + deltaMs;
        if (durationMs > 0 && isFinite(durationMs)) {
            targetMs = Math.min(durationMs, targetMs);
        }
        if (!isFinite(targetMs) || targetMs < 0) {
            targetMs = 0;
        }

        this.scrubPreviewMs = targetMs;
        this.updatePlayerProgress(true, targetMs, durationMs);
        this.showPlayerControls(true);
    };

    App.prototype.commitScrubPreview = function () {
        var self = this;
        if (!this.scrubPreviewActive || this.scrubCommitPending) {
            return;
        }
        var targetMs = Math.max(0, Number(this.scrubPreviewMs) || 0);
        var shouldResumePlayback = !!this.scrubPreviewResumePlayback;
        var requestId = this.scrubCommitRequestId + 1;
        var seekPromise;

        this.scrubPreviewActive = false;
        this.scrubCommitPending = true;
        this.scrubCommitRequestId = requestId;
        this.scrubPreviewResumePlayback = false;
        this.scrubPreviewMs = targetMs;

        if (this.player && typeof this.player.seekToAsync === "function") {
            seekPromise = this.player.seekToAsync(targetMs);
        } else if (this.player && typeof this.player.seekTo === "function") {
            this.player.seekTo(targetMs);
            seekPromise = Promise.resolve(targetMs);
        } else if (this.player && typeof this.player.seek === "function") {
            var currentMs = this.player.getCurrentTimeMs ? this.player.getCurrentTimeMs() : 0;
            this.player.seek(targetMs - (Number(currentMs) || 0));
            seekPromise = Promise.resolve(targetMs);
        } else {
            seekPromise = Promise.resolve(targetMs);
        }

        this.updatePlayerProgress(true, targetMs);
        seekPromise.then(function () {
            if (requestId !== self.scrubCommitRequestId) {
                return;
            }
            self.scrubCommitPending = false;
            self.updatePlayerProgress(true, targetMs);
            if (shouldResumePlayback) {
                self.player.play().catch(self.reportPlayerError.bind(self));
            }
            self.scrubPreviewMs = 0;
        }).catch(function (error) {
            if (requestId !== self.scrubCommitRequestId) {
                return;
            }
            self.scrubCommitPending = false;
            self.scrubPreviewMs = 0;
            debug.warn("[app] scrub seek failed", getErrorMessage(error));
            if (shouldResumePlayback) {
                self.player.play().catch(self.reportPlayerError.bind(self));
            }
            self.updatePlayerProgress(true);
        });
    };

    App.prototype.clearScrubPreview = function () {
        this.scrubPreviewActive = false;
        this.scrubPreviewMs = 0;
        this.scrubPreviewResumePlayback = false;
        this.scrubCommitPending = false;
        this.scrubCommitRequestId += 1;
    };

    App.prototype.handleDirectionalKey = function (code) {
        var zone = this.focus.getZone();
        if (zone === "topbar") {
            var visibleTopActions = this.getVisibleTopActions();
            if (!visibleTopActions.length) {
                return;
            }
            var topbarIndex = Math.max(0, Math.min(visibleTopActions.length - 1, this.focus.getIndex("topbar")));
            if (code === KEY.LEFT) {
                topbarIndex = Math.max(0, topbarIndex - 1);
            } else if (code === KEY.RIGHT) {
                topbarIndex = Math.min(visibleTopActions.length - 1, topbarIndex + 1);
            } else if (code === KEY.DOWN) {
                this.focus.setZone("sidebar", this.focus.getIndex("sidebar"));
                this.renderCategories();
                this.applyFocus();
                return;
            }
            this.focus.setIndex("topbar", topbarIndex);
            this.applyFocus();
            return;
        }
        if (zone === "sidebar") {
            var nextSidebarIndex = this.focus.getIndex("sidebar");
            var previousSidebarIndex = nextSidebarIndex;
            if (code === KEY.UP) {
                if (nextSidebarIndex === 0) {
                    this.focus.setZone("topbar", this.focus.getIndex("topbar"));
                    this.applyFocus();
                    return;
                }
                nextSidebarIndex = Math.max(0, nextSidebarIndex - 1);
            } else if (code === KEY.DOWN) {
                nextSidebarIndex = Math.min(this.categories.length - 1, nextSidebarIndex + 1);
            } else if (code === KEY.RIGHT && this.videos.length > 0) {
                this.enterGridFromSidebar(nextSidebarIndex);
                return;
            }

            this.focus.setIndex("sidebar", nextSidebarIndex);
            this.renderCategories();
            this.applyFocus();
            if (nextSidebarIndex !== previousSidebarIndex) {
                this.scheduleFocusedCategoryLoad(nextSidebarIndex);
            }
            return;
        }

        var gridIndex = this.focus.getIndex("grid");
        var columns = 4;
        if (code === KEY.LEFT) {
            if (gridIndex % columns === 0) {
                this.focus.setZone("sidebar", this.focus.getIndex("sidebar"));
                this.renderCategories();
                this.applyFocus();
                return;
            }
            gridIndex = Math.max(0, gridIndex - 1);
        } else if (code === KEY.RIGHT) {
            gridIndex = Math.min(this.videos.length - 1, gridIndex + 1);
        } else if (code === KEY.UP) {
            if (gridIndex < columns) {
                this.focus.setZone("topbar", this.focus.getIndex("topbar"));
                this.applyFocus();
                return;
            }
            gridIndex = Math.max(0, gridIndex - columns);
        } else if (code === KEY.DOWN) {
            gridIndex = Math.min(this.videos.length - 1, gridIndex + columns);
        }

        this.focus.setIndex("grid", gridIndex);
        this.applyFocus();
        this.maybeLoadMoreForGridIndex(gridIndex);
    };

    App.prototype.enterGridFromSidebar = function (sidebarIndex) {
        var self = this;
        var index = Math.max(0, Math.min(this.categories.length - 1, Number(sidebarIndex) || 0));
        var category = this.categories[index];
        if (!category) {
            return;
        }

        function moveToGridTop() {
            if (!self.videos || !self.videos.length) {
                self.focus.setZone("sidebar", index);
                self.focus.setIndex("sidebar", index);
                self.renderCategories();
                self.applyFocus();
                return;
            }
            self.focus.setIndex("grid", 0);
            self.resetVideoGridScroll();
            self.focus.setZone("grid", 0);
            self.applyFocus();
            self.maybeLoadMoreForGridIndex(0);
        }

        var targetCategoryId = String(category.id || "");
        var currentGridCategoryId = String(this.activeGridCategoryId || "");
        if (targetCategoryId && targetCategoryId !== currentGridCategoryId) {
            this.loadCategory(index).then(function () {
                moveToGridTop();
            });
            return;
        }

        moveToGridTop();
    };

    App.prototype.handleEnter = function () {
        var zone = this.focus.getZone();
        if (zone === "topbar") {
            var action = this.getTopActionAt(this.focus.getIndex("topbar"));
            if (!action) {
                return;
            }
            if (action.id === "searchButton") {
                this.openSearchDialog();
            } else if (action.id === "signInButton") {
                this.openSignInDialog();
            } else if (action.id === "followChannelButton") {
                this.handleChannelFollowAction();
            } else if (action.id === "accountBadge") {
                this.openSignedInDefaultChannel();
            }
            return;
        }
        if (zone === "sidebar") {
            this.loadCategory(this.focus.getIndex("sidebar"));
            return;
        }
        this.openFocusedVideo();
    };

    App.prototype.openFocusedVideo = function () {
        var video = this.videos[this.focus.getIndex("grid")];
        if (!video) {
            return Promise.resolve();
        }
        debug.log("[app] open video", video.claimId, video.normalizedName, "mediaType", video.sourceMediaType || "unknown", "engine", this.playerEngine);
        this.activeVideo = video;
        this.pendingViewLog = {
            claimId: String(video.claimId || ""),
            uri: String(video.canonicalUrl || ""),
            outpoint: String(video.outpoint || ""),
            txid: String(video.txid || ""),
            nout: typeof video.nout !== "undefined" ? video.nout : "",
            sent: false,
            sending: false
        };
        this.playerFocusTarget = "controls";
        this.playerReaction = "";
        this.playerReactionBusy = false;
        this.playerReactionClaimId = "";
        this.resetPlayerChannelFollowState();
        this.renderPlayerChannelInfo(video);
        this.renderPlayerReactions(video);
        this.refreshPlayerChannelFollowState(video);
        this.updatePlayerHeaderFocus();
        this.nodes.playerTitle.textContent = video.title;
        if (this.nodes.playerMeta) {
            this.nodes.playerMeta.textContent = buildPlayerMeta(video);
        }
        this.nodes.playerLayer.classList.remove("hidden");
        this.showPlayerControls(true);
        this.updatePlayerTransportState("loading");
        this.updatePlayerProgress(true);
        this.startPlayerProgressTicker();
        this.playerOpen = true;
        this.updatePlayerControlFocusState();
        this.fetchPlayerReactions(video);

        var self = this;
        if (self.player.isNativePlayer && self.player.isNativePlayer()) {
            document.body.classList.add("native-video-active");
            return Odysee.api.resolveStreamCandidates(this.config, video).then(function (candidates) {
                var prioritized = self.prioritizeNativeCandidates(candidates);
                if (self.maxNativeCandidates > 0 && prioritized.length > self.maxNativeCandidates) {
                    prioritized = prioritized.slice(0, self.maxNativeCandidates);
                }
                debug.log("[app] native candidates resolved", candidates.length, "using", prioritized.length);
                return self.tryNativePlaybackCandidates(prioritized, 0);
            }).catch(function (error) {
                throw new Error("Native playback failed: " + getErrorMessage(error));
            }).catch(function (error) {
                var sameVideoStillActive = !!(self.activeVideo && video && String(self.activeVideo.claimId || "") === String(video.claimId || ""));
                if (!self.playerOpen || !sameVideoStillActive) {
                    return;
                }
                document.body.classList.remove("native-video-active");
                debug.error("[app] native playback failed", getErrorMessage(error));
                self.updatePlayerTransportState("error");
                self.showPlayerControls(true);
                self.showToast("Playback failed for selected video. Check status.");
            });
        }

        return Odysee.api.resolveStreamUrl(this.config, video).then(function (streamUrl) {
            return self.player.open(streamUrl).then(function () {
                return self.player.play().catch(function () {
                    return self.player.prepare().then(function () {
                        return self.player.play();
                    });
                });
            });
        }).catch(function (error) {
            var sameVideoStillActive = !!(this.activeVideo && video && String(this.activeVideo.claimId || "") === String(video.claimId || ""));
            if (!this.playerOpen || !sameVideoStillActive) {
                return;
            }
            this.updatePlayerTransportState("error");
            this.showPlayerControls(true);
            this.showToast("Playback failed for selected video. Check status.");
        }.bind(this));
    };

    App.prototype.tryNativePlaybackCandidates = function (candidates, index) {
        var self = this;
        if (!Array.isArray(candidates) || !candidates.length) {
            return Promise.reject(new Error("No playback candidates"));
        }
        if (index >= candidates.length) {
            return Promise.reject(new Error("All playback candidates failed"));
        }
        if (!this.playerOpen) {
            return Promise.reject(new Error("Player closed"));
        }

        var candidate = candidates[index];
        this.updatePlayerTransportState("loading");
        this.showPlayerControls(true);
        debug.log("[app] trying native candidate", (index + 1) + "/" + candidates.length, candidate);
        var timeoutMs = index <= 1 ? this.playbackAttemptTimeoutMs : this.playbackAttemptSlowTimeoutMs;
        return self.executeNativeCandidateAttempt(candidate, timeoutMs).then(function () {
            debug.log("[app] native candidate succeeded", index + 1, candidate);
            self.adjustNativeCandidateScore(candidate, 3);
            self.updatePlayerTransportState("playing");
            self.schedulePlayerControlsAutoHide();
        }).catch(function (error) {
            debug.warn("[app] native candidate failed", index + 1, getErrorMessage(error));
            self.adjustNativeCandidateScore(candidate, -1);
            self.updatePlayerTransportState("loading");
            return self.tryNativePlaybackCandidates(candidates, index + 1);
        });
    };

    App.prototype.executeNativeCandidateAttempt = function (candidate, timeoutMs) {
        var self = this;
        return withTimeout(this.player.open(candidate).then(function () {
            return self.player.prepare();
        }).then(function () {
            return self.player.play();
        }), timeoutMs, function () {
            debug.warn("[app] native candidate timeout", timeoutMs, candidate);
            try {
                self.player.stop();
            } catch (error) {}
        });
    };

    App.prototype.loadPlaybackCandidateScores = function () {
        try {
            if (!window.localStorage) {
                return {};
            }
            var raw = window.localStorage.getItem(this.playbackCandidateStorageKey);
            if (!raw) {
                return {};
            }
            var parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object") {
                return {};
            }
            return parsed;
        } catch (error) {
            return {};
        }
    };

    App.prototype.savePlaybackCandidateScores = function () {
        try {
            if (!window.localStorage) {
                return;
            }
            window.localStorage.setItem(this.playbackCandidateStorageKey, JSON.stringify(this.playbackCandidateScores || {}));
        } catch (error) {}
    };

    App.prototype.getNativeCandidateSignature = function (url) {
        var value = String(url || "");
        if (!value) {
            return "unknown";
        }
        var source = "other";
        if (value.indexOf("/api/v3/streams/free/") !== -1) {
            source = "api_v3";
        } else if (value.indexOf("/v6/streams/") !== -1) {
            source = "v6";
        }

        var host = "unknown";
        var hostMatch = value.match(/^https?:\/\/([^/]+)/i);
        if (hostMatch && hostMatch[1]) {
            host = String(hostMatch[1]).toLowerCase();
        }

        var format = "bare";
        if (/\/playlist\.m3u8(?:$|\?)/i.test(value)) {
            format = "playlist";
        } else if (/\/master\.m3u8(?:$|\?)/i.test(value)) {
            format = "master";
        } else if (/\.m3u8(?:$|\?)/i.test(value)) {
            format = "hls";
        } else if (/\.mp4(?:$|\?)/i.test(value)) {
            format = "mp4";
        }
        return source + "|" + host + "|" + format;
    };

    App.prototype.getNativeCandidateScore = function (url) {
        var key = this.getNativeCandidateSignature(url);
        var value = Number(this.playbackCandidateScores[key] || 0);
        if (!isFinite(value)) {
            return 0;
        }
        return value;
    };

    App.prototype.adjustNativeCandidateScore = function (url, delta) {
        var key = this.getNativeCandidateSignature(url);
        var previous = Number(this.playbackCandidateScores[key] || 0);
        if (!isFinite(previous)) {
            previous = 0;
        }
        var next = previous + (Number(delta) || 0);
        if (next > 30) {
            next = 30;
        } else if (next < -20) {
            next = -20;
        }
        if (next === 0) {
            delete this.playbackCandidateScores[key];
        } else {
            this.playbackCandidateScores[key] = next;
        }
        this.savePlaybackCandidateScores();
    };

    App.prototype.prioritizeNativeCandidates = function (candidates) {
        if (!Array.isArray(candidates) || !candidates.length) {
            return [];
        }
        var self = this;
        var ranked = candidates.map(function (url, index) {
            var historyScore = self.getNativeCandidateScore(url);
            var rankScore = historyScore * 1000 - index;
            return {
                url: url,
                index: index,
                score: rankScore,
                historyScore: historyScore,
                signature: self.getNativeCandidateSignature(url)
            };
        }).sort(function (left, right) {
            if (right.score !== left.score) {
                return right.score - left.score;
            }
            return left.index - right.index;
        });
        var ordered = ranked.map(function (entry) {
            return entry.url;
        });

        if (debug.verbose) {
            debug.log("[app] prioritized native candidates", ranked.length, stringifyDebug(ranked.slice(0, 5)));
        }
        return ordered;
    };

    App.prototype.openActiveVideoChannelFromPlayer = function () {
        var video = this.activeVideo;
        if (!video || !video.channelClaimId) {
            this.showToast("Channel unavailable for this video.");
            return Promise.resolve();
        }

        var channelContext = {
            channelId: String(video.channelClaimId),
            channelName: String(video.channelName || "Channel"),
            channelAvatarUrl: String(video.channelAvatarUrl || ""),
            channelCanonicalUrl: String(video.channelCanonicalUrl || ""),
            isFollowing: false,
            followBusy: false
        };

        this.closePlayer();
        return this.openChannelFeed(channelContext);
    };

    App.prototype.openChannelFeed = function (channelContext) {
        var self = this;
        if (!channelContext) {
            return Promise.resolve();
        }

        var requestedContext = {
            channelId: String(channelContext.channelId || "").trim(),
            channelName: String(channelContext.channelName || "").trim(),
            channelAvatarUrl: String(channelContext.channelAvatarUrl || ""),
            channelCanonicalUrl: String(channelContext.channelCanonicalUrl || ""),
            isFollowing: false,
            followBusy: false
        };
        if (!requestedContext.channelName) {
            requestedContext.channelName = "Channel";
        }

        var resolveContextPromise = Promise.resolve(requestedContext);
        if (!requestedContext.channelId && Odysee.api && typeof Odysee.api.resolveChannelContext === "function") {
            resolveContextPromise = Odysee.api.resolveChannelContext(this.config, requestedContext).then(function (resolvedContext) {
                return resolvedContext || requestedContext;
            }).catch(function () {
                return requestedContext;
            });
        }

        return resolveContextPromise.then(function (resolvedContext) {
            var resolvedChannelId = String(resolvedContext && resolvedContext.channelId || "").trim();
            if (!resolvedChannelId) {
                self.showToast("Default channel unavailable.");
                return;
            }

            self.currentSearchQuery = "";
            self.channelContext = {
                channelId: resolvedChannelId,
                channelName: String(resolvedContext.channelName || "Channel"),
                channelAvatarUrl: String(resolvedContext.channelAvatarUrl || ""),
                channelCanonicalUrl: String(resolvedContext.channelCanonicalUrl || ""),
                isFollowing: false,
                followBusy: false
            };
            self.updateChannelFollowButton();
            if (self.authUser) {
                self.refreshChannelFollowState();
            }

            self.activeDynamicCategory = {
                id: "channel:" + self.channelContext.channelId,
                title: self.channelContext.channelName,
                channelIds: [self.channelContext.channelId],
                orderBy: ["release_time"],
                isChannelFeed: true
            };
            self.selectedCategoryId = String(self.activeDynamicCategory.id || "");
            self.activeCategoryPage = 1;
            self.activeCategoryHasMore = true;
            self.activeCategoryLoadingMore = false;
            self.resetVideoGridScroll();
            self.setPageTitle(self.channelContext.channelName, true);
            self.nodes.contentMeta.textContent = "";

            var cacheKey = self.getCategoryCacheKey(self.activeDynamicCategory, 1);
            var requestId = self.feedRequestId + 1;
            self.feedRequestId = requestId;
            var cachedVideos = self.getCachedCategoryVideos(cacheKey);
            if (cachedVideos) {
                self.activeGridCategoryId = String(self.activeDynamicCategory && self.activeDynamicCategory.id || "");
                self.videos = cachedVideos;
                self.activeCategoryHasMore = cachedVideos.length >= self.categoryPageSize;
                self.renderVideos();
                self.focus.setZone("grid", 0);
                self.applyFocus();
                return;
            }

            if (!self.inFlightCategoryRequests[cacheKey]) {
                self.inFlightCategoryRequests[cacheKey] = Odysee.api.loadChannelVideos(self.config, self.channelContext.channelId, 1).then(function (videos) {
                    delete self.inFlightCategoryRequests[cacheKey];
                    return videos;
                }).catch(function (error) {
                    delete self.inFlightCategoryRequests[cacheKey];
                    throw error;
                });
            }

            return self.inFlightCategoryRequests[cacheKey].then(function (videos) {
                if (requestId !== self.feedRequestId || !self.channelContext) {
                    return;
                }
                self.setCachedCategoryVideos(cacheKey, videos);
                self.activeGridCategoryId = String(self.activeDynamicCategory && self.activeDynamicCategory.id || "");
                self.videos = videos;
                self.activeCategoryHasMore = videos.length >= self.categoryPageSize;
                self.renderVideos();
                self.focus.setZone("grid", 0);
                self.applyFocus();
                if (!videos.length) {
                    self.showToast("No videos found for this channel.");
                }
            }).catch(function (error) {
                if (requestId !== self.feedRequestId) {
                    return;
                }
                self.activeGridCategoryId = String(self.activeDynamicCategory && self.activeDynamicCategory.id || "");
                self.videos = [];
                self.activeCategoryHasMore = false;
                self.renderVideos();
                self.showToast("Could not load channel videos: " + getErrorMessage(error));
            });
        });
    };

    App.prototype.handlePlayerKey = function (code) {
        this.showPlayerControlsTemporarily();
        if (code === KEY.BACK) {
            this.resetScrubHoldState();
            this.clearScrubPreview();
            this.closePlayer();
            return;
        }
        if (code === KEY.UP) {
            this.resetScrubHoldState();
            this.commitScrubPreview();
            if (this.playerFocusTarget === "controls") {
                this.focusPlayerHeaderTarget("first");
            }
            return;
        }
        if (code === KEY.DOWN) {
            this.resetScrubHoldState();
            this.commitScrubPreview();
            if (this.playerFocusTarget !== "controls") {
                this.playerFocusTarget = "controls";
                this.updatePlayerHeaderFocus();
            }
            return;
        }
        if (this.playerFocusTarget !== "controls" && code === KEY.LEFT) {
            this.resetScrubHoldState();
            this.commitScrubPreview();
            this.focusPlayerHeaderTarget("left");
            return;
        }
        if (this.playerFocusTarget !== "controls" && code === KEY.RIGHT) {
            this.resetScrubHoldState();
            this.commitScrubPreview();
            this.focusPlayerHeaderTarget("right");
            return;
        }
        if (this.playerFocusTarget !== "controls" && code === KEY.ENTER) {
            this.resetScrubHoldState();
            this.commitScrubPreview();
            this.handlePlayerHeaderEnter();
            return;
        }
        if (code === KEY.ENTER || code === KEY.PLAY_PAUSE) {
            this.resetScrubHoldState();
            this.commitScrubPreview();
            if (this.player.getState() === "playing") {
                this.player.pause();
            } else {
                this.player.play().catch(this.reportPlayerError.bind(this));
            }
            return;
        }
        if (code === KEY.PLAY) {
            this.resetScrubHoldState();
            this.commitScrubPreview();
            this.player.play().catch(this.reportPlayerError.bind(this));
            return;
        }
        if (code === KEY.PAUSE) {
            this.resetScrubHoldState();
            this.commitScrubPreview();
            this.player.pause();
            return;
        }
        if (code === KEY.STOP) {
            this.resetScrubHoldState();
            this.clearScrubPreview();
            this.closePlayer();
            return;
        }
        if (this.playerFocusTarget !== "controls" && (code === KEY.LEFT || code === KEY.RIGHT || code === KEY.FF || code === KEY.RW)) {
            return;
        }
        if (code === KEY.LEFT || code === KEY.RIGHT || code === KEY.FF || code === KEY.RW) {
            this.updateScrubPreview(code);
        }
    };

    App.prototype.closePlayer = function () {
        debug.log("[app] close player");
        this.stopPlayerProgressTicker();
        this.clearPlayerControlHideTimer();
        this.resetScrubHoldState();
        this.clearScrubPreview();
        this.player.stop();
        document.body.classList.remove("native-video-active");
        this.nodes.playerLayer.classList.add("hidden");
        this.nodes.playerLayer.classList.remove("controls-hidden");
        this.activeVideo = null;
        this.pendingViewLog = null;
        this.playerFocusTarget = "controls";
        this.playerReaction = "";
        this.playerReactionBusy = false;
        this.playerReactionClaimId = "";
        this.playerUiVisible = true;
        this.playerOpen = false;
        this.updatePlayerControlFocusState();
        this.updatePlayerTransportState("stopped");
        this.clearPlayerChannelInfo();
        this.clearPlayerReactions();
        this.resetPlayerChannelFollowState();
        if (this.nodes.playerMeta) {
            this.nodes.playerMeta.textContent = "";
        }
        if (this.nodes.playerProgressFill) {
            this.nodes.playerProgressFill.style.width = "0%";
        }
        if (this.nodes.playerProgressThumb) {
            this.nodes.playerProgressThumb.style.left = "0%";
        }
        if (this.nodes.playerTime) {
            this.nodes.playerTime.textContent = "00:00 / --:--";
        }
        this.applyFocus();
    };

    App.prototype.recordPlaybackViewIfNeeded = function () {
        var self = this;
        if (!this.playerOpen || !this.pendingViewLog || this.pendingViewLog.sent || this.pendingViewLog.sending) {
            return;
        }
        if (!Odysee.api || typeof Odysee.api.logFileView !== "function") {
            return;
        }
        this.pendingViewLog.sending = true;
        Odysee.api.logFileView(this.config, this.pendingViewLog).then(function () {
            if (!self.pendingViewLog) {
                return;
            }
            self.pendingViewLog.sent = true;
            self.pendingViewLog.sending = false;
            if (debug.verbose) {
                debug.log("[app] file view logged", self.pendingViewLog.claimId);
            }
        }).catch(function (error) {
            if (!self.pendingViewLog) {
                return;
            }
            self.pendingViewLog.sending = false;
            debug.warn("[app] file view log failed", getErrorMessage(error));
        });
    };

    App.prototype.onPlayerStateChanged = function (state) {
        var text = String(state || "");
        if (!this.playerOpen) {
            return;
        }

        if (text === "error" || text.indexOf("error:") === 0) {
            if (debug.verbose && this.player) {
                debug.warn("[app] player state error", text, "timeMs", this.player.getCurrentTimeMs ? this.player.getCurrentTimeMs() : 0, "durationMs", this.player.getDurationMs ? this.player.getDurationMs() : 0);
            }
            this.updatePlayerTransportState("error");
            this.showPlayerControls(true);
            return;
        }

        if (text === "playing") {
            this.updatePlayerTransportState("playing");
            this.recordPlaybackViewIfNeeded();
            this.schedulePlayerControlsAutoHide();
        } else if (text === "paused") {
            this.updatePlayerTransportState("paused");
            this.showPlayerControls(true);
        } else if (text === "buffering" || text === "loading") {
            this.updatePlayerTransportState("loading");
            this.showPlayerControls(true);
        } else if (text === "ready") {
            this.updatePlayerTransportState("paused");
            this.showPlayerControls(true);
        } else if (text === "ended") {
            if (debug.verbose && this.player) {
                debug.log("[app] player ended", "timeMs", this.player.getCurrentTimeMs ? this.player.getCurrentTimeMs() : 0, "durationMs", this.player.getDurationMs ? this.player.getDurationMs() : 0);
            }
            this.closePlayer();
            return;
        } else if (text === "stopped") {
            this.updatePlayerTransportState("stopped");
        } else {
            this.updatePlayerTransportState("paused");
        }

        this.updatePlayerProgress();
    };

    App.prototype.updatePlayerTransportState = function (state) {
        if (!this.nodes) {
            return;
        }
        var normalized = String(state || "").toLowerCase();
        var isLoading = normalized === "loading" || normalized === "buffering";
        var isPlaying = normalized === "playing";
        var showPlay = !isLoading && !isPlaying;
        var showPause = !isLoading && isPlaying;

        if (this.nodes.playerTransportPlay) {
            if (showPlay) {
                this.nodes.playerTransportPlay.classList.remove("hidden");
            } else {
                this.nodes.playerTransportPlay.classList.add("hidden");
            }
        }
        if (this.nodes.playerTransportPause) {
            if (showPause) {
                this.nodes.playerTransportPause.classList.remove("hidden");
            } else {
                this.nodes.playerTransportPause.classList.add("hidden");
            }
        }
        if (this.nodes.playerLoadingSpinner) {
            if (isLoading) {
                this.nodes.playerLoadingSpinner.classList.remove("hidden");
            } else {
                this.nodes.playerLoadingSpinner.classList.add("hidden");
            }
        }
    };

    App.prototype.showPlayerControls = function (persistent) {
        if (!this.nodes.playerLayer) {
            return;
        }
        this.playerUiVisible = true;
        this.nodes.playerLayer.classList.remove("controls-hidden");
        this.clearPlayerControlHideTimer();
        if (!persistent && this.player.getState() === "playing") {
            this.schedulePlayerControlsAutoHide();
        }
    };

    App.prototype.showPlayerControlsTemporarily = function () {
        this.showPlayerControls(false);
    };

    App.prototype.clearPlayerControlHideTimer = function () {
        if (!this.playerUiHideTimer) {
            return;
        }
        clearTimeout(this.playerUiHideTimer);
        this.playerUiHideTimer = null;
    };

    App.prototype.schedulePlayerControlsAutoHide = function () {
        var self = this;
        this.clearPlayerControlHideTimer();
        if (this.player.getState() !== "playing") {
            return;
        }
        this.playerUiHideTimer = setTimeout(function () {
            self.playerUiHideTimer = null;
            if (!self.playerOpen) {
                return;
            }
            if (self.player.getState() !== "playing") {
                return;
            }
            self.playerUiVisible = false;
            self.nodes.playerLayer.classList.add("controls-hidden");
        }, 3200);
    };

    App.prototype.startPlayerProgressTicker = function () {
        var self = this;
        this.stopPlayerProgressTicker();
        this.playerTickTimer = setInterval(function () {
            if (!self.playerOpen) {
                return;
            }
            self.updatePlayerProgress();
        }, 120);
    };

    App.prototype.stopPlayerProgressTicker = function () {
        if (!this.playerTickTimer) {
            return;
        }
        clearInterval(this.playerTickTimer);
        this.playerTickTimer = null;
    };

    App.prototype.updatePlayerProgress = function (force, overrideCurrentMs, overrideDurationMs) {
        if (!this.playerOpen && !force) {
            return;
        }
        var currentMs = this.player.getCurrentTimeMs ? this.player.getCurrentTimeMs() : 0;
        var durationMs = this.player.getDurationMs ? this.player.getDurationMs() : 0;
        if (typeof overrideDurationMs === "number" && isFinite(overrideDurationMs) && overrideDurationMs >= 0) {
            durationMs = overrideDurationMs;
        }
        if (typeof overrideCurrentMs === "number" && isFinite(overrideCurrentMs) && overrideCurrentMs >= 0) {
            currentMs = overrideCurrentMs;
        } else if (this.scrubPreviewActive || this.scrubCommitPending) {
            currentMs = Math.max(0, Number(this.scrubPreviewMs) || 0);
        }
        if (!isFinite(currentMs) || currentMs < 0) {
            currentMs = 0;
        }
        if (!isFinite(durationMs) || durationMs < 0) {
            durationMs = 0;
        }
        if (durationMs > 0 && currentMs > durationMs) {
            currentMs = durationMs;
        }

        var percent = durationMs > 0 ? Math.min(100, Math.max(0, (currentMs / durationMs) * 100)) : 0;
        var percentText = percent.toFixed(2) + "%";
        if (this.nodes.playerProgressFill) {
            this.nodes.playerProgressFill.style.width = percentText;
        }
        if (this.nodes.playerProgressThumb) {
            this.nodes.playerProgressThumb.style.left = percentText;
        }

        if (this.nodes.playerTime) {
            var durationLabel = durationMs > 0 ? formatDuration(durationMs) : "--:--";
            this.nodes.playerTime.textContent = formatDuration(currentMs) + " / " + durationLabel;
        }
    };

    App.prototype.openSearchPrompt = function () {
        this.openSearchDialog();
    };

    App.prototype.openSearchDialog = function () {
        if (!this.nodes.searchModal || !this.nodes.searchInput) {
            this.showToast("Search UI unavailable.");
            return;
        }
        if (this.authOpen) {
            this.closeSignInDialog();
        }
        this.searchOpen = true;
        this.searchDialogFocus = 0;
        this.nodes.searchModal.classList.remove("hidden");
        this.nodes.searchInput.value = this.lastSearchQuery || "";
        this.updateSearchDialogFocus();
    };

    App.prototype.submitSearchDialog = function () {
        if (!this.nodes.searchInput) {
            return;
        }
        var query = String(this.nodes.searchInput.value || "").trim();
        if (!query) {
            this.showToast("Enter a search term.");
            return;
        }
        this.lastSearchQuery = query;
        this.closeSearchDialog();
        this.performSearch(query);
    };

    App.prototype.closeSearchDialog = function () {
        if (!this.searchOpen) {
            return;
        }
        this.searchOpen = false;
        this.clearSearchDialogFocus();
        if (this.nodes.searchModal) {
            this.nodes.searchModal.classList.add("hidden");
        }
        this.applyFocus();
    };

    App.prototype.handleSearchKey = function (code) {
        if (code === KEY.BACK) {
            this.closeSearchDialog();
            return true;
        }
        if (code === KEY.DOWN) {
            if (this.searchDialogFocus === 0) {
                this.searchDialogFocus = 1;
                this.updateSearchDialogFocus();
            }
            return true;
        }
        if (code === KEY.UP) {
            if (this.searchDialogFocus !== 0) {
                this.searchDialogFocus = 0;
                this.updateSearchDialogFocus();
            }
            return true;
        }
        if (code === KEY.LEFT) {
            if (this.searchDialogFocus === 2) {
                this.searchDialogFocus = 1;
                this.updateSearchDialogFocus();
            }
            return true;
        }
        if (code === KEY.RIGHT) {
            if (this.searchDialogFocus === 1) {
                this.searchDialogFocus = 2;
                this.updateSearchDialogFocus();
            }
            return true;
        }
        if (code === KEY.ENTER) {
            if (this.searchDialogFocus === 2) {
                this.closeSearchDialog();
            } else {
                this.submitSearchDialog();
            }
            return true;
        }
        return false;
    };

    App.prototype.clearSearchDialogFocus = function () {
        if (this.nodes.searchInput) {
            this.nodes.searchInput.classList.remove("is-focused");
        }
        if (this.nodes.searchSubmit) {
            this.nodes.searchSubmit.classList.remove("is-focused");
        }
        if (this.nodes.searchCancel) {
            this.nodes.searchCancel.classList.remove("is-focused");
        }
    };

    App.prototype.updateSearchDialogFocus = function () {
        this.clearSearchDialogFocus();
        if (this.searchDialogFocus === 0) {
            if (this.nodes.searchInput) {
                this.nodes.searchInput.classList.add("is-focused");
                this.nodes.searchInput.focus();
                this.nodes.searchInput.select();
            }
            return;
        }
        if (this.searchDialogFocus === 2) {
            if (this.nodes.searchCancel) {
                this.nodes.searchCancel.classList.add("is-focused");
                this.nodes.searchCancel.focus();
            }
            return;
        }
        this.searchDialogFocus = 1;
        if (this.nodes.searchSubmit) {
            this.nodes.searchSubmit.classList.add("is-focused");
            this.nodes.searchSubmit.focus();
        }
    };

    App.prototype.setAuthUser = function (user) {
        var wasSignedIn = !!this.authUser;
        var previousAuthKey = this.getAuthUserIdentity(this.authUser);
        this.authUser = user || null;
        var nextAuthKey = this.getAuthUserIdentity(this.authUser);
        if (!this.authUser) {
            this.watchLaterAvailable = false;
            this.ownedChannelIds = {};
            this.ownedChannelsLoaded = false;
            this.ownedChannelsLoading = false;
            if (this.channelContext) {
                this.channelContext.isFollowing = false;
                this.channelContext.followBusy = false;
            }
        } else if (previousAuthKey !== nextAuthKey) {
            this.ownedChannelIds = {};
            this.ownedChannelsLoaded = false;
            this.ownedChannelsLoading = false;
        }
        this.seedOwnedChannelsFromAuth();
        this.updateSignInButton();
        this.renderAccountBadge();
        this.updateChannelFollowButton();
        if (this.playerOpen) {
            this.renderPlayerReactions(this.activeVideo);
            if (this.authUser && this.activeVideo) {
                this.fetchPlayerReactions(this.activeVideo);
            }
            this.refreshPlayerChannelFollowState(this.activeVideo);
        }
        if (wasSignedIn !== !!this.authUser) {
            this.clearCategoryCache();
            this.syncCategoriesForAuthChange();
        }
        this.refreshWatchLaterAvailability();
        this.refreshOwnedChannels();
        if (this.authUser && this.channelContext && this.channelContext.channelId) {
            this.refreshChannelFollowState();
        }
    };

    App.prototype.getAuthUserIdentity = function (user) {
        if (!user) {
            return "";
        }
        return String(
            user.email ||
            user.userId ||
            user.id ||
            user.displayName ||
            ""
        ).trim().toLowerCase();
    };

    App.prototype.seedOwnedChannelsFromAuth = function () {
        if (!this.authUser) {
            return;
        }
        if (!this.ownedChannelIds || typeof this.ownedChannelIds !== "object") {
            this.ownedChannelIds = {};
        }
        var context = this.getDefaultChannelContextFromAuth();
        var defaultChannelId = normalizeClaimId(context && context.channelId);
        if (defaultChannelId) {
            this.ownedChannelIds[defaultChannelId] = true;
        }
    };

    App.prototype.refreshOwnedChannels = function () {
        var self = this;
        if (!this.authUser || !Odysee.api || typeof Odysee.api.listMyChannels !== "function") {
            return Promise.resolve({});
        }
        if (this.ownedChannelsLoaded || this.ownedChannelsLoading) {
            return Promise.resolve(this.ownedChannelIds || {});
        }

        this.ownedChannelsLoading = true;
        var requestId = this.ownedChannelsRequestId + 1;
        this.ownedChannelsRequestId = requestId;

        return Odysee.api.listMyChannels(this.config).then(function (channels) {
            if (requestId !== self.ownedChannelsRequestId) {
                return self.ownedChannelIds || {};
            }
            var owned = {};
            var rows = Array.isArray(channels) ? channels : [];
            for (var i = 0; i < rows.length; i += 1) {
                var channelId = normalizeClaimId(rows[i] && rows[i].channelId);
                if (channelId) {
                    owned[channelId] = true;
                }
            }
            var context = self.getDefaultChannelContextFromAuth();
            var defaultChannelId = normalizeClaimId(context && context.channelId);
            if (defaultChannelId) {
                owned[defaultChannelId] = true;
            }
            self.ownedChannelIds = owned;
            self.ownedChannelsLoaded = true;
            self.ownedChannelsLoading = false;
            self.updateChannelFollowButton();
            if (self.playerOpen) {
                self.refreshPlayerChannelFollowState(self.activeVideo);
            }
            return owned;
        }).catch(function () {
            if (requestId === self.ownedChannelsRequestId) {
                self.ownedChannelsLoading = false;
            }
            return self.ownedChannelIds || {};
        });
    };

    App.prototype.isOwnChannel = function (channelId) {
        if (!this.authUser || !channelId) {
            return false;
        }
        var normalizedId = normalizeClaimId(channelId);
        if (!normalizedId) {
            return false;
        }
        return !!(this.ownedChannelIds && this.ownedChannelIds[normalizedId]);
    };

    App.prototype.refreshWatchLaterAvailability = function () {
        var self = this;
        if (!this.authUser || !Odysee.api || typeof Odysee.api.hasWatchLaterVideos !== "function") {
            return Promise.resolve(false);
        }
        var requestId = this.watchLaterRequestId + 1;
        this.watchLaterRequestId = requestId;
        return Odysee.api.hasWatchLaterVideos(this.config).then(function (hasVideos) {
            if (requestId !== self.watchLaterRequestId || !self.authUser) {
                return !!hasVideos;
            }
            var nextValue = !!hasVideos;
            if (self.watchLaterAvailable === nextValue) {
                return nextValue;
            }
            self.watchLaterAvailable = nextValue;
            self.syncCategoriesForAuthChange();
            return nextValue;
        }).catch(function () {
            return false;
        });
    };

    App.prototype.updateSignInButton = function () {
        if (!this.nodes.signInButton) {
            return;
        }
        this.nodes.signInButton.textContent = this.authUser ? "Account" : "Sign In";
    };

    App.prototype.getDefaultChannelContextFromAuth = function () {
        if (!this.authUser) {
            return null;
        }

        var raw = this.authUser.raw || {};
        var nestedDefault =
            raw.default_channel ||
            raw.primary_channel ||
            raw.channel ||
            null;

        var channelId = normalizeClaimId(
            this.authUser.defaultChannelClaimId ||
            raw.default_channel_claim_id ||
            raw.defaultChannelClaimId ||
            raw.default_channel_id ||
            raw.defaultChannelId ||
            raw.primary_channel_claim_id ||
            raw.primaryChannelClaimId ||
            raw.primary_channel_id ||
            raw.primaryChannelId ||
            raw.channel_claim_id ||
            raw.channelClaimId ||
            (nestedDefault && (nestedDefault.claim_id || nestedDefault.claimId || nestedDefault.id)) ||
            ""
        );

        var channelName = String(
            this.authUser.defaultChannelName ||
            this.authUser.channelName ||
            raw.default_channel_title ||
            raw.defaultChannelTitle ||
            raw.default_channel_name ||
            raw.defaultChannelName ||
            raw.primary_channel_title ||
            raw.primaryChannelTitle ||
            raw.primary_channel_name ||
            raw.primaryChannelName ||
            raw.channel_name ||
            raw.channelName ||
            (nestedDefault && nestedDefault.value && nestedDefault.value.title) ||
            (nestedDefault && (nestedDefault.name || nestedDefault.normalized_name)) ||
            ""
        ).trim();

        var channelCanonicalUrl = String(
            this.authUser.defaultChannelUri ||
            raw.default_channel_url ||
            raw.default_channel_uri ||
            raw.defaultChannelUrl ||
            raw.defaultChannelUri ||
            raw.primary_channel_url ||
            raw.primary_channel_uri ||
            raw.primaryChannelUrl ||
            raw.primaryChannelUri ||
            raw.channel_url ||
            raw.channel_uri ||
            (nestedDefault && (nestedDefault.canonical_url || nestedDefault.permanent_url || nestedDefault.short_url || nestedDefault.url || nestedDefault.uri)) ||
            ""
        ).trim();

        if (!channelName && channelCanonicalUrl) {
            var uriNameMatch = channelCanonicalUrl.match(/lbry:\/\/([^/#?]+)/i);
            if (uriNameMatch && uriNameMatch[1]) {
                try {
                    channelName = decodeURIComponent(uriNameMatch[1]);
                } catch (error) {
                    channelName = uriNameMatch[1];
                }
            }
        }
        if (!channelName) {
            channelName = "My Channel";
        }

        if (!channelId && channelCanonicalUrl) {
            var uriClaimMatch = channelCanonicalUrl.match(/#([a-f0-9]{6,40})$/i);
            if (uriClaimMatch && uriClaimMatch[1]) {
                channelId = normalizeClaimId(uriClaimMatch[1]);
            }
        }

        if (!channelId && !channelName && !channelCanonicalUrl) {
            return null;
        }

        var channelAvatarUrl = String(
            this.authUser.avatarUrl ||
            raw.default_channel_thumbnail_url ||
            raw.defaultChannelThumbnailUrl ||
            raw.primary_channel_thumbnail_url ||
            raw.primaryChannelThumbnailUrl ||
            (nestedDefault && (nestedDefault.thumbnail_url || (nestedDefault.thumbnail && nestedDefault.thumbnail.url))) ||
            ""
        ).trim();

        return {
            channelId: channelId,
            channelName: channelName,
            channelAvatarUrl: channelAvatarUrl,
            channelCanonicalUrl: channelCanonicalUrl,
            isFollowing: false,
            followBusy: false
        };
    };

    App.prototype.openSignedInDefaultChannel = function () {
        var self = this;
        if (!this.authUser) {
            this.openSignInDialog();
            return Promise.resolve();
        }

        function hasReliableChannelTarget(context) {
            if (!context) {
                return false;
            }
            if (context.channelId || context.channelCanonicalUrl) {
                return true;
            }
            var channelName = String(context.channelName || "").trim();
            return !!channelName && channelName !== "My Channel";
        }

        var context = this.getDefaultChannelContextFromAuth();
        if (!hasReliableChannelTarget(context) && Odysee.api && typeof Odysee.api.checkSignedInUser === "function") {
            return Odysee.api.checkSignedInUser(this.config).then(function (refreshedUser) {
                if (refreshedUser) {
                    self.setAuthUser(refreshedUser);
                    context = self.getDefaultChannelContextFromAuth();
                }
                return self.openChannelFeed(context || {});
            }).catch(function () {
                return self.openChannelFeed(context || {});
            });
        }
        return this.openChannelFeed(context || {});
    };

    App.prototype.showAccountInitialOnly = function () {
        if (!this.nodes.accountAvatar || !this.nodes.accountInitial) {
            return;
        }
        this.nodes.accountAvatar.classList.add("hidden");
        this.nodes.accountInitial.classList.remove("hidden");
    };

    App.prototype.renderAccountBadge = function () {
        if (!this.nodes.accountBadge || !this.nodes.accountAvatar || !this.nodes.accountInitial) {
            return;
        }
        if (!this.authUser) {
            this.nodes.accountBadge.classList.add("hidden");
            this.nodes.accountAvatar.classList.add("hidden");
            this.nodes.accountInitial.classList.remove("hidden");
            this.nodes.accountAvatar.removeAttribute("src");
            this.nodes.accountBadge.setAttribute("aria-label", "Account");
            return;
        }

        this.nodes.accountBadge.classList.remove("hidden");
        var defaultChannelContext = this.getDefaultChannelContextFromAuth();
        var label = String(
            (defaultChannelContext && defaultChannelContext.channelName) ||
            this.authUser.channelName ||
            this.authUser.displayName ||
            this.authUser.email ||
            "U"
        ).trim();
        this.nodes.accountInitial.textContent = (label.charAt(0) || "U").toUpperCase();
        this.nodes.accountBadge.setAttribute("aria-label", "Open " + label + " channel");
        this.nodes.accountAvatar.setAttribute("alt", label + " avatar");

        if (this.authUser.avatarUrl) {
            this.nodes.accountAvatar.src = this.authUser.avatarUrl;
            this.nodes.accountAvatar.classList.remove("hidden");
            this.nodes.accountInitial.classList.add("hidden");
            return;
        }
        this.showAccountInitialOnly();
    };

    App.prototype.updateChannelFollowButton = function () {
        if (!this.nodes.followChannelButton) {
            return;
        }
        var channelId = this.channelContext && this.channelContext.channelId;
        var visible = !!channelId && !this.isOwnChannel(channelId);
        this.nodes.followChannelButton.classList.toggle("hidden", !visible);
        if (!visible) {
            this.nodes.followChannelButton.textContent = "Follow";
            return;
        }
        if (!this.authUser) {
            this.nodes.followChannelButton.textContent = "Follow";
            return;
        }
        if (this.channelContext.followBusy) {
            this.nodes.followChannelButton.textContent = "Working...";
            return;
        }
        this.nodes.followChannelButton.textContent = this.channelContext.isFollowing ? "Unfollow" : "Follow";
    };

    App.prototype.refreshChannelFollowState = function () {
        var self = this;
        if (!this.channelContext || !this.channelContext.channelId || !this.authUser) {
            return Promise.resolve(false);
        }
        var channelId = String(this.channelContext.channelId);
        if (this.isOwnChannel(channelId)) {
            this.channelContext.isFollowing = false;
            this.channelContext.followBusy = false;
            this.updateChannelFollowButton();
            return Promise.resolve(false);
        }
        var requestId = this.channelFollowRequestId + 1;
        this.channelFollowRequestId = requestId;
        return Odysee.api.isChannelFollowed(this.config, channelId).then(function (isFollowing) {
            if (requestId !== self.channelFollowRequestId || !self.channelContext || String(self.channelContext.channelId) !== channelId) {
                return false;
            }
            self.channelContext.isFollowing = !!isFollowing;
            self.channelContext.followBusy = false;
            self.updateChannelFollowButton();
            return !!isFollowing;
        }).catch(function () {
            if (requestId === self.channelFollowRequestId && self.channelContext && String(self.channelContext.channelId) === channelId) {
                self.channelContext.followBusy = false;
                self.updateChannelFollowButton();
            }
            return false;
        });
    };

    App.prototype.handleChannelFollowAction = function () {
        var self = this;
        if (!this.channelContext || !this.channelContext.channelId) {
            return;
        }
        if (this.isOwnChannel(this.channelContext.channelId)) {
            return;
        }
        if (!this.authUser) {
            this.openSignInDialog();
            return;
        }
        if (this.channelContext.followBusy) {
            return;
        }
        this.channelContext.followBusy = true;
        this.updateChannelFollowButton();

        var channelId = String(this.channelContext.channelId);
        var channelName = String(this.channelContext.channelName || "channel");
        var nextFollowingState = !this.channelContext.isFollowing;
        var action = this.channelContext.isFollowing ? Odysee.api.unfollowChannel : Odysee.api.followChannel;
        var args = this.channelContext.isFollowing ? [this.config, channelId] : [this.config, channelId, channelName];

        return action.apply(Odysee.api, args).then(function () {
            if (!self.channelContext || String(self.channelContext.channelId) !== channelId) {
                return;
            }
            self.channelContext.isFollowing = nextFollowingState;
            self.channelContext.followBusy = false;
            self.updateChannelFollowButton();
            self.refreshChannelFollowState();
            self.clearCategoryCache();
            self.showToast(self.channelContext.isFollowing ? "Channel followed." : "Channel unfollowed.");
        }).catch(function (error) {
            if (!self.channelContext || String(self.channelContext.channelId) !== channelId) {
                return;
            }
            self.refreshChannelFollowState().then(function (serverFollowing) {
                if (!self.channelContext || String(self.channelContext.channelId) !== channelId) {
                    return;
                }
                if (serverFollowing === nextFollowingState) {
                    self.channelContext.isFollowing = !!serverFollowing;
                    self.channelContext.followBusy = false;
                    self.updateChannelFollowButton();
                    self.clearCategoryCache();
                    self.showToast(self.channelContext.isFollowing ? "Channel followed." : "Channel unfollowed.");
                    return;
                }
                self.channelContext.followBusy = false;
                self.updateChannelFollowButton();
                self.showToast("Follow action failed: " + getErrorMessage(error));
            });
        });
    };

    App.prototype.showPlayerChannelInitialOnly = function () {
        if (!this.nodes.playerChannelAvatar || !this.nodes.playerChannelInitial) {
            return;
        }
        this.nodes.playerChannelAvatar.classList.add("hidden");
        this.nodes.playerChannelInitial.classList.remove("hidden");
    };

    App.prototype.clearPlayerChannelFocus = function () {
        if (this.nodes.playerChannelButton) {
            this.nodes.playerChannelButton.classList.remove("is-focused");
        }
    };

    App.prototype.clearPlayerFollowFocus = function () {
        if (this.nodes.playerFollowButton) {
            this.nodes.playerFollowButton.classList.remove("is-focused");
        }
    };

    App.prototype.clearPlayerReactionFocus = function () {
        if (this.nodes.playerFireButton) {
            this.nodes.playerFireButton.classList.remove("is-focused");
        }
        if (this.nodes.playerSlimeButton) {
            this.nodes.playerSlimeButton.classList.remove("is-focused");
        }
    };

    App.prototype.clearPlayerHeaderFocus = function () {
        this.clearPlayerChannelFocus();
        this.clearPlayerFollowFocus();
        this.clearPlayerReactionFocus();
    };

    App.prototype.isPlayerChannelAvailable = function () {
        if (!this.nodes.playerChannelButton) {
            return false;
        }
        if (this.nodes.playerChannelButton.classList.contains("hidden")) {
            return false;
        }
        return true;
    };

    App.prototype.isPlayerReactionAvailable = function (target) {
        if (target === "fire") {
            return !!(this.nodes.playerFireButton && !this.nodes.playerFireButton.classList.contains("hidden"));
        }
        if (target === "slime") {
            return !!(this.nodes.playerSlimeButton && !this.nodes.playerSlimeButton.classList.contains("hidden"));
        }
        return false;
    };

    App.prototype.isPlayerFollowAvailable = function () {
        return !!(this.nodes.playerFollowButton && !this.nodes.playerFollowButton.classList.contains("hidden"));
    };

    App.prototype.getPlayerHeaderFocusOrder = function () {
        var order = [];
        if (this.isPlayerChannelAvailable()) {
            order.push("channel");
        }
        if (this.isPlayerFollowAvailable()) {
            order.push("follow");
        }
        if (this.isPlayerReactionAvailable("fire")) {
            order.push("fire");
        }
        if (this.isPlayerReactionAvailable("slime")) {
            order.push("slime");
        }
        return order;
    };

    App.prototype.getPlayerHeaderNode = function (target) {
        if (target === "channel") {
            return this.nodes.playerChannelButton;
        }
        if (target === "follow") {
            return this.nodes.playerFollowButton;
        }
        if (target === "fire") {
            return this.nodes.playerFireButton;
        }
        if (target === "slime") {
            return this.nodes.playerSlimeButton;
        }
        return null;
    };

    App.prototype.updatePlayerHeaderFocus = function () {
        this.clearPlayerHeaderFocus();
        if (this.playerFocusTarget === "controls") {
            this.updatePlayerControlFocusState();
            return;
        }
        var order = this.getPlayerHeaderFocusOrder();
        if (!order.length) {
            this.playerFocusTarget = "controls";
            this.updatePlayerControlFocusState();
            return;
        }
        if (order.indexOf(this.playerFocusTarget) === -1) {
            this.playerFocusTarget = order[0];
        }
        var node = this.getPlayerHeaderNode(this.playerFocusTarget);
        if (!node) {
            this.playerFocusTarget = "controls";
            this.updatePlayerControlFocusState();
            return;
        }
        node.classList.add("is-focused");
        node.focus();
        this.updatePlayerControlFocusState();
    };

    App.prototype.updatePlayerControlFocusState = function () {
        if (!this.nodes || !this.nodes.playerControls) {
            return;
        }
        var controlsFocused = !!(this.playerOpen && this.playerFocusTarget === "controls");
        this.nodes.playerControls.classList.toggle("player-controls-focused", controlsFocused);
    };

    App.prototype.focusPlayerHeaderTarget = function (direction) {
        var order = this.getPlayerHeaderFocusOrder();
        if (!order.length) {
            this.playerFocusTarget = "controls";
            this.updatePlayerHeaderFocus();
            return;
        }

        var currentIndex = order.indexOf(this.playerFocusTarget);
        if (direction === "first") {
            this.playerFocusTarget = order[0];
        } else if (direction === "left") {
            if (currentIndex === -1) {
                this.playerFocusTarget = order[0];
            } else {
                this.playerFocusTarget = order[Math.max(0, currentIndex - 1)];
            }
        } else if (direction === "right") {
            if (currentIndex === -1) {
                this.playerFocusTarget = order[0];
            } else {
                this.playerFocusTarget = order[Math.min(order.length - 1, currentIndex + 1)];
            }
        }
        this.updatePlayerHeaderFocus();
    };

    App.prototype.handlePlayerHeaderEnter = function () {
        if (this.playerFocusTarget === "channel") {
            this.openActiveVideoChannelFromPlayer();
            return;
        }
        if (this.playerFocusTarget === "follow") {
            this.handlePlayerFollowAction();
            return;
        }
        if (this.playerFocusTarget === "fire" || this.playerFocusTarget === "slime") {
            this.handlePlayerReactionAction(this.playerFocusTarget);
        }
    };

    App.prototype.renderPlayerChannelInfo = function (video) {
        if (!this.nodes.playerChannelButton || !this.nodes.playerChannelName || !this.nodes.playerChannelInitial || !this.nodes.playerChannelAvatar) {
            return;
        }
        var channelId = String(video && video.channelClaimId || "");
        var channelName = String(video && video.channelName || "").trim();
        if (!channelId || !channelName) {
            this.nodes.playerChannelButton.classList.add("hidden");
            this.nodes.playerChannelName.textContent = "";
            this.nodes.playerChannelAvatar.removeAttribute("src");
            this.showPlayerChannelInitialOnly();
            return;
        }
        this.nodes.playerChannelButton.classList.remove("hidden");
        this.nodes.playerChannelName.textContent = channelName;
        this.nodes.playerChannelInitial.textContent = (channelName.charAt(0) || "?").toUpperCase();

        var avatarUrl = String(video && video.channelAvatarUrl || "").trim();
        if (avatarUrl) {
            this.nodes.playerChannelAvatar.src = avatarUrl;
            this.nodes.playerChannelAvatar.classList.remove("hidden");
            this.nodes.playerChannelInitial.classList.add("hidden");
        } else {
            this.nodes.playerChannelAvatar.removeAttribute("src");
            this.showPlayerChannelInitialOnly();
        }
    };

    App.prototype.resetPlayerChannelFollowState = function () {
        this.playerChannelFollowRequestId += 1;
        this.playerChannelFollowClaimId = "";
        this.playerChannelFollowKnown = false;
        this.playerChannelFollowing = false;
        this.playerChannelFollowBusy = false;
        this.renderPlayerFollowAction(this.activeVideo);
    };

    App.prototype.updatePlayerActionRowVisibility = function () {
        if (!this.nodes || !this.nodes.playerReactionActions) {
            return;
        }
        var hasFollow = !!(this.nodes.playerFollowButton && !this.nodes.playerFollowButton.classList.contains("hidden"));
        var hasFire = !!(this.nodes.playerFireButton && !this.nodes.playerFireButton.classList.contains("hidden"));
        var hasSlime = !!(this.nodes.playerSlimeButton && !this.nodes.playerSlimeButton.classList.contains("hidden"));
        this.nodes.playerReactionActions.classList.toggle("hidden", !(hasFollow || hasFire || hasSlime));
    };

    App.prototype.renderPlayerFollowAction = function (video) {
        if (!this.nodes || !this.nodes.playerFollowButton) {
            return;
        }
        var button = this.nodes.playerFollowButton;
        var channelId = normalizeClaimId(video && video.channelClaimId);
        var shouldShow = !!(
            this.authUser &&
            channelId &&
            !this.isOwnChannel(channelId) &&
            this.playerChannelFollowKnown &&
            !this.playerChannelFollowing
        );

        button.classList.toggle("hidden", !shouldShow);
        button.classList.toggle("is-busy", !!this.playerChannelFollowBusy && shouldShow);
        button.textContent = this.playerChannelFollowBusy ? "Following..." : "Follow";
        this.updatePlayerActionRowVisibility();
        this.updatePlayerHeaderFocus();
    };

    App.prototype.refreshPlayerChannelFollowState = function (video) {
        if (!video || !video.channelClaimId || !this.authUser || !Odysee.api || typeof Odysee.api.isChannelFollowed !== "function") {
            this.playerChannelFollowKnown = false;
            this.playerChannelFollowing = false;
            this.playerChannelFollowBusy = false;
            this.playerChannelFollowClaimId = "";
            this.renderPlayerFollowAction(video);
            return Promise.resolve(false);
        }
        var self = this;
        var channelId = normalizeClaimId(video.channelClaimId);
        if (!channelId) {
            this.playerChannelFollowKnown = false;
            this.playerChannelFollowing = false;
            this.playerChannelFollowBusy = false;
            this.playerChannelFollowClaimId = "";
            this.renderPlayerFollowAction(video);
            return Promise.resolve(false);
        }
        if (!this.ownedChannelsLoaded && !this.ownedChannelsLoading) {
            this.refreshOwnedChannels();
        }
        this.playerChannelFollowClaimId = channelId;
        if (this.isOwnChannel(channelId)) {
            this.playerChannelFollowKnown = true;
            this.playerChannelFollowing = true;
            this.playerChannelFollowBusy = false;
            this.renderPlayerFollowAction(video);
            return Promise.resolve(true);
        }
        this.playerChannelFollowKnown = false;
        this.playerChannelFollowing = false;
        this.playerChannelFollowBusy = false;
        this.renderPlayerFollowAction(video);

        var requestId = this.playerChannelFollowRequestId + 1;
        this.playerChannelFollowRequestId = requestId;
        return Odysee.api.isChannelFollowed(this.config, channelId).then(function (isFollowing) {
            if (requestId !== self.playerChannelFollowRequestId) {
                return false;
            }
            if (!self.activeVideo || normalizeClaimId(self.activeVideo.channelClaimId) !== channelId) {
                return false;
            }
            self.playerChannelFollowKnown = true;
            self.playerChannelFollowing = !!isFollowing;
            self.playerChannelFollowBusy = false;
            self.renderPlayerFollowAction(self.activeVideo);
            return !!isFollowing;
        }).catch(function () {
            if (requestId !== self.playerChannelFollowRequestId) {
                return false;
            }
            self.playerChannelFollowKnown = false;
            self.playerChannelFollowing = false;
            self.playerChannelFollowBusy = false;
            self.renderPlayerFollowAction(self.activeVideo);
            return false;
        });
    };

    App.prototype.handlePlayerFollowAction = function () {
        var self = this;
        var video = this.activeVideo;
        var channelId = normalizeClaimId(video && video.channelClaimId);
        if (!this.authUser || !video || !channelId || this.playerChannelFollowing || this.playerChannelFollowBusy || this.isOwnChannel(channelId)) {
            return;
        }
        if (!Odysee.api || typeof Odysee.api.followChannel !== "function") {
            return;
        }
        this.playerChannelFollowBusy = true;
        this.playerChannelFollowKnown = true;
        this.playerChannelFollowClaimId = channelId;
        this.renderPlayerFollowAction(video);

        var channelName = String(video.channelName || "channel");
        var requestId = this.playerChannelFollowRequestId + 1;
        this.playerChannelFollowRequestId = requestId;
        return Odysee.api.followChannel(this.config, channelId, channelName).then(function () {
            if (requestId !== self.playerChannelFollowRequestId) {
                return;
            }
            self.playerChannelFollowBusy = false;
            self.playerChannelFollowKnown = true;
            self.playerChannelFollowing = true;
            self.renderPlayerFollowAction(self.activeVideo);
            if (self.channelContext && normalizeClaimId(self.channelContext.channelId) === channelId) {
                self.channelContext.isFollowing = true;
                self.channelContext.followBusy = false;
                self.updateChannelFollowButton();
            }
            self.clearCategoryCache();
            self.showToast("Channel followed.");
        }).catch(function (error) {
            if (requestId !== self.playerChannelFollowRequestId) {
                return;
            }
            self.playerChannelFollowBusy = false;
            self.refreshPlayerChannelFollowState(self.activeVideo).then(function (following) {
                if (following) {
                    self.showToast("Channel followed.");
                    self.clearCategoryCache();
                    return;
                }
                self.showToast("Follow failed: " + getErrorMessage(error));
            });
        });
    };

    App.prototype.renderPlayerReactions = function (video) {
        var canShow = !!(
            this.authUser &&
            video &&
            video.claimId &&
            this.nodes.playerReactionActions &&
            this.nodes.playerFireButton &&
            this.nodes.playerSlimeButton
        );

        if (!canShow) {
            if (this.nodes.playerFireButton) {
                this.nodes.playerFireButton.classList.add("hidden");
                this.nodes.playerFireButton.classList.remove("is-active");
                this.nodes.playerFireButton.classList.remove("is-busy");
            }
            if (this.nodes.playerSlimeButton) {
                this.nodes.playerSlimeButton.classList.add("hidden");
                this.nodes.playerSlimeButton.classList.remove("is-active");
                this.nodes.playerSlimeButton.classList.remove("is-busy");
            }
            if (this.playerFocusTarget === "fire" || this.playerFocusTarget === "slime") {
                this.playerFocusTarget = this.isPlayerChannelAvailable() ? "channel" : "controls";
            }
            this.updatePlayerActionRowVisibility();
            this.updatePlayerHeaderFocus();
            return;
        }

        this.nodes.playerFireButton.classList.remove("hidden");
        this.nodes.playerSlimeButton.classList.remove("hidden");

        this.nodes.playerFireButton.classList.toggle("is-active", this.playerReaction === "like");
        this.nodes.playerSlimeButton.classList.toggle("is-active", this.playerReaction === "dislike");
        this.nodes.playerFireButton.classList.toggle("is-busy", !!this.playerReactionBusy);
        this.nodes.playerSlimeButton.classList.toggle("is-busy", !!this.playerReactionBusy);
        this.updatePlayerActionRowVisibility();
        this.updatePlayerHeaderFocus();
    };

    App.prototype.clearPlayerReactions = function () {
        this.playerReaction = "";
        this.playerReactionBusy = false;
        this.playerReactionClaimId = "";
        this.renderPlayerReactions(null);
    };

    App.prototype.fetchPlayerReactions = function (video) {
        var self = this;
        if (!video || !video.claimId || !this.authUser || !Odysee.api || typeof Odysee.api.listClaimReactions !== "function") {
            return Promise.resolve();
        }
        var claimId = String(video.claimId || "");
        if (!claimId) {
            return Promise.resolve();
        }
        var requestId = this.playerReactionRequestId + 1;
        this.playerReactionRequestId = requestId;
        this.playerReactionClaimId = claimId;
        this.playerReactionBusy = true;
        this.renderPlayerReactions(video);

        return Odysee.api.listClaimReactions(this.config, claimId).then(function (payload) {
            if (requestId !== self.playerReactionRequestId || !self.activeVideo || String(self.activeVideo.claimId || "") !== claimId) {
                return;
            }
            self.playerReactionBusy = false;
            self.playerReaction = getMyClaimReaction(payload, claimId);
            self.renderPlayerReactions(self.activeVideo);
        }).catch(function (error) {
            if (requestId !== self.playerReactionRequestId || !self.activeVideo || String(self.activeVideo.claimId || "") !== claimId) {
                return;
            }
            self.playerReactionBusy = false;
            self.playerReaction = "";
            self.renderPlayerReactions(self.activeVideo);
            debug.warn("[app] reaction list failed", getErrorMessage(error));
        });
    };

    App.prototype.handlePlayerReactionAction = function (target) {
        var self = this;
        if (!this.authUser || !this.activeVideo || !this.activeVideo.claimId) {
            this.openSignInDialog();
            return;
        }
        if (this.playerReactionBusy || !Odysee.api || typeof Odysee.api.reactToClaim !== "function") {
            return;
        }

        var claimId = String(this.activeVideo.claimId || "");
        var reactionType = target === "slime" ? "dislike" : "like";
        var shouldRemove = this.playerReaction === reactionType;
        var requestId = this.playerReactionRequestId + 1;
        this.playerReactionRequestId = requestId;
        this.playerReactionClaimId = claimId;
        this.playerReactionBusy = true;
        this.renderPlayerReactions(this.activeVideo);

        Odysee.api.reactToClaim(this.config, claimId, reactionType, shouldRemove).then(function () {
            if (requestId !== self.playerReactionRequestId || !self.activeVideo || String(self.activeVideo.claimId || "") !== claimId) {
                return;
            }
            self.playerReactionBusy = false;
            self.playerReaction = shouldRemove ? "" : reactionType;
            self.renderPlayerReactions(self.activeVideo);
        }).catch(function (error) {
            if (requestId !== self.playerReactionRequestId || !self.activeVideo || String(self.activeVideo.claimId || "") !== claimId) {
                return;
            }
            self.playerReactionBusy = false;
            self.renderPlayerReactions(self.activeVideo);
            self.showToast("Reaction failed: " + getErrorMessage(error));
        });
    };

    App.prototype.clearPlayerChannelInfo = function () {
        if (!this.nodes.playerChannelButton || !this.nodes.playerChannelName || !this.nodes.playerChannelAvatar) {
            return;
        }
        this.nodes.playerChannelButton.classList.add("hidden");
        this.nodes.playerChannelName.textContent = "";
        this.nodes.playerChannelAvatar.removeAttribute("src");
        this.showPlayerChannelInitialOnly();
        this.clearPlayerHeaderFocus();
    };

    App.prototype.openSignInDialog = function () {
        if (!this.nodes.authModal || !this.nodes.authPrimary) {
            this.showToast("Sign-in UI unavailable.");
            return;
        }
        if (this.searchOpen) {
            this.closeSearchDialog();
        }

        this.authOpen = true;
        if (this.authUser) {
            this.authStage = "signed-in";
        } else if (this.authPendingEmail) {
            this.authStage = "pending";
        } else {
            this.authStage = "collect";
        }
        this.authDialogFocus = this.authStage === "collect" ? 0 : 1;
        this.authChannelLoading = false;
        this.authChannels = [];
        this.authChannelIndex = 0;

        this.nodes.authModal.classList.remove("hidden");
        this.renderAuthDialogState();
    };

    App.prototype.renderAuthChannelList = function () {
        if (!this.nodes.authChannelList) {
            return;
        }
        this.nodes.authChannelList.innerHTML = "";
        if (this.authChannelLoading) {
            var loadingEl = document.createElement("div");
            loadingEl.className = "auth-channel-row";
            loadingEl.textContent = "Loading channels...";
            this.nodes.authChannelList.appendChild(loadingEl);
            return;
        }
        if (!this.authChannels.length) {
            var emptyEl = document.createElement("div");
            emptyEl.className = "auth-channel-row";
            emptyEl.textContent = "No channels found.";
            this.nodes.authChannelList.appendChild(emptyEl);
            return;
        }
        for (var i = 0; i < this.authChannels.length; i += 1) {
            var channel = this.authChannels[i];
            var row = document.createElement("div");
            row.className = "auth-channel-row";
            if (i === this.authChannelIndex) {
                row.classList.add("is-selected");
            }
            var avatarWrap = document.createElement("span");
            avatarWrap.className = "auth-channel-avatar-wrap";

            var avatarImg = document.createElement("img");
            avatarImg.className = "auth-channel-avatar hidden";
            avatarImg.alt = "";

            var avatarFallback = document.createElement("span");
            avatarFallback.className = "auth-channel-avatar-fallback";

            var channelLabel = String(channel.channelName || "").trim() || ("Channel " + (i + 1));
            avatarFallback.textContent = (channelLabel.charAt(0) || "?").toUpperCase();

            if (channel.channelAvatarUrl) {
                avatarImg.src = channel.channelAvatarUrl;
                avatarImg.classList.remove("hidden");
                avatarFallback.classList.add("hidden");
                avatarImg.addEventListener("error", function () {
                    this.classList.add("hidden");
                    if (this.nextSibling && this.nextSibling.classList) {
                        this.nextSibling.classList.remove("hidden");
                    }
                });
            }

            avatarWrap.appendChild(avatarImg);
            avatarWrap.appendChild(avatarFallback);

            var body = document.createElement("span");
            body.className = "auth-channel-body";

            var title = document.createElement("span");
            title.className = "auth-channel-name";
            title.textContent = channelLabel;
            body.appendChild(title);

            var meta = document.createElement("span");
            meta.className = "auth-channel-meta";
            var metaParts = [];
            if (channel.channelHandle && channel.channelHandle !== channelLabel) {
                metaParts.push(channel.channelHandle);
            }
            if (typeof channel.channelVideoCount === "number" && isFinite(channel.channelVideoCount) && channel.channelVideoCount >= 0) {
                var videoCount = Math.round(channel.channelVideoCount);
                metaParts.push(videoCount.toLocaleString() + " videos");
            }
            meta.textContent = metaParts.join(" • ") || "Channel profile";
            body.appendChild(meta);

            row.appendChild(avatarWrap);
            row.appendChild(body);
            this.nodes.authChannelList.appendChild(row);
        }
    };

    App.prototype.loadAuthChannels = function () {
        var self = this;
        if (!this.authUser || !Odysee.api || typeof Odysee.api.listMyChannels !== "function") {
            return Promise.resolve();
        }
        this.authChannelLoading = true;
        this.renderAuthChannelList();
        return Odysee.api.listMyChannels(this.config).then(function (channels) {
            self.authChannelLoading = false;
            self.authChannels = Array.isArray(channels) ? channels : [];
            var currentContext = self.getDefaultChannelContextFromAuth();
            var selectedIndex = 0;
            if (currentContext && currentContext.channelId) {
                for (var i = 0; i < self.authChannels.length; i += 1) {
                    if (String(self.authChannels[i].channelId || "") === String(currentContext.channelId)) {
                        selectedIndex = i;
                        break;
                    }
                }
            }
            self.authChannelIndex = Math.max(0, Math.min(selectedIndex, Math.max(0, self.authChannels.length - 1)));
            self.renderAuthChannelList();
            self.updateAuthDialogFocus();
        }).catch(function () {
            self.authChannelLoading = false;
            self.authChannels = [];
            self.authChannelIndex = 0;
            self.renderAuthChannelList();
            self.updateAuthDialogFocus();
        });
    };

    App.prototype.openSwitchChannelStage = function () {
        if (!this.authUser) {
            return;
        }
        this.authStage = "switch-channel";
        this.authDialogFocus = 0;
        this.renderAuthDialogState();
        this.loadAuthChannels();
    };

    App.prototype.applySelectedDefaultChannel = function () {
        var self = this;
        if (this.authBusy || this.authChannelLoading || !this.authChannels.length) {
            return;
        }
        var selected = this.authChannels[this.authChannelIndex];
        if (!selected || !selected.channelId || !Odysee.api || typeof Odysee.api.setDefaultChannel !== "function") {
            this.showToast("Channel selection unavailable.");
            return;
        }
        this.authBusy = true;
        if (this.nodes.authMessage) {
            this.nodes.authMessage.textContent = "Switching default channel...";
        }
        Odysee.api.setDefaultChannel(this.config, selected.channelId).then(function () {
            var nextUser = Object.assign({}, self.authUser || {});
            nextUser.defaultChannelClaimId = selected.channelId;
            nextUser.defaultChannelUri = selected.channelCanonicalUrl || nextUser.defaultChannelUri || "";
            nextUser.channelName = selected.channelName || nextUser.channelName || "";
            nextUser.defaultChannelName = selected.channelName || nextUser.defaultChannelName || "";
            if (selected.channelAvatarUrl) {
                nextUser.avatarUrl = selected.channelAvatarUrl;
            }
            self.setAuthUser(nextUser);
            self.authBusy = false;
            self.authStage = "signed-in";
            self.renderAuthDialogState();
            self.showToast("Default channel updated.");
        }).catch(function (error) {
            self.authBusy = false;
            self.authStage = "switch-channel";
            self.renderAuthDialogState();
            self.showToast("Could not switch channel: " + getErrorMessage(error));
        });
    };

    App.prototype.closeSignInDialog = function () {
        if (!this.authOpen) {
            return;
        }
        this.authOpen = false;
        this.authBusy = false;
        this.stopAuthPolling();
        this.clearAuthDialogFocus();
        if (this.nodes.authModal) {
            this.nodes.authModal.classList.add("hidden");
        }
        this.applyFocus();
    };

    App.prototype.renderAuthDialogState = function () {
        if (!this.nodes.authModal || !this.nodes.authPrimary || !this.nodes.authMessage || !this.nodes.authEmailInput) {
            return;
        }

        var showEmail = this.authStage === "collect";
        var showPending = this.authStage === "pending";
        var showChannelList = this.authStage === "switch-channel";
        this.nodes.authEmailInput.classList.toggle("auth-email-hidden", !showEmail);
        if (this.nodes.authPendingStatus) {
            this.nodes.authPendingStatus.classList.toggle("hidden", !showPending);
        }
        if (this.nodes.authChannelList) {
            this.nodes.authChannelList.classList.toggle("hidden", !showChannelList);
        }
        if (this.nodes.authSignOut) {
            this.nodes.authSignOut.classList.add("hidden");
        }
        this.nodes.authPrimary.classList.toggle("auth-primary-hidden", showPending);

        if (this.authStage === "signed-in") {
            this.stopAuthPolling();
            var accountLabel = this.authUser && this.authUser.email ? this.authUser.email : "Signed in account";
            this.nodes.authTitle.textContent = "Account";
            this.nodes.authMessage.textContent = "You are signed in as " + accountLabel + ".";
            this.nodes.authPrimary.textContent = "Switch Channel";
            this.nodes.authCancel.textContent = "Cancel";
            if (this.nodes.authSignOut) {
                this.nodes.authSignOut.classList.remove("hidden");
            }
            this.authDialogFocus = 2;
        } else if (this.authStage === "switch-channel") {
            this.stopAuthPolling();
            this.nodes.authTitle.textContent = "Choose Default Channel";
            this.nodes.authMessage.textContent = "Select the channel to use by default.";
            this.nodes.authPrimary.textContent = "Use Selected";
            this.nodes.authCancel.textContent = "Back";
            this.authDialogFocus = 0;
            this.renderAuthChannelList();
        } else if (this.authStage === "pending") {
            this.startAuthPolling();
            this.nodes.authTitle.textContent = "Check Your Email";
            this.nodes.authMessage.textContent = "Open the sign-in link sent to " + this.authPendingEmail + ".";
            this.nodes.authCancel.textContent = "Cancel";
            this.authDialogFocus = 2;
        } else {
            this.stopAuthPolling();
            this.nodes.authTitle.textContent = "Sign In";
            this.nodes.authMessage.textContent = "Enter your email to receive a secure sign-in link.";
            this.nodes.authPrimary.textContent = "Send Link";
            this.nodes.authCancel.textContent = "Cancel";
            this.nodes.authEmailInput.value = this.authPendingEmail || "";
            this.authDialogFocus = 0;
        }

        this.updateAuthDialogFocus();
    };

    App.prototype.handleAuthKey = function (code) {
        if (code === KEY.BACK) {
            this.closeSignInDialog();
            return true;
        }
        if (code === KEY.DOWN) {
            if (this.authStage === "switch-channel") {
                if (this.authDialogFocus === 0 && this.authChannels.length > 0) {
                    this.authChannelIndex = Math.min(this.authChannels.length - 1, this.authChannelIndex + 1);
                    this.renderAuthChannelList();
                    this.updateAuthDialogFocus();
                } else if (this.authDialogFocus === 0) {
                    this.authDialogFocus = 1;
                    this.updateAuthDialogFocus();
                } else if (this.authDialogFocus !== 2) {
                    this.authDialogFocus = 2;
                    this.updateAuthDialogFocus();
                }
                return true;
            }
            if (this.authStage === "collect" && this.authDialogFocus === 0) {
                this.authDialogFocus = 1;
                this.updateAuthDialogFocus();
            }
            return true;
        }
        if (code === KEY.UP) {
            if (this.authStage === "switch-channel") {
                if (this.authDialogFocus === 0 && this.authChannels.length > 0) {
                    this.authChannelIndex = Math.max(0, this.authChannelIndex - 1);
                    this.renderAuthChannelList();
                    this.updateAuthDialogFocus();
                } else if (this.authDialogFocus !== 0) {
                    this.authDialogFocus = 0;
                    this.updateAuthDialogFocus();
                }
                return true;
            }
            if (this.authStage === "collect" && this.authDialogFocus !== 0) {
                this.authDialogFocus = 0;
                this.updateAuthDialogFocus();
            }
            return true;
        }
        if (code === KEY.LEFT) {
            if (this.authStage === "signed-in") {
                if (this.authDialogFocus === 3) {
                    this.authDialogFocus = 2;
                } else if (this.authDialogFocus === 2) {
                    this.authDialogFocus = 1;
                }
                this.updateAuthDialogFocus();
                return true;
            }
            if (this.authStage === "switch-channel") {
                if (this.authDialogFocus === 2) {
                    this.authDialogFocus = 1;
                    this.updateAuthDialogFocus();
                } else if (this.authDialogFocus === 1) {
                    this.authDialogFocus = 0;
                    this.updateAuthDialogFocus();
                }
                return true;
            }
            if (this.authDialogFocus === 2 && this.isAuthPrimaryInteractive()) {
                this.authDialogFocus = 1;
                this.updateAuthDialogFocus();
            }
            return true;
        }
        if (code === KEY.RIGHT) {
            if (this.authStage === "signed-in") {
                if (this.authDialogFocus === 1) {
                    this.authDialogFocus = 2;
                } else if (this.authDialogFocus === 2) {
                    this.authDialogFocus = 3;
                }
                this.updateAuthDialogFocus();
                return true;
            }
            if (this.authStage === "switch-channel") {
                if (this.authDialogFocus === 0) {
                    this.authDialogFocus = 1;
                    this.updateAuthDialogFocus();
                } else if (this.authDialogFocus === 1) {
                    this.authDialogFocus = 2;
                    this.updateAuthDialogFocus();
                }
                return true;
            }
            if (this.authDialogFocus === 1) {
                this.authDialogFocus = 2;
                this.updateAuthDialogFocus();
            }
            return true;
        }
        if (code === KEY.ENTER) {
            if (this.authDialogFocus === 2) {
                this.handleAuthCancelAction();
            } else if (this.authDialogFocus === 3 && this.authStage === "signed-in") {
                this.signOutCurrentUser();
            } else if (this.isAuthPrimaryInteractive()) {
                this.handleAuthPrimaryAction();
            } else if (this.authStage === "switch-channel" && this.authDialogFocus === 0) {
                this.applySelectedDefaultChannel();
            }
            return true;
        }
        return false;
    };

    App.prototype.isAuthPrimaryInteractive = function () {
        if (!this.nodes.authPrimary) {
            return false;
        }
        return !this.nodes.authPrimary.classList.contains("auth-primary-hidden");
    };

    App.prototype.clearAuthDialogFocus = function () {
        if (this.nodes.authEmailInput) {
            this.nodes.authEmailInput.classList.remove("is-focused");
        }
        if (this.nodes.authChannelList) {
            this.nodes.authChannelList.classList.remove("is-focused");
        }
        if (this.nodes.authPrimary) {
            this.nodes.authPrimary.classList.remove("is-focused");
        }
        if (this.nodes.authCancel) {
            this.nodes.authCancel.classList.remove("is-focused");
        }
        if (this.nodes.authSignOut) {
            this.nodes.authSignOut.classList.remove("is-focused");
        }
    };

    App.prototype.updateAuthDialogFocus = function () {
        this.clearAuthDialogFocus();

        if (this.authStage === "signed-in") {
            if (this.authDialogFocus === 3 && this.nodes.authSignOut && !this.nodes.authSignOut.classList.contains("hidden")) {
                this.nodes.authSignOut.classList.add("is-focused");
                this.nodes.authSignOut.focus();
                return;
            }
            if (this.authDialogFocus === 2 && this.nodes.authCancel) {
                this.nodes.authCancel.classList.add("is-focused");
                this.nodes.authCancel.focus();
                return;
            }
            this.authDialogFocus = 1;
            if (this.nodes.authPrimary) {
                this.nodes.authPrimary.classList.add("is-focused");
                this.nodes.authPrimary.focus();
            }
            return;
        }

        if (this.authStage === "switch-channel") {
            if (this.authDialogFocus === 0) {
                if (this.nodes.authChannelList) {
                    this.nodes.authChannelList.classList.add("is-focused");
                    this.nodes.authChannelList.focus();
                }
                return;
            }
            if (this.authDialogFocus === 2) {
                if (this.nodes.authCancel) {
                    this.nodes.authCancel.classList.add("is-focused");
                    this.nodes.authCancel.focus();
                }
                return;
            }
            this.authDialogFocus = 1;
            if (this.nodes.authPrimary) {
                this.nodes.authPrimary.classList.add("is-focused");
                this.nodes.authPrimary.focus();
            }
            return;
        }

        if (this.authStage === "collect" && this.authDialogFocus === 0) {
            if (this.nodes.authEmailInput) {
                this.nodes.authEmailInput.classList.add("is-focused");
                this.nodes.authEmailInput.focus();
                this.nodes.authEmailInput.select();
            }
            return;
        }

        if (this.authDialogFocus === 1 && !this.isAuthPrimaryInteractive()) {
            this.authDialogFocus = 2;
        }

        if (this.authDialogFocus === 2) {
            if (this.nodes.authCancel) {
                this.nodes.authCancel.classList.add("is-focused");
                this.nodes.authCancel.focus();
            }
            return;
        }

        this.authDialogFocus = 1;
        if (this.nodes.authPrimary) {
            this.nodes.authPrimary.classList.add("is-focused");
            this.nodes.authPrimary.focus();
        }
    };

    App.prototype.handleAuthPrimaryAction = function () {
        if (this.authBusy) {
            return;
        }
        if (this.authStage === "signed-in") {
            this.openSwitchChannelStage();
            return;
        }
        if (this.authStage === "switch-channel") {
            this.applySelectedDefaultChannel();
            return;
        }
        this.startMagicLinkSignIn();
    };

    App.prototype.handleAuthCancelAction = function () {
        if (this.authStage === "switch-channel") {
            this.authStage = "signed-in";
            this.renderAuthDialogState();
            return;
        }
        this.closeSignInDialog();
    };

    App.prototype.startMagicLinkSignIn = function () {
        var email = String(this.nodes.authEmailInput && this.nodes.authEmailInput.value || "").trim().toLowerCase();
        if (!isValidEmail(email)) {
            this.showToast("Enter a valid email.");
            return;
        }

        var self = this;
        this.authBusy = true;
        this.nodes.authMessage.textContent = "Sending sign-in link...";
        Odysee.api.requestMagicLink(this.config, email).then(function () {
            self.authBusy = false;
            self.authPendingEmail = email;
            self.authStage = "pending";
            self.renderAuthDialogState();
            self.setStatus("Sign-in email sent.");
            self.showToast("Magic link sent.");
        }).catch(function (error) {
            var message = getErrorMessage(error);
            self.authBusy = false;
            self.authStage = "collect";
            self.renderAuthDialogState();
            self.setStatus("Sign-in failed: " + message);
            if (/no account|not found|404/i.test(message)) {
                self.showToast("No account found for that email.");
                self.nodes.authMessage.textContent = "No account found. Create it on Odysee web first.";
            } else {
                self.showToast("Could not send sign-in link.");
            }
        });
    };

    App.prototype.verifyMagicLinkSignIn = function (showToastWhenPending) {
        var self = this;
        this.authBusy = !!showToastWhenPending;
        return Odysee.api.checkSignedInUser(this.config).then(function (user) {
            self.authBusy = false;
            if (user) {
                self.setAuthUser(user);
                self.authStage = "signed-in";
                self.authPendingEmail = "";
                self.setStatus("Signed in as " + (user.email || "account"));
                self.showToast("Signed in successfully.");
                if (self.authOpen) {
                    self.closeSignInDialog();
                }
                self.openFollowingHome();
                return;
            }
            if (self.authStage !== "pending") {
                self.authStage = "pending";
                self.renderAuthDialogState();
            }
            if (showToastWhenPending) {
                self.showToast("Still waiting for link confirmation.");
            }
        }).catch(function (error) {
            self.authBusy = false;
            if (self.authStage !== "pending") {
                self.authStage = "pending";
                self.renderAuthDialogState();
            }
            self.setStatus("Sign-in check failed: " + getErrorMessage(error));
            if (showToastWhenPending) {
                self.showToast("Could not verify sign-in yet.");
            }
        });
    };

    App.prototype.openFollowingHome = function () {
        var followingIndex = -1;
        for (var i = 0; i < this.categories.length; i += 1) {
            if (String(this.categories[i] && this.categories[i].id || "").toLowerCase() === "following") {
                followingIndex = i;
                break;
            }
        }
        if (followingIndex < 0) {
            return;
        }
        this.focus.setZone("sidebar", followingIndex);
        this.focus.setIndex("sidebar", followingIndex);
        this.renderCategories();
        this.applyFocus();
        this.loadCategory(followingIndex);
    };

    App.prototype.signOutCurrentUser = function () {
        var self = this;
        this.authBusy = true;
        this.stopAuthPolling();
        this.nodes.authMessage.textContent = "Signing out...";
        Odysee.api.signOutUser(this.config).then(function () {
            self.authBusy = false;
            self.setAuthUser(null);
            self.authStage = "collect";
            self.authPendingEmail = "";
            self.renderAuthDialogState();
            self.setStatus("Signed out.");
            self.showToast("Signed out.");
        }).catch(function (error) {
            self.authBusy = false;
            self.authStage = "signed-in";
            self.renderAuthDialogState();
            self.setStatus("Sign-out failed: " + getErrorMessage(error));
            self.showToast("Sign-out failed.");
        });
    };

    App.prototype.startAuthPolling = function () {
        var self = this;
        if (!this.authOpen || this.authStage !== "pending" || this.authPollTimer) {
            return;
        }
        this.authPollTimer = setTimeout(function () {
            self.authPollTimer = null;
            if (!self.authOpen || self.authStage !== "pending") {
                return;
            }
            self.verifyMagicLinkSignIn(false).then(function () {
                self.startAuthPolling();
            }).catch(function () {
                self.startAuthPolling();
            });
        }, 5000);
    };

    App.prototype.stopAuthPolling = function () {
        if (!this.authPollTimer) {
            return;
        }
        clearTimeout(this.authPollTimer);
        this.authPollTimer = null;
    };

    App.prototype.performSearch = function (query) {
        var self = this;
        this.channelContext = null;
        this.activeDynamicCategory = null;
        this.updateChannelFollowButton();
        this.currentSearchQuery = query;
        this.setStatus("Searching for \"" + query + "\"...");
        this.setPageTitle('Search: "' + query + '"', true);
        this.nodes.contentMeta.textContent = "";
        this.resetVideoGridScroll();
        return Odysee.api.searchVideos(this.config, query).then(function (videos) {
            self.activeGridCategoryId = "search:" + String(query || "").trim().toLowerCase();
            self.videos = videos;
            self.renderVideos();
            self.setStatus("Search complete.");
            if (!videos.length) {
                self.showToast("No search results.");
                self.focus.setZone("sidebar", self.focus.getIndex("sidebar"));
                self.applyFocus();
                return;
            }
            self.focus.setZone("grid", 0);
            self.applyFocus();
            self.showToast("Search complete.");
        }).catch(function (error) {
            self.activeGridCategoryId = "search:" + String(query || "").trim().toLowerCase();
            self.videos = [];
            self.renderVideos();
            self.setStatus("Search failed: " + getErrorMessage(error));
            self.showToast("Search failed.");
        });
    };

    App.prototype.reportPlayerError = function (error) {
        this.updatePlayerTransportState("error");
        this.showToast("Playback action failed.");
    };

    App.prototype.handleBack = function () {
        if (this.focus.getZone() === "topbar") {
            this.focus.setZone("sidebar", this.focus.getIndex("sidebar"));
            this.renderCategories();
            this.applyFocus();
            return;
        }
        if (this.focus.getZone() === "grid") {
            this.focus.setZone("sidebar", this.focus.getIndex("sidebar"));
            this.renderCategories();
            this.applyFocus();
            return;
        }

        var now = Date.now();
        if (now - this.backPressAt < 2000) {
            Odysee.platform.exitApp();
            return;
        }
        this.backPressAt = now;
        this.showToast("Press Back again to exit.");
    };

    App.prototype.setStatus = function (message) {
        if (!this.nodes || !this.nodes.statusText) {
            return;
        }
        this.nodes.statusText.textContent = "";
    };

    App.prototype.setPageTitle = function (value, visible) {
        var text = String(value || "");
        var showTitle = !!visible;
        if (this.nodes.pageTitle) {
            this.nodes.pageTitle.textContent = showTitle ? text : "";
            if (showTitle) {
                this.nodes.pageTitle.classList.remove("is-hidden");
            } else {
                this.nodes.pageTitle.classList.add("is-hidden");
            }
        }
        if (this.nodes.contentTitle) {
            this.nodes.contentTitle.textContent = text;
        }
    };

    App.prototype.scheduleFocusedCategoryLoad = function (index) {
        var self = this;
        if (!this.categories || !this.categories[index]) {
            return;
        }
        this.selectedCategoryId = String(this.categories[index].id || "");
        if (this.categoryChangeTimer) {
            clearTimeout(this.categoryChangeTimer);
            this.categoryChangeTimer = null;
        }
        this.categoryChangeTimer = setTimeout(function () {
            self.categoryChangeTimer = null;
            if (self.focus.getZone() !== "sidebar") {
                return;
            }
            if (self.focus.getIndex("sidebar") !== index) {
                return;
            }
            self.loadCategory(index);
        }, 150);
    };

    App.prototype.showToast = function (message) {
        var self = this;
        this.nodes.toast.textContent = message;
        this.nodes.toast.classList.remove("hidden");
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(function () {
            self.nodes.toast.classList.add("hidden");
        }, 2200);
    };

    App.prototype.resetVideoGridScroll = function () {
        if (!this.nodes || !this.nodes.videoGrid) {
            return;
        }
        this.nodes.videoGrid.scrollTop = 0;
        this.nodes.videoGrid.scrollLeft = 0;
    };

    function escapeHtml(value) {
        return String(value || "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/`/g, "");
    }

    function isValidEmail(value) {
        var email = String(value || "").trim();
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    function getMyClaimReaction(payload, claimId) {
        var normalizedClaimId = String(claimId || "").toLowerCase();
        if (!payload || !normalizedClaimId) {
            return "";
        }
        var myReactions = payload.my_reactions || payload.myReactions || payload.reactions || {};
        if (!myReactions || typeof myReactions !== "object") {
            return "";
        }

        var reactionEntry = myReactions[claimId] || myReactions[normalizedClaimId];
        if (!reactionEntry && typeof myReactions === "object") {
            var keys = Object.keys(myReactions);
            for (var i = 0; i < keys.length; i += 1) {
                if (String(keys[i] || "").toLowerCase() === normalizedClaimId) {
                    reactionEntry = myReactions[keys[i]];
                    break;
                }
            }
        }
        if (!reactionEntry || typeof reactionEntry !== "object") {
            return "";
        }
        if (Number(reactionEntry.like || 0) > 0) {
            return "like";
        }
        if (Number(reactionEntry.dislike || 0) > 0) {
            return "dislike";
        }
        return "";
    }

    function formatDuration(ms) {
        var totalSeconds = Math.floor((Number(ms) || 0) / 1000);
        if (totalSeconds < 0) {
            totalSeconds = 0;
        }
        var hours = Math.floor(totalSeconds / 3600);
        var minutes = Math.floor((totalSeconds % 3600) / 60);
        var seconds = totalSeconds % 60;

        if (hours > 0) {
            return hours + ":" + pad2(minutes) + ":" + pad2(seconds);
        }
        return pad2(minutes) + ":" + pad2(seconds);
    }

    function formatVideoCardDuration(secondsValue) {
        var totalSeconds = Math.floor(Number(secondsValue) || 0);
        if (!isFinite(totalSeconds) || totalSeconds <= 0) {
            return "";
        }
        var hours = Math.floor(totalSeconds / 3600);
        var minutes = Math.floor((totalSeconds % 3600) / 60);
        var seconds = totalSeconds % 60;
        if (hours > 0) {
            return hours + ":" + pad2(minutes) + ":" + pad2(seconds);
        }
        return minutes + ":" + pad2(seconds);
    }

    function formatVideoCardAge(publishTimeValue) {
        var publish = Number(publishTimeValue || 0);
        if (!isFinite(publish) || publish <= 0) {
            return "";
        }
        if (publish > 1000000000000) {
            publish = Math.floor(publish / 1000);
        }
        var now = Math.floor(Date.now() / 1000);
        if (!isFinite(now) || now <= 0) {
            return "";
        }
        var diff = now - Math.floor(publish);
        if (!isFinite(diff)) {
            return "";
        }
        if (diff < 0) {
            diff = 0;
        }

        if (diff < 60) {
            return "just now";
        }
        if (diff < 3600) {
            return formatCountWithUnit(Math.floor(diff / 60), "minute");
        }
        if (diff < 86400) {
            return formatCountWithUnit(Math.floor(diff / 3600), "hour");
        }
        if (diff < 2592000) {
            return formatCountWithUnit(Math.floor(diff / 86400), "day");
        }
        if (diff < 31536000) {
            return formatCountWithUnit(Math.floor(diff / 2592000), "month");
        }
        return formatCountWithUnit(Math.floor(diff / 31536000), "year");
    }

    function formatCountWithUnit(countValue, unit) {
        var count = Math.max(1, Number(countValue) || 0);
        if (count === 1) {
            return "1 " + unit + " ago";
        }
        return count + " " + unit + "s ago";
    }

    function pad2(value) {
        var number = Number(value) || 0;
        if (number < 10) {
            return "0" + number;
        }
        return String(number);
    }

    var CATEGORY_ICON_MAP = createCategoryIconMap();

    function buildStrokeCategoryIcon(viewBox, content, strokeWidth) {
        return (
            '<svg class="category-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="' + viewBox +
            '" fill="none" stroke="currentColor" stroke-width="' + (strokeWidth || "1.8") +
            '" stroke-linecap="round" stroke-linejoin="round" focusable="false" aria-hidden="true">' +
            content +
            "</svg>"
        );
    }

    function buildFillCategoryIcon(viewBox, content) {
        return (
            '<svg class="category-icon-svg category-icon-svg-filled" xmlns="http://www.w3.org/2000/svg" viewBox="' + viewBox +
            '" fill="currentColor" stroke="none" focusable="false" aria-hidden="true">' +
            content +
            "</svg>"
        );
    }

    function createCategoryIconMap() {
        return {
            following: buildStrokeCategoryIcon(
                "0 0 24 24",
                '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'
            ),
            watchlater: buildStrokeCategoryIcon(
                "0 0 24 24",
                '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'
            ),
            featured: buildFillCategoryIcon(
                "0 0 22 22",
                '<path d="M11 3L13.2627 8.73726L19 11L13.2627 13.2627L11 19L8.73726 13.2627L3 11L8.73726 8.73726L11 3Z"/>'
            ),
            discover: buildStrokeCategoryIcon(
                "0 0 24 24",
                '<circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>'
            ),
            trending: buildStrokeCategoryIcon(
                "0 0 24 24",
                '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'
            ),
            gaming: buildStrokeCategoryIcon(
                "0 0 20 20",
                '<path d="M18 5.49925L10.1096 10L18 14.5007C16.4248 17.1904 13.4811 19 10.1096 19C5.07849 19 1 14.9706 1 10C1 5.02944 5.07849 1 10.1096 1C13.4811 1 16.4248 2.80956 18 5.49925Z"/>',
                "1.6"
            ),
            news: buildStrokeCategoryIcon(
                "0 0 21 18",
                '<path d="M17.7553 6.50001L19.7553 6.00001M17.7553 11L19.7553 11.5M16.2553 2.00001L17.3262 1M3.17018 8.10369L2.98445 8.23209C2.85036 8.32478 2.70264 8.3958 2.56048 8.47556C1.88883 8.85235 1.38281 9.7222 1.52367 10.5694C1.6624 11.4038 2.3113 12.0619 3.14392 12.2112L4.75526 12.5L4.75528 14.5L5.30241 16.292C5.43083 16.7126 5.81901 17 6.25882 17H8.69504M3.17018 8.10369L12.2582 2.84235M3.17018 8.10369L4.00718 12.1694L14.0948 12.5372M8.69504 17H9M8.69504 17L7.75527 14.5L7.75529 12.5M12.2553 2.00001L13.2553 7.50001L14.2553 13.5M14.1875 8.6648C14.8624 8.53243 15.3022 7.87802 15.1698 7.20313C15.0375 6.52824 14.383 6.08843 13.7082 6.22079"/>',
                "1.5"
            ),
            science: buildStrokeCategoryIcon(
                "0 0 24 24",
                '<path d="M6 2h8"/><path d="M8 2v8l-5 9a2.3 2.3 0 0 0 2 3h14a2.3 2.3 0 0 0 2-3l-5-9V2"/><line x1="7" y1="14" x2="17" y2="14"/><path d="M9 18a1 1 0 1 0 0.01 0"/><path d="M14 17.5a1.6 1.6 0 1 0 0.01 0"/>'
            ),
            music: buildStrokeCategoryIcon(
                "0 0 19 20",
                '<path d="M6.5 14.5V5.26667L17.5 2V12.5M7 16C7 17.6569 5.65685 19 4 19C2.34315 19 1 17.6569 1 16C1 14.3431 2.34315 13 4 13C5.65685 13 7 14.3431 7 16ZM18 14C18 15.6569 16.6569 17 15 17C13.3431 17 12 15.6569 12 14C12 12.3431 13.3431 11 15 11C16.6569 11 18 12.3431 18 14Z"/>',
                "1.7"
            ),
            comedy: buildStrokeCategoryIcon(
                "0 0 19 20",
                '<path d="M6.00003 12.5C7.54095 14.8536 10.6667 15.7483 13.5 12.5M8.50003 8C7.50003 7 6.00003 7 5.00003 7.99998M14.5 7.99999C13.25 6.99997 12 7.00001 11 8M1 2C5.92105 3.78947 13.0789 3.34211 18 2V4.80013C18 9.80277 16.5622 15.1759 12.4134 17.9713C10.3659 19.3508 8.5887 19.4007 6.26359 17.7683C2.35369 15.0233 1 9.95156 1 5.17427V2Z"/>',
                "1.6"
            ),
            sports: buildStrokeCategoryIcon(
                "0 0 21 20",
                '<path d="M3.21009 5.08508C6.58582 7.0833 10.5321 12.6392 8.49668 18.4082M17.7408 14.398C13.2297 12.6201 10.8457 6.80095 13.2476 1.69871M19.5 10C19.5 14.9706 15.4706 19 10.5 19C5.52944 19 1.5 14.9706 1.5 10C1.5 5.02944 5.52944 1 10.5 1C15.4706 1 19.5 5.02944 19.5 10Z"/>',
                "1.6"
            ),
            education: buildStrokeCategoryIcon(
                "0 0 20 15",
                '<path d="M3 5.99999L3 12M3 12L4 14H2L3 12ZM16 6.99999V10.85L10.5 14L5 10.85V6.99999M10.4583 1.00317L2.68056 5.77776L10.4583 9.9658L18.2361 5.77776L10.4583 1.00317Z"/>',
                "1.7"
            ),
            popculture: buildStrokeCategoryIcon(
                "0 0 20 15",
                '<path d="M4.26667 8.61538C3.34211 5.52692 2 1 2 1L6.53333 1C6.53333 2.65 7.66667 4.3 9.36667 4.3L9.36667 2.65L9.93333 3.2L11.0667 3.2L11.6333 2.65L11.6333 4.3C13.9 4.3 15.0333 1.55 15.0333 1L19 1C18.5526 2.65 17.6579 7.21923 17.3 8.61538C15.6 8.61538 11.6333 8.7 10.5 12C9.36667 8.7 5.96667 8.61538 4.26667 8.61538Z"/>',
                "1.6"
            ),
            universe: buildStrokeCategoryIcon(
                "0 0 21 20",
                '<circle cx="9.5" cy="9" r="6"/><path d="M4.5 11.5C1.99463 14.4395 1.38564 15.8881 1.99998 16.5C2.80192 17.2988 7.02663 14.7033 11.0697 10.6443C15.1127 6.58533 17.7401 2.64733 16.9382 1.84853C16.3751 1.28769 15 1.5 12.5 3.5"/>',
                "1.7"
            ),
            finance: buildStrokeCategoryIcon(
                "0 0 20 20",
                '<path d="M12.5 7.5C12 7 11.3 6.5 10.5 6.5M10.5 6.5C8.50001 6.5 7.62294 8.18441 8.5 9.5C9.5 11 12.5 10 12.5 12C12.5 14.0615 10 14.5 8 13M10.5 6.5L10.5 5M10.5 14V15.5M19.5 10C19.5 14.9706 15.4706 19 10.5 19C5.52944 19 1.5 14.9706 1.5 10C1.5 5.02944 5.52944 1 10.5 1C15.4706 1 19.5 5.02944 19.5 10Z"/>',
                "1.7"
            ),
            lifestyle: buildStrokeCategoryIcon(
                "0 0 19 17",
                '<path d="M1 6L3.31818 4.63636M18 6L9.5507 1.02982C9.51941 1.01142 9.48059 1.01142 9.4493 1.02982L5.47368 3.36842M1.98421 16H6.26842C6.32365 16 6.36842 15.9552 6.36842 15.9V9.73636C6.36842 9.68114 6.41319 9.63636 6.46842 9.63636H12.5316C12.5868 9.63636 12.6316 9.68114 12.6316 9.73636V15.9C12.6316 15.9552 12.6764 16 12.7316 16H17.4632M6.36842 12.8182H1.98421M17.4632 12.8182H12.6316M17.4632 9.18182H1.98421M13.5263 6H5.02632M3.31818 4.63636V1.55455C3.31818 1.49932 3.36295 1.45455 3.41818 1.45455H5.37368C5.42891 1.45455 5.47368 1.49932 5.47368 1.55455V3.36842M3.31818 4.63636L5.47368 3.36842M9.94737 3.72727H9.05263"/>',
                "1.5"
            ),
            spirituality: buildStrokeCategoryIcon(
                "0 0 18 17",
                '<path d="M9.534 1.01686C5.82724 3.21661 4.60556 8.00479 6.80531 11.7116C9.00506 15.4183 13.7932 16.64 17.5 14.4402"/><path d="M17.2232 15.0203C17.2232 10.7099 13.729 7.21571 9.41869 7.21571C5.10835 7.21571 1.61414 10.7099 1.61414 15.0203"/><path d="M1.49996 14.6408C5.26677 16.7361 10.0189 15.381 12.1142 11.6142C14.2095 7.84744 12.8544 3.09528 9.08765 1"/>',
                "1.5"
            ),
            horror: buildStrokeCategoryIcon(
                "0 0 20 21",
                '<path d="M15.3317 17.2515C17.5565 15.6129 19 12.975 19 10C19 5.02944 16.5 1 10 1C3.5 1 1 5.02944 1 10C1 12.975 2.44351 15.6129 4.66833 17.2515C4.2654 17.5204 4 17.9792 4 18.5C4 19.3284 4.67157 20 5.5 20H6.7C6.86569 20 7 19.8657 7 19.7V18.3C7 18.1343 7.13431 18 7.3 18H8.7C8.86569 18 9 18.1343 9 18.3V19.7C9 19.8657 9.13431 20 9.3 20H10.7C10.8657 20 11 19.8657 11 19.7V18.3C11 18.1343 11.1343 18 11.3 18H12.7C12.8657 18 13 18.1343 13 18.3V19.7C13 19.8657 13.1343 20 13.3 20H14.5C15.3284 20 16 19.3284 16 18.5C16 17.9792 15.7346 17.5204 15.3317 17.2515Z"/><path d="M8 8C8 9.10457 7.10457 10 6 10C4.89543 10 4 9.10457 4 8C4 6.89543 4.89543 6 6 6C7.10457 6 8 6.89543 8 8Z"/><path d="M16 8C16 9.10457 15.1046 10 14 10C12.8954 10 12 9.10457 12 8C12 6.89543 12.8954 6 14 6C15.1046 6 16 6.89543 16 8Z"/><path d="M9.06674 12.4247C9.3956 11.5703 10.6044 11.5703 10.9333 12.4247L11.2089 13.1408C11.461 13.7958 10.9775 14.5 10.2756 14.5H9.72437C9.02248 14.5 8.53899 13.7958 8.79111 13.1408L9.06674 12.4247Z"/>',
                "1.5"
            ),
            wildwest: buildStrokeCategoryIcon(
                "0 0 24 24",
                '<path d="M12.546,23.25H11.454A10.7,10.7,0,0,1,2.161,7.235L3.75,4.453V2.25A1.5,1.5,0,0,1,5.25.75h3a1.5,1.5,0,0,1,1.5,1.5v3a2.988,2.988,0,0,1-.4,1.488L7.37,10.211a4.7,4.7,0,0,0,4.084,7.039h1.092a4.7,4.7,0,0,0,4.084-7.039L14.646,6.738a2.988,2.988,0,0,1-.4-1.488v-3a1.5,1.5,0,0,1,1.5-1.5h3a1.5,1.5,0,0,1,1.5,1.5v2.2l1.589,2.782A10.7,10.7,0,0,1,12.546,23.25Z"/><path d="M20.25 4.5L18 4.5"/><path d="M6 4.5L3.75 4.5"/>',
                "1.6"
            ),
            home: buildStrokeCategoryIcon(
                "0 0 24 24",
                '<path d="M1 11L12 2L23 11"/><path d="M3 10V20a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1V10"/>',
                "1.7"
            ),
            "default": buildStrokeCategoryIcon(
                "0 0 24 24",
                '<rect x="1" y="5" width="15" height="14" rx="2" ry="2"/><polygon points="23 7 16 12 23 17 23 7"/>',
                "1.7"
            )
        };
    }

    function getCategoryIconSvg(id, title) {
        var key = String(id || "").toLowerCase();
        var text = String(title || "").toLowerCase();
        var combined = key + " " + text;

        if (combined.indexOf("following") !== -1) {
            return CATEGORY_ICON_MAP.following;
        }
        if (combined.indexOf("watchlater") !== -1 || combined.indexOf("watch later") !== -1) {
            return CATEGORY_ICON_MAP.watchlater;
        }
        if (combined.indexOf("home") !== -1) {
            return CATEGORY_ICON_MAP.home;
        }
        if (combined.indexOf("featured") !== -1) {
            return CATEGORY_ICON_MAP.featured;
        }
        if (combined.indexOf("discover") !== -1 || combined.indexOf("explore") !== -1) {
            return CATEGORY_ICON_MAP.discover;
        }
        if (combined.indexOf("trend") !== -1 || combined.indexOf("hot") !== -1 || combined.indexOf("popular") !== -1) {
            return CATEGORY_ICON_MAP.trending;
        }
        if (combined.indexOf("news") !== -1 || combined.indexOf("politic") !== -1) {
            return CATEGORY_ICON_MAP.news;
        }
        if (combined.indexOf("gaming") !== -1 || combined.indexOf("game") !== -1) {
            return CATEGORY_ICON_MAP.gaming;
        }
        if (combined.indexOf("music") !== -1) {
            return CATEGORY_ICON_MAP.music;
        }
        if (combined.indexOf("comedy") !== -1 || combined.indexOf("funny") !== -1) {
            return CATEGORY_ICON_MAP.comedy;
        }
        if (combined.indexOf("science") !== -1 || combined.indexOf("tech") !== -1) {
            return CATEGORY_ICON_MAP.science;
        }
        if (combined.indexOf("education") !== -1 || combined.indexOf("learn") !== -1) {
            return CATEGORY_ICON_MAP.education;
        }
        if (combined.indexOf("sports") !== -1) {
            return CATEGORY_ICON_MAP.sports;
        }
        if (combined.indexOf("wildwest") !== -1 || combined.indexOf("wild west") !== -1) {
            return CATEGORY_ICON_MAP.wildwest;
        }
        if (combined.indexOf("popculture") !== -1 || combined.indexOf("pop culture") !== -1) {
            return CATEGORY_ICON_MAP.popculture;
        }
        if (combined.indexOf("finance") !== -1 || combined.indexOf("money") !== -1) {
            return CATEGORY_ICON_MAP.finance;
        }
        if (combined.indexOf("universe") !== -1) {
            return CATEGORY_ICON_MAP.universe;
        }
        if (combined.indexOf("lifestyle") !== -1 || combined.indexOf("life style") !== -1) {
            return CATEGORY_ICON_MAP.lifestyle;
        }
        if (combined.indexOf("spirituality") !== -1 || combined.indexOf("spiritual") !== -1) {
            return CATEGORY_ICON_MAP.spirituality;
        }
        if (combined.indexOf("spooky") !== -1 || combined.indexOf("horror") !== -1) {
            return CATEGORY_ICON_MAP.horror;
        }
        return CATEGORY_ICON_MAP.default;
    }

    function withTimeout(promise, timeoutMs, onTimeout) {
        var done = false;
        return new Promise(function (resolve, reject) {
            var timerId = setTimeout(function () {
                if (done) {
                    return;
                }
                done = true;
                if (typeof onTimeout === "function") {
                    onTimeout();
                }
                reject(new Error("Playback candidate timeout"));
            }, Math.max(1000, Number(timeoutMs) || 0));

            promise.then(function (value) {
                if (done) {
                    return;
                }
                done = true;
                clearTimeout(timerId);
                resolve(value);
            }).catch(function (error) {
                if (done) {
                    return;
                }
                done = true;
                clearTimeout(timerId);
                reject(error);
            });
        });
    }

    function buildPlayerMeta(video) {
        var date = formatPublishDate(video && video.publishTime ? video.publishTime : 0);
        return date || "";
    }

    function formatPublishDate(unixSec) {
        var value = Number(unixSec) || 0;
        if (!value) {
            return "";
        }
        var date = new Date(value * 1000);
        if (!isFinite(date.getTime())) {
            return "";
        }
        var monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        var month = monthNames[date.getMonth()] || "";
        var day = date.getDate();
        var year = date.getFullYear();
        if (!month || !day || !year) {
            return "";
        }
        return month + " " + day + ", " + year;
    }

    function stringifyDebug(value) {
        try {
            return JSON.stringify(value);
        } catch (error) {
            return String(value);
        }
    }

    function getErrorMessage(error) {
        if (!error) {
            return "unknown";
        }
        if (error.message) {
            return error.message;
        }
        return String(error);
    }

    Odysee.App = App;
})(window);
