(function (global) {
    var Odysee = global.Odysee || (global.Odysee = {});
    var debug = Odysee.debug || { enabled: false, verbose: false, log: function () {}, warn: function () {}, error: function () {} };
    var AUTH_TOKEN_KEY = "odysee.anon_auth_token";
    var AUTH_UID_KEY = "odysee.anon_uid";
    var authPromise = null;
    var NSFW_TAGS = [
        "porn", "porno", "nsfw", "mature", "xxx", "sex", "creampie", "blowjob",
        "handjob", "vagina", "boobs", "big boobs", "big dick", "pussy", "cumshot",
        "anal", "hard fucking", "ass", "fuck", "hentai"
    ];

    function getHeaders(config) {
        return Object.assign({}, config.ACCESS_HEADERS || {});
    }

    function getStorage() {
        try {
            return global.localStorage || null;
        } catch (error) {
            return null;
        }
    }

    function loadStoredAuth() {
        var storage = getStorage();
        if (!storage) {
            return { token: "", uid: "" };
        }
        return {
            token: storage.getItem(AUTH_TOKEN_KEY) || "",
            uid: storage.getItem(AUTH_UID_KEY) || ""
        };
    }

    function saveStoredAuth(token, uid) {
        var storage = getStorage();
        if (!storage || !token) {
            return;
        }
        try {
            storage.setItem(AUTH_TOKEN_KEY, token);
            if (uid) {
                storage.setItem(AUTH_UID_KEY, String(uid));
            }
        } catch (error) {
            debug.warn("[api] failed to persist anonymous auth", error && error.message);
        }
    }

    function clearStoredAuth() {
        var storage = getStorage();
        if (!storage) {
            return;
        }
        try {
            storage.removeItem(AUTH_TOKEN_KEY);
            storage.removeItem(AUTH_UID_KEY);
        } catch (error) {
            debug.warn("[api] failed to clear anonymous auth", error && error.message);
        }
    }

    function parseAuthPayload(payload) {
        var data = payload && payload.data ? payload.data : payload;
        return {
            token: (data && data.auth_token) ? String(data.auth_token) : "",
            uid: (data && typeof data.id !== "undefined") ? String(data.id) : ""
        };
    }

    function requestAnonymousAuth(config) {
        if (debug.verbose) {
            debug.log("[api] requesting anonymous auth token");
        }
        return Odysee.http.requestJson(config.LBRY_LEGACY_API + "/user/new", {
            headers: getHeaders(config),
            timeoutMs: Math.min(config.REQUEST_TIMEOUT_MS || 30000, 12000),
            retries: 1,
            label: "auth:user/new"
        }).then(function (payload) {
            var parsed = parseAuthPayload(payload);
            if (!parsed.token) {
                throw new Error("Anonymous auth token missing");
            }
            saveStoredAuth(parsed.token, parsed.uid);
            if (debug.verbose) {
                debug.log("[api] anonymous auth token acquired");
            }
            return parsed.token;
        });
    }

    function ensureAnonymousAuth(config, forceRefresh) {
        if (forceRefresh) {
            clearStoredAuth();
        }
        if (!forceRefresh) {
            var cached = loadStoredAuth();
            if (cached.token) {
                return Promise.resolve(cached.token);
            }
        }
        if (!authPromise) {
            authPromise = requestAnonymousAuth(config).catch(function (error) {
                debug.warn("[api] anonymous auth unavailable", error && error.message);
                return "";
            }).then(function (token) {
                authPromise = null;
                return token;
            });
        }
        return authPromise;
    }

    function encodeForm(body) {
        var parts = [];
        var keys = Object.keys(body || {});
        for (var i = 0; i < keys.length; i += 1) {
            var key = keys[i];
            var value = body[key];
            if (typeof value === "undefined" || value === null) {
                continue;
            }
            parts.push(encodeURIComponent(key) + "=" + encodeURIComponent(String(value)));
        }
        return parts.join("&");
    }

    function parseRootApiResult(payload) {
        if (!payload) {
            return {};
        }
        if (payload.success === false) {
            throw new Error(payload.error || payload.message || "Request failed");
        }
        if (payload.error) {
            throw new Error(payload.error.message || payload.error || "Request failed");
        }
        return payload.data || payload.result || payload;
    }

    function postToApiBase(config, baseUrl, path, body, label) {
        var url = String(baseUrl || "").replace(/\/$/, "") + path;
        var headers = Object.assign({
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
        }, getHeaders(config));
        return Odysee.http.requestJson(url, {
            method: "POST",
            headers: headers,
            body: encodeForm(body || {}),
            timeoutMs: config.REQUEST_TIMEOUT_MS,
            retries: config.RETRIES,
            label: label || ("root:" + path)
        }).then(parseRootApiResult);
    }

    function postAuthEndpoint(config, path, body, label) {
        var bases = [config.ROOT_API, config.LBRY_LEGACY_API];
        var lastError = null;

        function tryBase(index) {
            if (index >= bases.length) {
                throw (lastError || new Error("Request failed"));
            }
            var base = bases[index];
            if (!base) {
                return tryBase(index + 1);
            }
            return postToApiBase(config, base, path, body, label).catch(function (error) {
                lastError = error;
                return tryBase(index + 1);
            });
        }

        return tryBase(0);
    }

    function normalizeUser(data) {
        var user = data || {};
        var hasVerifiedEmail = toBool(
            user.has_verified_email,
            user.hasVerifiedEmail,
            user.email_verified,
            user.emailVerified,
            user.is_email_verified,
            user.isEmailVerified
        );
        var email = String(
            user.primary_email ||
            user.email ||
            user.user_email ||
            ""
        ).trim();
        var channelName = String(
            user.channel_name ||
            user.channelName ||
            user.default_channel_name ||
            user.defaultChannelName ||
            user.primary_channel_name ||
            user.primaryChannelName ||
            user.default_channel && (user.default_channel.name || user.default_channel.normalized_name) ||
            user.primary_channel && (user.primary_channel.name || user.primary_channel.normalized_name) ||
            user.channel && (user.channel.name || user.channel.normalized_name) ||
            ""
        ).trim();
        var displayName = String(
            user.display_name ||
            user.displayName ||
            channelName ||
            email
        ).trim();
        var defaultChannelClaimId = pickFirstDefined(
            user.default_channel_claim_id,
            user.defaultChannelClaimId,
            user.default_channel_id,
            user.defaultChannelId,
            user.primary_channel_claim_id,
            user.primaryChannelClaimId,
            user.primary_channel_id,
            user.primaryChannelId,
            user.channel_claim_id,
            user.channelClaimId,
            user.default_channel && (user.default_channel.claim_id || user.default_channel.claimId || user.default_channel.id),
            user.primary_channel && (user.primary_channel.claim_id || user.primary_channel.claimId || user.primary_channel.id),
            user.channel && (user.channel.claim_id || user.channel.claimId || user.channel.id)
        );
        var defaultChannelUri = String(
            user.default_channel_url ||
            user.default_channel_uri ||
            user.defaultChannelUrl ||
            user.defaultChannelUri ||
            user.primary_channel_url ||
            user.primary_channel_uri ||
            user.primaryChannelUrl ||
            user.primaryChannelUri ||
            user.channel_url ||
            user.channel_uri ||
            user.default_channel && (user.default_channel.canonical_url || user.default_channel.permanent_url || user.default_channel.short_url || user.default_channel.url || user.default_channel.uri) ||
            user.primary_channel && (user.primary_channel.canonical_url || user.primary_channel.permanent_url || user.primary_channel.short_url || user.primary_channel.url || user.primary_channel.uri) ||
            ""
        ).trim();
        var defaultChannelName = String(
            user.default_channel_title ||
            user.defaultChannelTitle ||
            user.primary_channel_title ||
            user.primaryChannelTitle ||
            user.default_channel_display_name ||
            user.defaultChannelDisplayName ||
            user.default_channel && (user.default_channel.value && user.default_channel.value.title) ||
            user.primary_channel && (user.primary_channel.value && user.primary_channel.value.title) ||
            user.channel && (user.channel.value && user.channel.value.title) ||
            channelName
        ).trim();
        return {
            email: email,
            displayName: displayName,
            channelName: channelName,
            defaultChannelName: defaultChannelName || channelName,
            avatarUrl: normalizeUserAvatarUrl(
                user.picture,
                user.avatar_url,
                user.avatarUrl,
                user.thumbnail_url,
                user.thumbnailUrl,
                user.channel_thumbnail_url,
                user.channelThumbnailUrl,
                user.channel_avatar_url,
                user.channelAvatarUrl,
                user.default_channel_thumbnail_url,
                user.defaultChannelThumbnailUrl,
                user.primary_channel_thumbnail_url,
                user.primaryChannelThumbnailUrl,
                user.thumbnail && user.thumbnail.url,
                user.channel && user.channel.thumbnail_url,
                user.channel && user.channel.thumbnail && user.channel.thumbnail.url,
                user.default_channel && user.default_channel.thumbnail_url,
                user.default_channel && user.default_channel.thumbnail && user.default_channel.thumbnail.url,
                user.primary_channel && user.primary_channel.thumbnail_url,
                user.primary_channel && user.primary_channel.thumbnail && user.primary_channel.thumbnail.url,
                user.claim && user.claim.value && user.claim.value.thumbnail && user.claim.value.thumbnail.url
            ),
            defaultChannelClaimId: defaultChannelClaimId ? String(defaultChannelClaimId) : "",
            defaultChannelUri: defaultChannelUri,
            hasVerifiedEmail: hasVerifiedEmail,
            isAuthenticated: hasVerifiedEmail || (
                !!(user.is_authenticated || user.authenticated) &&
                !!email &&
                typeof user.has_verified_email === "undefined"
            ),
            raw: user
        };
    }

    function normalizeUserAvatarUrl() {
        var url = "";
        for (var i = 0; i < arguments.length; i += 1) {
            if (arguments[i]) {
                url = String(arguments[i]).trim();
                break;
            }
        }
        if (!url) {
            return "";
        }
        if (url.indexOf("//") === 0) {
            return "https:" + url;
        }
        return url;
    }

    function checkSignedInUser(config) {
        return ensureAnonymousAuth(config, false).then(function (authToken) {
            if (!authToken) {
                return null;
            }
            return postAuthEndpoint(config, "/user/me", {
                auth_token: authToken
            }, "auth:user/me").then(function (data) {
                var normalized = normalizeUser(data);
                if (!normalized.isAuthenticated) {
                    return null;
                }
                return resolveDefaultChannelProfile(config, authToken, normalized).then(function (profile) {
                    if (profile && profile.channelId) {
                        normalized.defaultChannelClaimId = profile.channelId;
                    }
                    if (profile && profile.channelCanonicalUrl) {
                        normalized.defaultChannelUri = profile.channelCanonicalUrl;
                    }
                    if (profile && profile.channelName) {
                        normalized.channelName = profile.channelName;
                        normalized.defaultChannelName = profile.channelName;
                    }
                    if (profile && profile.channelAvatarUrl) {
                        normalized.avatarUrl = profile.channelAvatarUrl;
                    }
                    return normalized;
                }).catch(function () {
                    return resolveDefaultChannelAvatar(config, authToken, normalized).then(function (avatarUrl) {
                        if (avatarUrl) {
                            normalized.avatarUrl = avatarUrl;
                        }
                        return normalized;
                    }).catch(function () {
                        return normalized;
                    });
                });
            }).catch(function (error) {
                debug.warn("[api] failed to query current user", getErrorMessage(error));
                return null;
            });
        });
    }

    function resolveDefaultChannelAvatar(config, authToken, normalizedUser) {
        var claimId = normalizeClaimId(normalizedUser && normalizedUser.defaultChannelClaimId);
        var channelUri = String(normalizedUser && normalizedUser.defaultChannelUri || "").trim();
        var channelName = String(normalizedUser && normalizedUser.channelName || "").trim();
        if (!claimId && !channelUri && !channelName) {
            return Promise.resolve("");
        }

        function extractAvatarFromClaim(claim) {
            if (!claim || typeof claim !== "object") {
                return "";
            }
            return normalizeUserAvatarUrl(
                claim.value && claim.value.thumbnail && claim.value.thumbnail.url,
                claim.thumbnail_url,
                claim.thumbnailUrl,
                claim.value && claim.value.cover && claim.value.cover.url
            );
        }

        function resolveByClaimId() {
            if (!claimId) {
                return Promise.resolve("");
            }
            return callSdk(config, "claim_search", {
                claim_type: ["channel"],
                claim_ids: [claimId],
                no_totals: true,
                page: 1,
                page_size: 1
            }, { authToken: authToken }).then(function (result) {
                var items = result && Array.isArray(result.items) ? result.items : [];
                return extractAvatarFromClaim(items[0] || null);
            }).catch(function () {
                return "";
            });
        }

        function resolveByUri() {
            var uri = channelUri;
            if (!uri && channelName) {
                var normalizedName = channelName.charAt(0) === "@" ? channelName : ("@" + channelName);
                uri = "lbry://" + normalizedName;
            }
            if (!uri) {
                return Promise.resolve("");
            }
            return callSdk(config, "get", { uri: uri }, { authToken: authToken }).then(function (result) {
                return extractAvatarFromClaim(result);
            }).catch(function () {
                return "";
            });
        }

        return resolveByClaimId().then(function (avatarUrl) {
            if (avatarUrl) {
                return avatarUrl;
            }
            return resolveByUri();
        });
    }

    function resolveDefaultChannelProfile(config, authToken, normalizedUser) {
        var fallbackContext = {
            channelId: normalizedUser && normalizedUser.defaultChannelClaimId || "",
            channelName: normalizedUser && (normalizedUser.defaultChannelName || normalizedUser.channelName) || "",
            channelAvatarUrl: normalizedUser && normalizedUser.avatarUrl || "",
            channelCanonicalUrl: normalizedUser && normalizedUser.defaultChannelUri || ""
        };
        return resolveChannelContext(config, fallbackContext).then(function (context) {
            if (!context || !context.channelId) {
                return {
                    channelId: fallbackContext.channelId,
                    channelName: fallbackContext.channelName,
                    channelAvatarUrl: fallbackContext.channelAvatarUrl,
                    channelCanonicalUrl: fallbackContext.channelCanonicalUrl
                };
            }
            return context;
        }).catch(function () {
            return {
                channelId: fallbackContext.channelId,
                channelName: fallbackContext.channelName,
                channelAvatarUrl: fallbackContext.channelAvatarUrl,
                channelCanonicalUrl: fallbackContext.channelCanonicalUrl
            };
        });
    }

    function normalizeChannelName(value) {
        var text = String(value || "").trim();
        if (!text) {
            return "";
        }
        if (text.indexOf("lbry://") === 0) {
            var match = text.match(/lbry:\/\/([^/#?]+)/i);
            if (match && match[1]) {
                text = match[1];
            }
        }
        if (text.charAt(0) !== "@") {
            text = "@" + text;
        }
        return text;
    }

    function extractChannelDisplayName(source, fallbackValue) {
        source = source || {};
        fallbackValue = fallbackValue || {};
        return String(
            source.value && source.value.title ||
            source.title ||
            source.name ||
            source.normalized_name ||
            fallbackValue.defaultChannelName ||
            fallbackValue.channelName ||
            ""
        ).trim();
    }

    function extractChannelContextFromClaim(claim, fallback) {
        var source = claim && typeof claim === "object" ? claim : {};
        var fallbackValue = fallback || {};
        var channelId = normalizeClaimId(
            source.claim_id ||
            source.claimId ||
            source.id ||
            fallbackValue.channelId
        );
        var channelName = extractChannelDisplayName(source, fallbackValue);
        var channelCanonicalUrl = String(
            source.canonical_url ||
            source.permanent_url ||
            source.short_url ||
            source.url ||
            source.uri ||
            fallbackValue.channelCanonicalUrl ||
            ""
        ).trim();
        var channelAvatarUrl = normalizeUserAvatarUrl(
            source.value && source.value.thumbnail && source.value.thumbnail.url,
            source.thumbnail_url,
            source.thumbnailUrl,
            source.value && source.value.cover && source.value.cover.url,
            fallbackValue.channelAvatarUrl
        );
        var channelHandle = String(
            source.name ||
            source.normalized_name ||
            fallbackValue.channelHandle ||
            ""
        ).trim();
        if (channelHandle && channelHandle.charAt(0) !== "@") {
            channelHandle = "@" + channelHandle;
        }
        var countCandidate = (
            source.meta && source.meta.claims_in_channel ||
            source.claims_in_channel ||
            source.claimsInChannel ||
            source.value && source.value.claims_in_channel
        );
        var parsedCount = parseInt(countCandidate, 10);
        var channelVideoCount = isFinite(parsedCount) && parsedCount >= 0 ? parsedCount : null;

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

        if (!channelName && channelId) {
            channelName = "My Channel";
        }

        return {
            channelId: channelId,
            channelName: channelName,
            channelHandle: channelHandle,
            channelVideoCount: channelVideoCount,
            channelAvatarUrl: String(channelAvatarUrl || ""),
            channelCanonicalUrl: channelCanonicalUrl
        };
    }

    function resolveChannelContext(config, channelContext) {
        var fallback = channelContext || {};
        var base = extractChannelContextFromClaim(null, fallback);
        if (base.channelId) {
            return Promise.resolve(base);
        }

        var channelUri = String(fallback.channelCanonicalUrl || "").trim();
        var normalizedName = normalizeChannelName(fallback.channelName);

        function resolveByUri(uri) {
            if (!uri) {
                return Promise.resolve(null);
            }
            return callSdk(config, "get", { uri: uri }).then(function (result) {
                var context = extractChannelContextFromClaim(result, fallback);
                return context.channelId ? context : null;
            }).catch(function () {
                return null;
            });
        }

        function resolveByName() {
            if (!normalizedName) {
                return Promise.resolve(null);
            }
            var nameUri = "lbry://" + normalizedName;
            var bareName = normalizedName.charAt(0) === "@" ? normalizedName.substring(1) : normalizedName;
            return resolveByUri(nameUri).then(function (context) {
                if (context) {
                    return context;
                }
                return callSdk(config, "claim_search", {
                    claim_type: ["channel"],
                    no_totals: true,
                    page: 1,
                    page_size: 1,
                    name: normalizedName
                }).then(function (result) {
                    var items = result && Array.isArray(result.items) ? result.items : [];
                    if (!items.length) {
                        return callSdk(config, "claim_search", {
                            claim_type: ["channel"],
                            no_totals: true,
                            page: 1,
                            page_size: 1,
                            name: bareName
                        }).then(function (fallbackResult) {
                            var fallbackItems = fallbackResult && Array.isArray(fallbackResult.items) ? fallbackResult.items : [];
                            var fallbackContext = extractChannelContextFromClaim(fallbackItems[0] || null, fallback);
                            return fallbackContext.channelId ? fallbackContext : null;
                        }).catch(function () {
                            return null;
                        });
                    }
                    var resolved = extractChannelContextFromClaim(items[0] || null, fallback);
                    return resolved.channelId ? resolved : null;
                }).catch(function () {
                    return null;
                });
            });
        }

        function resolveBySharedActiveChannel() {
            return ensureAnonymousAuth(config, false).then(function (authToken) {
                if (!authToken) {
                    return null;
                }
                function fetchActiveFromPreference(keyName) {
                    return callSdk(config, "preference_get", {
                        key: keyName
                    }, { authToken: authToken }).then(function (payload) {
                        var activeClaimId = extractActiveChannelClaimIdFromShared(payload);
                        if (!activeClaimId) {
                            return null;
                        }
                        return resolveChannelContextFromClaimId(config, activeClaimId, fallback, authToken);
                    }).catch(function () {
                        return null;
                    });
                }

                return fetchActiveFromPreference("shared").then(function (context) {
                    if (context) {
                        return context;
                    }
                    return fetchActiveFromPreference("local");
                });
            }).catch(function () {
                return null;
            });
        }

        function resolveBySyncActiveChannel() {
            return ensureAnonymousAuth(config, false).then(function (authToken) {
                if (!authToken) {
                    return null;
                }
                return fetchSharedSyncPayload(config, authToken).then(function (payload) {
                    var activeClaimId = extractActiveChannelClaimIdFromShared(payload);
                    if (!activeClaimId) {
                        return null;
                    }
                    return resolveChannelContextFromClaimId(config, activeClaimId, fallback, authToken);
                }).catch(function () {
                    return null;
                });
            }).catch(function () {
                return null;
            });
        }

        function resolveByMyChannelSearch() {
            return ensureAnonymousAuth(config, false).then(function (authToken) {
                if (!authToken) {
                    return null;
                }
                return callSdk(config, "claim_search", {
                    claim_type: ["channel"],
                    no_totals: true,
                    page: 1,
                    page_size: 10,
                    is_my_output: true
                }, { authToken: authToken }).then(function (result) {
                    var rows = result && Array.isArray(result.items) ? result.items : [];
                    if (!rows.length) {
                        return null;
                    }

                    var preferred = null;
                    var normalizedTargetName = normalizeKeyToken(normalizedName);
                    var normalizedTargetUri = String(channelUri || "").toLowerCase();
                    for (var i = 0; i < rows.length; i += 1) {
                        var row = rows[i] || {};
                        var context = extractChannelContextFromClaim(row, fallback);
                        if (!context.channelId) {
                            continue;
                        }
                        var rowName = normalizeKeyToken(context.channelName || row.name || row.normalized_name);
                        var rowUri = String(
                            context.channelCanonicalUrl ||
                            row.canonical_url ||
                            row.permanent_url ||
                            row.short_url ||
                            ""
                        ).toLowerCase();
                        if ((normalizedTargetName && rowName && rowName === normalizedTargetName) ||
                            (normalizedTargetUri && rowUri && rowUri === normalizedTargetUri)) {
                            preferred = context;
                            break;
                        }
                        if (!preferred) {
                            preferred = context;
                        }
                    }
                    return preferred && preferred.channelId ? preferred : null;
                }).catch(function () {
                    return null;
                });
            }).catch(function () {
                return null;
            });
        }

        function resolveByChannelList() {
            return ensureAnonymousAuth(config, false).then(function (authToken) {
                if (!authToken) {
                    return null;
                }
                return callSdk(config, "channel_list", {
                    page: 1,
                    page_size: 50
                }, { authToken: authToken }).then(function (result) {
                    var rows = [];
                    if (result && Array.isArray(result.items)) {
                        rows = result.items;
                    } else if (result && Array.isArray(result.channels)) {
                        rows = result.channels;
                    } else if (Array.isArray(result)) {
                        rows = result;
                    }
                    if (!rows.length) {
                        return null;
                    }

                    var preferred = null;
                    var normalizedTargetName = normalizeKeyToken(normalizedName);
                    var normalizedTargetUri = String(channelUri || "").toLowerCase();
                    for (var i = 0; i < rows.length; i += 1) {
                        var row = rows[i] || {};
                        var context = extractChannelContextFromClaim(row, fallback);
                        if (!context.channelId) {
                            continue;
                        }
                        var rowName = normalizeKeyToken(context.channelName || row.name || row.normalized_name);
                        var rowUri = String(
                            context.channelCanonicalUrl ||
                            row.canonical_url ||
                            row.permanent_url ||
                            row.short_url ||
                            ""
                        ).toLowerCase();
                        if ((normalizedTargetName && rowName && rowName === normalizedTargetName) ||
                            (normalizedTargetUri && rowUri && rowUri === normalizedTargetUri)) {
                            preferred = context;
                            break;
                        }
                        if (!preferred) {
                            preferred = context;
                        }
                    }

                    return preferred && preferred.channelId ? preferred : null;
                }).catch(function () {
                    return null;
                });
            }).catch(function () {
                return null;
            });
        }

        return resolveByUri(channelUri).then(function (context) {
            if (context) {
                if (debug.verbose) {
                    debug.log("[api] resolved channel context via uri", context.channelId || "");
                }
                return context;
            }
            return resolveByName();
        }).then(function (context) {
            if (context) {
                if (debug.verbose) {
                    debug.log("[api] resolved channel context via name", context.channelId || "");
                }
                return context;
            }
            return resolveBySharedActiveChannel();
        }).then(function (context) {
            if (context) {
                if (debug.verbose) {
                    debug.log("[api] resolved channel context via shared preference", context.channelId || "");
                }
                return context;
            }
            return resolveBySyncActiveChannel();
        }).then(function (context) {
            if (context) {
                if (debug.verbose) {
                    debug.log("[api] resolved channel context via sync payload", context.channelId || "");
                }
                return context;
            }
            return resolveByMyChannelSearch();
        }).then(function (context) {
            if (context) {
                if (debug.verbose) {
                    debug.log("[api] resolved channel context via my channel search", context.channelId || "");
                }
                return context;
            }
            return resolveByChannelList();
        }).then(function (context) {
            if (debug.verbose && context && context.channelId) {
                debug.log("[api] resolved channel context via channel_list", context.channelId || "");
            }
            return context || null;
        });
    }

    function requestMagicLink(config, email) {
        var normalizedEmail = String(email || "").trim().toLowerCase();
        if (!normalizedEmail) {
            return Promise.reject(new Error("Email is required"));
        }

        return ensureAnonymousAuth(config, false).then(function (authToken) {
            if (!authToken) {
                throw new Error("Unable to initialize auth token");
            }
            return postAuthEndpoint(config, "/user/exists", {
                auth_token: authToken,
                email: normalizedEmail
            }, "auth:user/exists").then(function (existsData) {
                var exists = parseExistsResult(existsData);
                if (!exists.exists) {
                    throw new Error("No account found for this email");
                }
                return sendMagicLinkEmail(config, authToken, normalizedEmail).then(function () {
                    return {
                        email: normalizedEmail,
                        authToken: authToken
                    };
                });
            });
        });
    }

    function normalizeChannelListRows(result) {
        if (result && Array.isArray(result.items)) {
            return result.items;
        }
        if (result && Array.isArray(result.channels)) {
            return result.channels;
        }
        if (Array.isArray(result)) {
            return result;
        }
        return [];
    }

    function listMyChannels(config) {
        return ensureAnonymousAuth(config, false).then(function (authToken) {
            if (!authToken) {
                return [];
            }
            return callSdk(config, "channel_list", {
                page: 1,
                page_size: 50,
                resolve: true
            }, { authToken: authToken }).then(function (result) {
                var rows = normalizeChannelListRows(result);
                var channels = [];
                var seen = {};
                for (var i = 0; i < rows.length; i += 1) {
                    var context = extractChannelContextFromClaim(rows[i], {});
                    if (!context.channelId || seen[context.channelId]) {
                        continue;
                    }
                    seen[context.channelId] = true;
                    channels.push(context);
                }
                return channels;
            }).catch(function (error) {
                debug.warn("[api] listMyChannels failed", getErrorMessage(error));
                return [];
            });
        });
    }

    function parsePreferenceEnvelope(payload, keyName) {
        var key = String(keyName || "");
        var envelope = payload || {};
        if (envelope && typeof envelope === "object" && key && typeof envelope[key] !== "undefined") {
            envelope = envelope[key];
        }
        if (typeof envelope === "string") {
            try {
                envelope = JSON.parse(envelope);
            } catch (error) {
                envelope = {};
            }
        }
        if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
            envelope = {};
        }
        if (typeof envelope.value === "string") {
            try {
                envelope.value = JSON.parse(envelope.value);
            } catch (error) {
                envelope.value = {};
            }
        }
        if (!envelope.value || typeof envelope.value !== "object" || Array.isArray(envelope.value)) {
            envelope.value = {};
        }
        if (!envelope.type) {
            envelope.type = "object";
        }
        if (!envelope.version) {
            envelope.version = "0.1";
        }
        return envelope;
    }

    function setDefaultChannel(config, channelId) {
        var normalizedChannelId = normalizeClaimId(channelId);
        if (!normalizedChannelId) {
            return Promise.reject(new Error("Invalid channel"));
        }
        return ensureAnonymousAuth(config, false).then(function (authToken) {
            if (!authToken) {
                throw new Error("Unable to initialize auth token");
            }

            function setForKey(keyName) {
                return callSdk(config, "preference_get", {
                    key: keyName
                }, { authToken: authToken }).catch(function () {
                    return {};
                }).then(function (payload) {
                    var envelope = parsePreferenceEnvelope(payload, keyName);
                    if (!envelope.value.settings || typeof envelope.value.settings !== "object" || Array.isArray(envelope.value.settings)) {
                        envelope.value.settings = {};
                    }
                    envelope.value.settings.active_channel_claim = normalizedChannelId;
                    return callSdk(config, "preference_set", {
                        key: keyName,
                        value: JSON.stringify(envelope)
                    }, { authToken: authToken });
                });
            }

            return setForKey("shared").catch(function () {
                return setForKey("local");
            });
        });
    }

    function signOutUser(config) {
        return ensureAnonymousAuth(config, false).then(function (authToken) {
            if (!authToken) {
                return null;
            }
            return postAuthEndpoint(config, "/user/signout", {
                auth_token: authToken
            }, "auth:user/signout").catch(function (error) {
                debug.warn("[api] signout request failed", getErrorMessage(error));
                return null;
            }).then(function () {
                clearStoredAuth();
                return ensureAnonymousAuth(config, true).catch(function () {
                    return "";
                });
            });
        });
    }

    function sendMagicLinkEmail(config, authToken, email) {
        var resendBody = {
            auth_token: authToken,
            email: email,
            only_if_expired: "true"
        };
        return postAuthEndpoint(config, "/user_email/resend_token", resendBody, "auth:user_email/resend_token").catch(function (resendError) {
            debug.warn("[api] resend_token failed, trying signin fallback", getErrorMessage(resendError));
            return postAuthEndpoint(config, "/user/signin", {
                auth_token: authToken,
                email: email
            }, "auth:user/signin").catch(function () {
                return null;
            }).then(function () {
                return postAuthEndpoint(config, "/user_email/resend_token", resendBody, "auth:user_email/resend_token");
            });
        });
    }

    function parseExistsResult(data) {
        var payload = data || {};
        var exists = pickFirstDefined(
            payload.exists,
            payload.result,
            payload.is_valid
        );
        var hasPassword = toBool(payload.has_password, payload.hasPassword);

        if (typeof exists === "undefined") {
            if (typeof payload.has_password !== "undefined" || typeof payload.hasPassword !== "undefined") {
                exists = true;
            } else {
                exists = !!payload.primary_email || !!payload.email;
            }
        }

        return {
            exists: toBool(exists),
            hasPassword: hasPassword
        };
    }

    function pickFirstDefined() {
        for (var i = 0; i < arguments.length; i += 1) {
            if (typeof arguments[i] !== "undefined" && arguments[i] !== null) {
                return arguments[i];
            }
        }
        return undefined;
    }

    function toBool() {
        for (var i = 0; i < arguments.length; i += 1) {
            var value = arguments[i];
            if (typeof value === "undefined" || value === null) {
                continue;
            }
            if (typeof value === "boolean") {
                return value;
            }
            if (typeof value === "number") {
                return value !== 0;
            }
            if (typeof value === "string") {
                var normalized = value.toLowerCase().trim();
                if (normalized === "true" || normalized === "1" || normalized === "yes") {
                    return true;
                }
                if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "") {
                    return false;
                }
            }
            return !!value;
        }
        return false;
    }

    function parseIdArray(value) {
        if (!value) {
            return [];
        }
        if (Array.isArray(value)) {
            return value.filter(function (id) {
                return typeof id === "string" && id.length > 0;
            });
        }
        if (typeof value === "object") {
            return Object.keys(value).filter(function (key) {
                return !!value[key];
            });
        }
        return [];
    }

    function parseTagArray(value) {
        if (!value) {
            return [];
        }
        if (Array.isArray(value)) {
            return value.filter(function (tag) {
                return typeof tag === "string" && tag.length > 0;
            });
        }
        return [];
    }

    function humanizeKey(key) {
        if (!key) {
            return "";
        }
        return String(key)
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/_/g, " ")
            .replace(/-/g, " ")
            .replace(/\s+/g, " ")
            .trim();
    }

    function toTitleCase(text) {
        return String(text || "").replace(/\b([a-z])/g, function (match) {
            return match.toUpperCase();
        });
    }

    function normalizeCategoryTitle(title, fallbackId) {
        var raw = String(title || "").trim();
        var compact = raw.toLowerCase().replace(/[^a-z0-9]/g, "");
        var compactMap = {
            popculture: "Pop Culture",
            wildwest: "Wild West",
            newsandpolitics: "News & Politics",
            scienceandtechnology: "Science & Technology",
            learningandeducation: "Learning & Education",
            artsandentertainment: "Arts & Entertainment"
        };
        if (compact && compactMap[compact]) {
            return compactMap[compact];
        }

        var normalized = humanizeKey(raw || fallbackId || "");
        compact = normalized.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (compact && compactMap[compact]) {
            return compactMap[compact];
        }
        return toTitleCase(normalized);
    }

    function pickTitle(raw, fallbackId) {
        if (raw.displayName) {
            return raw.displayName;
        }
        if (raw.title) {
            return raw.title;
        }
        if (raw.name) {
            return raw.name;
        }
        if (raw.label) {
            return raw.label;
        }
        if (raw.displayNames && raw.displayNames.en) {
            return raw.displayNames.en;
        }
        return humanizeKey(fallbackId) || fallbackId;
    }

    function parseCategoryObject(categoryObject) {
        if (!categoryObject || typeof categoryObject !== "object") {
            return [];
        }
        var out = [];
        var keys = Object.keys(categoryObject);
        for (var i = 0; i < keys.length; i += 1) {
            var key = keys[i];
            var value = categoryObject[key];
            if (!value || typeof value !== "object") {
                continue;
            }
            value.__fallbackKey = key;
            out.push(value);
        }
        return out;
    }

    function normalizeText(value) {
        return String(value || "").toLowerCase().trim();
    }

    function isExploreCategory(category) {
        var id = normalizeText(category && category.id);
        var title = normalizeText(category && category.title);
        return id === "explore" || title === "explore";
    }

    function isFeaturedCategory(category) {
        var id = normalizeText(category && category.id);
        var title = normalizeText(category && category.title);
        return id === "featured" || title === "featured";
    }

    function prioritizeCategories(categories) {
        var filtered = [];
        for (var i = 0; i < categories.length; i += 1) {
            if (isExploreCategory(categories[i])) {
                continue;
            }
            filtered.push(categories[i]);
        }
        filtered.sort(function (a, b) {
            var aFeatured = isFeaturedCategory(a) ? 1 : 0;
            var bFeatured = isFeaturedCategory(b) ? 1 : 0;
            if (aFeatured !== bFeatured) {
                return bFeatured - aFeatured;
            }
            return (a.sortOrder || 999) - (b.sortOrder || 999);
        });
        return filtered;
    }

    function mapCategory(raw, fallbackId) {
        raw = raw || {};
        var title = normalizeCategoryTitle(pickTitle(raw, fallbackId), fallbackId);
        var id = String(raw.id || raw.name || raw.__fallbackKey || fallbackId || title).toLowerCase().replace(/[^a-z0-9]+/g, "-");
        var channelIds = parseIdArray(
            raw.channel_ids ||
            raw.channelIds ||
            raw.channels ||
            raw.ids ||
            raw.value
        );
        var excludedChannelIds = parseIdArray(
            raw.excludedChannelIds ||
            raw.excluded_channel_ids ||
            raw.excludeChannelIds ||
            raw.excludedChannels
        );
        var tags = parseTagArray(raw.tags || raw.any_tags || raw.anyTags);
        var sortOrder = typeof raw.sortOrder === "number" ? raw.sortOrder : 999;
        var orderBy = ["release_time"];
        if (id.indexOf("trend") !== -1 || id.indexOf("popular") !== -1 || id.indexOf("hot") !== -1) {
            orderBy = ["trending_group", "trending_mixed"];
        }

        return {
            id: id,
            title: title,
            channelIds: channelIds.slice(0, 2048),
            excludedChannelIds: excludedChannelIds.slice(0, 2048),
            tags: tags.slice(0, 12),
            sortOrder: sortOrder,
            orderBy: orderBy
        };
    }

    function extractCategories(payload) {
        var sources = [];

        if (payload && payload.data && payload.data.en && payload.data.en.categories && typeof payload.data.en.categories === "object") {
            sources = parseCategoryObject(payload.data.en.categories);
        } else if (payload && payload.data && payload.data.categories && typeof payload.data.categories === "object" && !Array.isArray(payload.data.categories)) {
            sources = parseCategoryObject(payload.data.categories);
        } else if (payload && payload.data && Array.isArray(payload.data.categories)) {
            sources = payload.data.categories;
        } else if (payload && Array.isArray(payload.categories)) {
            sources = payload.categories;
        } else if (payload && payload.data && Array.isArray(payload.data)) {
            sources = payload.data;
        } else if (payload && payload.data && typeof payload.data === "object") {
            Object.keys(payload.data).forEach(function (key) {
                if (Array.isArray(payload.data[key])) {
                    sources.push({
                        id: key,
                        title: key.replace(/_/g, " "),
                        channel_ids: payload.data[key]
                    });
                }
            });
        }

        var categories = [];
        for (var i = 0; i < sources.length; i += 1) {
            categories.push(mapCategory(sources[i], "category-" + i));
        }

        categories = categories.filter(function (category) {
            return category.title && category.id;
        });

        categories.sort(function (a, b) {
            return a.sortOrder - b.sortOrder;
        });
        return prioritizeCategories(categories);
    }

    function mergeConfig(defaultConfig, remote) {
        if (!remote || typeof remote !== "object") {
            return defaultConfig;
        }

        var merged = JSON.parse(JSON.stringify(defaultConfig));
        var keys = Object.keys(defaultConfig);
        for (var i = 0; i < keys.length; i += 1) {
            var key = keys[i];
            if (typeof remote[key] !== "undefined") {
                merged[key] = remote[key];
            }
        }
        return merged;
    }

    function loadRuntimeConfig(defaultConfig) {
        if (debug.verbose) {
            debug.log("[api] loading runtime config", defaultConfig.RUNTIME_CONFIG_URL);
        }
        return Odysee.http.requestJson(defaultConfig.RUNTIME_CONFIG_URL, {
                headers: defaultConfig.ACCESS_HEADERS,
                timeoutMs: 6000,
                retries: 1,
                label: "runtime-config"
            }).then(function (remote) {
                if (debug.verbose) {
                    debug.log("[api] runtime config loaded keys", Object.keys(remote || {}).length);
                }
                return mergeConfig(defaultConfig, remote);
            }).catch(function (error) {
            debug.warn("[api] using default config; runtime fetch failed", error && error.message);
            return defaultConfig;
        });
    }

    function loadCategories(config) {
        if (debug.verbose) {
            debug.log("[api] loading categories", config.FRONTPAGE_URL);
        }
        return Odysee.http.requestJson(config.FRONTPAGE_URL, {
            headers: getHeaders(config),
            timeoutMs: config.REQUEST_TIMEOUT_MS,
            retries: config.RETRIES,
            label: "frontpage-categories"
        }).then(function (payload) {
            var categories = extractCategories(payload);
            if (debug.verbose) {
                debug.log("[api] categories extracted", categories.length);
            }
            if (!categories.length) {
                debug.warn("[api] no categories extracted, using fallback");
                return config.FALLBACK_CATEGORIES;
            }
            return categories;
        });
    }

    function callSdk(config, method, params, options) {
        options = options || {};
        var headers = Object.assign({
            "Content-Type": "text/plain;charset=UTF-8"
        }, getHeaders(config));
        if (options.authToken) {
            headers["X-Lbry-Auth-Token"] = options.authToken;
        }
        if (debug.verbose) {
            debug.log("[api] sdk call", method, "params", safeStringify(params));
        }
        return Odysee.http.requestJson(config.QUERY_API + "/api/v1/proxy?m=" + method, {
            method: "POST",
            headers: headers,
            body: JSON.stringify({
                jsonrpc: "2.0",
                method: method,
                params: params,
                id: 1
            }),
            timeoutMs: config.REQUEST_TIMEOUT_MS,
            retries: config.RETRIES,
            label: "sdk:" + method
        }).then(function (payload) {
            if (payload.error) {
                debug.warn("[api] sdk error", method, safeStringify(payload.error));
                throw new Error(payload.error.message || ("SDK " + method + " failed"));
            }
            if (debug.verbose) {
                var itemCount = payload.result && payload.result.items && payload.result.items.length ? payload.result.items.length : 0;
                debug.log("[api] sdk success", method, "items", itemCount);
            }
            return payload.result;
        });
    }

    function getStreamResult(config, uri, authToken) {
        var params = { uri: uri };
        var options = {};
        if (authToken) {
            params.auth_token = authToken;
            options.authToken = authToken;
        }
        return callSdk(config, "get", params, options);
    }

    function getStreamResultWithAuthRetry(config, uri) {
        return ensureAnonymousAuth(config, false).then(function (authToken) {
            return getStreamResult(config, uri, authToken).then(function (result) {
                if (result && result.streaming_url) {
                    return result;
                }
                if (!authToken) {
                    return result;
                }
                return ensureAnonymousAuth(config, true).then(function (freshToken) {
                    if (!freshToken || freshToken === authToken) {
                        return result;
                    }
                    return getStreamResult(config, uri, freshToken).catch(function () {
                        return result;
                    });
                });
            }).catch(function (error) {
                if (!authToken) {
                    throw error;
                }
                return ensureAnonymousAuth(config, true).then(function (freshToken) {
                    if (!freshToken || freshToken === authToken) {
                        throw error;
                    }
                    return getStreamResult(config, uri, freshToken);
                });
            });
        });
    }

    function normalizeThumbnail(config, thumbnailUrl) {
        if (!thumbnailUrl) {
            return "";
        }
        if (thumbnailUrl.indexOf("http") !== 0) {
            return thumbnailUrl;
        }
        return config.IMAGE_PROCESSOR + thumbnailUrl;
    }

    function parseDurationCandidate(value) {
        if (typeof value === "number" && isFinite(value) && value > 0) {
            return Math.floor(value);
        }
        var text = String(value || "").trim();
        if (!text) {
            return 0;
        }
        if (text.indexOf(":") !== -1) {
            var parts = text.split(":");
            var total = 0;
            var multiplier = 1;
            for (var i = parts.length - 1; i >= 0; i -= 1) {
                var partValue = Number(parts[i]);
                if (!isFinite(partValue) || partValue < 0) {
                    return 0;
                }
                total += partValue * multiplier;
                multiplier *= 60;
            }
            return total > 0 ? Math.floor(total) : 0;
        }
        var parsed = Number(text);
        if (!isFinite(parsed) || parsed <= 0) {
            return 0;
        }
        return Math.floor(parsed);
    }

    function parseClaimDurationSeconds(claim) {
        var value = claim && claim.value && typeof claim.value === "object" ? claim.value : {};
        var candidates = [
            value.video && value.video.duration,
            value.audio && value.audio.duration,
            value.duration,
            value.stream && value.stream.duration,
            value.source && value.source.duration,
            claim && claim.duration
        ];
        for (var i = 0; i < candidates.length; i += 1) {
            var normalized = parseDurationCandidate(candidates[i]);
            if (normalized > 0) {
                return normalized;
            }
        }
        return 0;
    }

    function normalizeClaim(config, claim) {
        var title = (claim.value && claim.value.title) || claim.name || "Untitled";
        var channelName = "Unknown channel";
        var channelClaimId = "";
        var channelCanonicalUrl = "";
        var channelAvatarUrl = "";
        if (claim.signing_channel && claim.signing_channel.value && claim.signing_channel.value.title) {
            channelName = claim.signing_channel.value.title;
        } else if (claim.signing_channel && claim.signing_channel.name) {
            channelName = claim.signing_channel.name;
        }
        if (claim.signing_channel && claim.signing_channel.claim_id) {
            channelClaimId = String(claim.signing_channel.claim_id);
        } else if (claim.channel_id) {
            channelClaimId = String(claim.channel_id);
        }
        if (claim.signing_channel) {
            channelCanonicalUrl = String(
                claim.signing_channel.canonical_url ||
                claim.signing_channel.permanent_url ||
                claim.signing_channel.short_url ||
                ""
            );
            if (claim.signing_channel.value && claim.signing_channel.value.thumbnail && claim.signing_channel.value.thumbnail.url) {
                channelAvatarUrl = normalizeThumbnail(config, claim.signing_channel.value.thumbnail.url);
            } else if (claim.signing_channel.value && claim.signing_channel.value.cover && claim.signing_channel.value.cover.url) {
                channelAvatarUrl = normalizeThumbnail(config, claim.signing_channel.value.cover.url);
            }
        }

        var thumb = "";
        if (claim.value && claim.value.thumbnail && claim.value.thumbnail.url) {
            thumb = normalizeThumbnail(config, claim.value.thumbnail.url);
        }
        var sourceHash = "";
        var sourceSdHash = "";
        if (claim.value && claim.value.source) {
            sourceHash = claim.value.source.hash || "";
            sourceSdHash = claim.value.source.sd_hash || "";
        }

        return {
            title: title,
            channelName: channelName,
            claimId: claim.claim_id,
            canonicalUrl: claim.canonical_url || claim.short_url || claim.permanent_url || "",
            name: claim.name || "",
            normalizedName: claim.normalized_name || claim.name || "",
            thumbnailUrl: thumb,
            channelClaimId: channelClaimId,
            channelCanonicalUrl: channelCanonicalUrl,
            channelAvatarUrl: channelAvatarUrl,
            txid: claim.txid || "",
            nout: typeof claim.nout !== "undefined" ? claim.nout : "",
            outpoint: claim.txid && typeof claim.nout !== "undefined" ? (String(claim.txid) + ":" + String(claim.nout)) : "",
            sourceHash: sourceHash,
            sourceSdHash: sourceSdHash,
            sourceMediaType: (claim.value && claim.value.source && claim.value.source.media_type) || "",
            durationSeconds: parseClaimDurationSeconds(claim),
            publishTime: Number(
                (claim.value && claim.value.release_time) ||
                claim.release_time ||
                claim.timestamp ||
                (claim.meta && claim.meta.creation_timestamp) ||
                0
            ) || 0
        };
    }

    function buildCategoryQuery(category, page) {
        var now = Math.floor(Date.now() / 1000);
        var params = {
            claim_type: ["stream"],
            stream_types: ["video"],
            has_source: true,
            no_totals: true,
            page: page || 1,
            page_size: 36,
            order_by: category.orderBy || ["release_time"],
            fee_amount: "<=0",
            not_tags: NSFW_TAGS,
            release_time: "<" + now
        };

        if (Array.isArray(category.channelIds) && category.channelIds.length) {
            params.channel_ids = category.channelIds.slice(0, 180);
            if (!category.isChannelFeed) {
                params.limit_claims_per_channel = 5;
            }
        } else if (Array.isArray(category.tags) && category.tags.length) {
            params.any_tags = category.tags.slice(0, 8);
        }

        if (Array.isArray(category.excludedChannelIds) && category.excludedChannelIds.length) {
            params.not_channel_ids = category.excludedChannelIds.slice(0, 2048);
        }

        return params;
    }

    function normalizeClaimList(config, items) {
        var normalized = [];
        for (var i = 0; i < items.length; i += 1) {
            normalized.push(normalizeClaim(config, items[i]));
        }
        return normalized;
    }

    function loadCategoryVideosFromLighthouse(config, category, page) {
        var pageNumber = Math.max(1, Number(page) || 1);
        var pageSize = 36;
        var fromOffset = (pageNumber - 1) * pageSize;
        var query = encodeURIComponent((category && category.title) || "trending");
        var url = config.LIGHTHOUSE_API + "?s=" + query + "&size=" + pageSize + "&from=" + fromOffset + "&claimType=file&nsfw=false&free_only=true";

        return Odysee.http.requestJson(url, {
            headers: getHeaders(config),
            timeoutMs: config.REQUEST_TIMEOUT_MS,
            retries: config.RETRIES
        }).then(function (payload) {
            var rows = [];
            if (Array.isArray(payload)) {
                rows = payload;
            } else if (payload && Array.isArray(payload.data)) {
                rows = payload.data;
            } else if (payload && Array.isArray(payload.results)) {
                rows = payload.results;
            }

            var ids = [];
            for (var i = 0; i < rows.length; i += 1) {
                var claimId = rows[i].claimId || rows[i].claim_id;
                if (claimId) {
                    ids.push(claimId);
                }
            }
            if (!ids.length) {
                return [];
            }

            return callSdk(config, "claim_search", {
                claim_type: ["stream"],
                stream_types: ["video"],
                claim_ids: ids.slice(0, 80),
                no_totals: true,
                page_size: 36,
                not_tags: NSFW_TAGS,
                fee_amount: "<=0",
                order_by: category.orderBy || ["trending_group", "trending_mixed"]
            }).then(function (result) {
                return normalizeClaimList(config, Array.isArray(result.items) ? result.items : []);
            });
        }).catch(function () {
            return [];
        });
    }

    function extractFollowingChannelIds(payload) {
        var rows = [];
        var data = payload || {};
        if (Array.isArray(data)) {
            rows = data;
        } else if (Array.isArray(data.subscriptions)) {
            rows = data.subscriptions;
        } else if (data.subscriptions && typeof data.subscriptions === "object") {
            rows = Object.keys(data.subscriptions);
        } else if (Array.isArray(data.following)) {
            rows = data.following;
        } else if (data.following && typeof data.following === "object") {
            rows = Object.keys(data.following);
        } else if (Array.isArray(data.items)) {
            rows = data.items;
        } else if (Array.isArray(data.claim_ids)) {
            rows = data.claim_ids;
        } else if (Array.isArray(data.claimIds)) {
            rows = data.claimIds;
        } else if (Array.isArray(data.channels)) {
            rows = data.channels;
        }

        var ids = [];
        for (var i = 0; i < rows.length; i += 1) {
            var row = rows[i];
            var candidate = row;
            if (row && typeof row === "object") {
                candidate = row.claim_id || row.claimId || row.channel_id || row.channelId || row.id || "";
            }
            var normalized = normalizeClaimId(candidate);
            if (normalized) {
                ids.push(normalized);
            }
        }
        return uniqueClaimIds(ids);
    }

    function normalizeKeyToken(value) {
        return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    function walkNestedValues(value, visit, depth, seen) {
        var level = Number(depth) || 0;
        if (!value || level > 8 || typeof visit !== "function") {
            return;
        }
        if (!seen) {
            seen = [];
        }
        if (typeof value === "object") {
            for (var s = 0; s < seen.length; s += 1) {
                if (seen[s] === value) {
                    return;
                }
            }
            seen.push(value);
        }

        visit(value, level);

        if (Array.isArray(value)) {
            for (var i = 0; i < value.length; i += 1) {
                walkNestedValues(value[i], visit, level + 1, seen);
            }
            return;
        }
        if (typeof value !== "object") {
            return;
        }
        var keys = Object.keys(value);
        for (var k = 0; k < keys.length; k += 1) {
            walkNestedValues(value[keys[k]], visit, level + 1, seen);
        }
    }

    function isWatchLaterToken(value) {
        return normalizeKeyToken(value) === "watchlater";
    }

    function hasWatchLaterCollectionData(collectionData) {
        if (!collectionData || typeof collectionData !== "object") {
            return false;
        }
        var claimRefs = Array.isArray(collectionData.claimRefs) ? collectionData.claimRefs : [];
        var resolvedClaims = Array.isArray(collectionData.resolvedClaims) ? collectionData.resolvedClaims : [];
        var itemCount = Number(collectionData.itemCount || 0);
        return claimRefs.length > 0 || resolvedClaims.length > 0 || (isFinite(itemCount) && itemCount > 0);
    }

    function tryParseJson(value) {
        if (typeof value !== "string") {
            return null;
        }
        var text = String(value || "").trim();
        if (!text) {
            return null;
        }
        if ((text.charAt(0) !== "{" && text.charAt(0) !== "[") || text.length < 2) {
            return null;
        }
        try {
            return JSON.parse(text);
        } catch (error) {
            return null;
        }
    }

    function unwrapSharedValue(rawValue, depth) {
        var maxDepth = 6;
        var level = Number(depth) || 0;
        if (level > maxDepth || rawValue === null || typeof rawValue === "undefined") {
            return rawValue;
        }

        if (typeof rawValue === "string") {
            var parsed = tryParseJson(rawValue);
            if (!parsed) {
                return rawValue;
            }
            return unwrapSharedValue(parsed, level + 1);
        }

        if (Array.isArray(rawValue)) {
            return rawValue;
        }

        if (typeof rawValue !== "object") {
            return rawValue;
        }

        if (typeof rawValue.value !== "undefined") {
            var unwrappedValue = unwrapSharedValue(rawValue.value, level + 1);
            if (unwrappedValue && typeof unwrappedValue === "object") {
                return unwrappedValue;
            }
        }

        if (typeof rawValue.shared !== "undefined") {
            var unwrappedShared = unwrapSharedValue(rawValue.shared, level + 1);
            if (unwrappedShared && typeof unwrappedShared === "object") {
                return unwrappedShared;
            }
        }

        if (typeof rawValue.data !== "undefined") {
            var unwrappedData = unwrapSharedValue(rawValue.data, level + 1);
            if (unwrappedData && typeof unwrappedData === "object") {
                return unwrappedData;
            }
        }

        return rawValue;
    }

    function pickWatchLaterEntry(source) {
        if (!source || typeof source !== "object") {
            return null;
        }
        if (source.watchlater) {
            return source.watchlater;
        }
        if (source.watchLater) {
            return source.watchLater;
        }
        if (source.watch_later) {
            return source.watch_later;
        }
        var keys = Object.keys(source);
        for (var i = 0; i < keys.length; i += 1) {
            if (isWatchLaterToken(keys[i])) {
                return source[keys[i]];
            }
        }
        return null;
    }

    function extractWatchLaterFromBuiltinCollections(builtinCollections) {
        var watchLaterEntry = pickWatchLaterEntry(builtinCollections);
        if (!watchLaterEntry) {
            return { claimRefs: [], resolvedClaims: [], itemCount: 0 };
        }
        var parsed = extractWatchLaterCollection({ watchlater: watchLaterEntry });
        if (!hasWatchLaterCollectionData(parsed)) {
            parsed = extractWatchLaterCollection(watchLaterEntry);
        }
        return hasWatchLaterCollectionData(parsed) ? parsed : { claimRefs: [], resolvedClaims: [], itemCount: 0 };
    }

    function extractWatchLaterFromSharedStateCandidate(candidate) {
        if (!candidate) {
            return { claimRefs: [], resolvedClaims: [], itemCount: 0 };
        }
        var unwrapped = unwrapSharedValue(candidate, 0);
        if (!unwrapped || typeof unwrapped !== "object") {
            return { claimRefs: [], resolvedClaims: [], itemCount: 0 };
        }

        var stateCandidates = [
            unwrapped,
            unwrapped.value,
            unwrapped.shared,
            unwrapped.data,
            unwrapped.result
        ];

        for (var i = 0; i < stateCandidates.length; i += 1) {
            var stateValue = stateCandidates[i];
            if (!stateValue || typeof stateValue !== "object" || Array.isArray(stateValue)) {
                continue;
            }

            var builtinCollections = (
                stateValue.builtinCollections ||
                stateValue.builtin_collections ||
                stateValue.builtin
            );
            var parsedBuiltin = extractWatchLaterFromBuiltinCollections(builtinCollections);
            if (hasWatchLaterCollectionData(parsedBuiltin)) {
                return parsedBuiltin;
            }

            var directEntry = pickWatchLaterEntry(stateValue);
            if (directEntry) {
                var parsedDirect = extractWatchLaterCollection({ watchlater: directEntry });
                if (!hasWatchLaterCollectionData(parsedDirect)) {
                    parsedDirect = extractWatchLaterCollection(directEntry);
                }
                if (hasWatchLaterCollectionData(parsedDirect)) {
                    return parsedDirect;
                }
            }
        }

        return { claimRefs: [], resolvedClaims: [], itemCount: 0 };
    }

    function extractWatchLaterFromSharedCandidates(payload) {
        var strictCandidates = [
            payload && payload.shared,
            payload && payload.data && payload.data.shared,
            payload && payload.result && payload.result.shared,
            payload && payload.value && payload.value.shared,
            payload,
            payload && payload.data,
            payload && payload.result,
            payload && payload.value
        ];
        for (var s = 0; s < strictCandidates.length; s += 1) {
            var strictParsed = extractWatchLaterFromSharedStateCandidate(strictCandidates[s]);
            if (hasWatchLaterCollectionData(strictParsed)) {
                if (debug.verbose) {
                    debug.log("[api] watch later parsed from shared builtinCollections");
                }
                return strictParsed;
            }
        }

        var candidates = [];
        var claimRefs = [];
        var resolvedClaims = [];
        var watchLaterCount = 0;

        function appendCandidate(value) {
            if (!value) {
                return;
            }
            var unwrapped = unwrapSharedValue(value, 0);
            if (!unwrapped) {
                return;
            }
            if (Array.isArray(unwrapped)) {
                for (var i = 0; i < unwrapped.length; i += 1) {
                    appendCandidate(unwrapped[i]);
                }
                return;
            }
            if (typeof unwrapped === "object") {
                candidates.push(unwrapped);
            }
        }

        appendCandidate(payload);
        appendCandidate(payload && payload.shared);
        appendCandidate(payload && payload.data);
        appendCandidate(payload && payload.result);
        appendCandidate(payload && payload.preferences);
        appendCandidate(payload && payload.preferences && payload.preferences.shared);
        appendCandidate(payload && payload.value);
        appendCandidate(payload && payload.value && payload.value.shared);
        appendCandidate(payload && payload.value && payload.value.preferences);
        appendCandidate(payload && payload.value && payload.value.preferences && payload.value.preferences.shared);

        for (var c = 0; c < candidates.length; c += 1) {
            var candidate = candidates[c];
            if (!candidate || typeof candidate !== "object") {
                continue;
            }

            var parsedCandidate = extractWatchLaterCollection(candidate);
            if (hasWatchLaterCollectionData(parsedCandidate)) {
                claimRefs = claimRefs.concat(parsedCandidate.claimRefs || []);
                resolvedClaims = resolvedClaims.concat(parsedCandidate.resolvedClaims || []);
                watchLaterCount = Math.max(watchLaterCount, Number(parsedCandidate.itemCount || 0) || 0);
            }

            var builtinCandidates = [
                candidate.builtinCollections,
                candidate.builtin_collections,
                candidate.builtin,
                candidate.value && candidate.value.builtinCollections,
                candidate.value && candidate.value.builtin_collections,
                candidate.value && candidate.value.builtin
            ];
            for (var b = 0; b < builtinCandidates.length; b += 1) {
                var watchLaterEntry = pickWatchLaterEntry(builtinCandidates[b]);
                if (!watchLaterEntry) {
                    continue;
                }
                var parsedBuiltin = extractWatchLaterCollection({ watchlater: watchLaterEntry });
                if (!hasWatchLaterCollectionData(parsedBuiltin)) {
                    parsedBuiltin = extractWatchLaterCollection(watchLaterEntry);
                }
                if (hasWatchLaterCollectionData(parsedBuiltin)) {
                    claimRefs = claimRefs.concat(parsedBuiltin.claimRefs || []);
                    resolvedClaims = resolvedClaims.concat(parsedBuiltin.resolvedClaims || []);
                    watchLaterCount = Math.max(watchLaterCount, Number(parsedBuiltin.itemCount || 0) || 0);
                }
            }
        }

        if (!claimRefs.length && !resolvedClaims.length && watchLaterCount <= 0) {
            walkNestedValues(unwrapSharedValue(payload, 0), function (node) {
                if (!node || typeof node !== "object") {
                    return;
                }

                var parsedNode = extractWatchLaterCollection(node);
                if (hasWatchLaterCollectionData(parsedNode)) {
                    claimRefs = claimRefs.concat(parsedNode.claimRefs || []);
                    resolvedClaims = resolvedClaims.concat(parsedNode.resolvedClaims || []);
                    watchLaterCount = Math.max(watchLaterCount, Number(parsedNode.itemCount || 0) || 0);
                }

                if (Array.isArray(node)) {
                    return;
                }

                var keys = Object.keys(node);
                for (var i = 0; i < keys.length; i += 1) {
                    if (!isWatchLaterToken(keys[i])) {
                        continue;
                    }
                    var watchLaterValue = node[keys[i]];
                    var parsedWatchLater = extractWatchLaterCollection({ watchlater: watchLaterValue });
                    if (!hasWatchLaterCollectionData(parsedWatchLater)) {
                        parsedWatchLater = extractWatchLaterCollection(watchLaterValue);
                    }
                    if (hasWatchLaterCollectionData(parsedWatchLater)) {
                        claimRefs = claimRefs.concat(parsedWatchLater.claimRefs || []);
                        resolvedClaims = resolvedClaims.concat(parsedWatchLater.resolvedClaims || []);
                        watchLaterCount = Math.max(watchLaterCount, Number(parsedWatchLater.itemCount || 0) || 0);
                    }
                }
            }, 0);
        }

        var result = {
            claimRefs: uniqueWatchLaterRefs(claimRefs),
            resolvedClaims: resolvedClaims,
            itemCount: watchLaterCount
        };
        return hasWatchLaterCollectionData(result) ? result : { claimRefs: [], resolvedClaims: [], itemCount: 0 };
    }

    function getWatchLaterFromSharedPreference(config, authToken) {
        function fetchByKey(keyName) {
            return callSdk(config, "preference_get", {
                key: keyName
            }, { authToken: authToken }).then(function (payload) {
                return extractWatchLaterFromSharedCandidates(payload);
            });
        }
        return fetchByKey("shared").catch(function (error) {
            if (debug.verbose) {
                debug.warn("[api] preference_get shared failed", getErrorMessage(error));
            }
            return { claimRefs: [], resolvedClaims: [], itemCount: 0 };
        }).then(function (sharedValue) {
            if (hasWatchLaterCollectionData(sharedValue)) {
                return sharedValue;
            }
            return fetchByKey("local").catch(function (error) {
                if (debug.verbose) {
                    debug.warn("[api] preference_get local failed", getErrorMessage(error));
                }
                return { claimRefs: [], resolvedClaims: [], itemCount: 0 };
            });
        });
    }

    function fetchSharedSyncPayload(config, authToken) {
        return callSdk(config, "sync_hash", {}, { authToken: authToken }).then(function (hashPayload) {
            var syncHash = "";
            if (typeof hashPayload === "string") {
                syncHash = String(hashPayload || "").trim();
            } else if (hashPayload && typeof hashPayload === "object") {
                syncHash = String(
                    hashPayload.hash ||
                    hashPayload.sync_hash ||
                    (hashPayload.data && (hashPayload.data.hash || hashPayload.data.sync_hash)) ||
                    (hashPayload.value && (hashPayload.value.hash || hashPayload.value.sync_hash)) ||
                    ""
                ).trim();
            }

            if (!syncHash) {
                if (debug.verbose) {
                    debug.warn("[api] sync_hash returned empty hash; skipping sync/get fallback");
                }
                return {};
            }
            return postAuthEndpoint(config, "/sync/get", {
                auth_token: authToken,
                hash: syncHash
            }, "auth:sync/get").then(function (payload) {
                return payload;
            });
        }).catch(function (error) {
            if (debug.verbose) {
                debug.warn("[api] sync fallback failed", getErrorMessage(error));
            }
            return {};
        });
    }

    function getWatchLaterFromSync(config, authToken) {
        return fetchSharedSyncPayload(config, authToken).then(function (payload) {
            return extractWatchLaterFromSharedCandidates(payload);
        });
    }

    function extractActiveChannelClaimIdFromShared(payload) {
        var activeChannelClaimId = "";
        walkNestedValues(unwrapSharedValue(payload, 0), function (node) {
            if (activeChannelClaimId || !node || typeof node !== "object" || Array.isArray(node)) {
                return;
            }
            var keys = Object.keys(node);
            for (var i = 0; i < keys.length; i += 1) {
                var key = normalizeKeyToken(keys[i]);
                if (key !== "activechannelclaim") {
                    continue;
                }
                var claimId = normalizeClaimId(node[keys[i]]);
                if (claimId) {
                    activeChannelClaimId = claimId;
                    break;
                }
            }
        }, 0);
        return activeChannelClaimId;
    }

    function resolveChannelContextFromClaimId(config, claimId, fallback, authToken) {
        var normalizedClaimId = normalizeClaimId(claimId);
        if (!normalizedClaimId) {
            return Promise.resolve(null);
        }
        return callSdk(config, "claim_search", {
            claim_type: ["channel"],
            claim_ids: [normalizedClaimId],
            no_totals: true,
            page: 1,
            page_size: 1
        }, { authToken: authToken }).then(function (result) {
            var items = result && Array.isArray(result.items) ? result.items : [];
            var context = extractChannelContextFromClaim(items[0] || null, fallback);
            return context.channelId ? context : null;
        }).catch(function () {
            return null;
        });
    }

    function normalizeWatchLaterRef(value) {
        if (!value) {
            return "";
        }
        var claimId = normalizeClaimId(value);
        if (claimId) {
            return claimId;
        }
        var text = String(value).trim();
        if (!text) {
            return "";
        }
        if (text.indexOf("lbry://") === 0) {
            return text;
        }
        return "";
    }

    function isWatchLaterCollectionEntry(entry) {
        if (!entry || typeof entry !== "object") {
            return false;
        }
        var candidates = [
            entry.id,
            entry.name,
            entry.collection_id,
            entry.collectionId,
            entry.title,
            entry.value && entry.value.title,
            entry.value && entry.value.name
        ];
        for (var i = 0; i < candidates.length; i += 1) {
            if (isWatchLaterToken(candidates[i])) {
                return true;
            }
        }
        if (entry.value && Array.isArray(entry.value.tags)) {
            for (var j = 0; j < entry.value.tags.length; j += 1) {
                if (isWatchLaterToken(entry.value.tags[j])) {
                    return true;
                }
            }
        }
        return false;
    }

    function getWatchLaterEntryCount(entry) {
        if (!entry || typeof entry !== "object") {
            return 0;
        }
        var candidates = [
            entry.item_count,
            entry.itemCount,
            entry.items_count,
            entry.itemsCount,
            entry.claim_count,
            entry.claimCount,
            entry.total_items,
            entry.totalItems,
            entry.value && entry.value.item_count,
            entry.value && entry.value.itemCount,
            entry.meta && entry.meta.item_count,
            entry.meta && entry.meta.itemCount
        ];
        for (var i = 0; i < candidates.length; i += 1) {
            var count = Number(candidates[i]);
            if (isFinite(count) && count > 0) {
                return Math.floor(count);
            }
        }
        if (Array.isArray(entry.items)) {
            return entry.items.length;
        }
        if (entry.value && Array.isArray(entry.value.items)) {
            return entry.value.items.length;
        }
        return 0;
    }

    function looksLikeStreamEntry(entry) {
        if (!entry || typeof entry !== "object") {
            return false;
        }
        var valueType = String(entry.value_type || entry.valueType || "").toLowerCase();
        if (valueType) {
            return valueType === "stream";
        }
        if (entry.value && entry.value.source) {
            return true;
        }
        if (entry.source || entry.stream_type || entry.streamType || entry.media_type || entry.mediaType) {
            return true;
        }
        if (entry.items || entry.claims || (entry.value && (entry.value.items || entry.value.claims))) {
            return false;
        }
        return !!(entry.claim_id || entry.claimId || entry.id || entry.uri || entry.url || entry.permanent_url || entry.canonical_url);
    }

    function collectWatchLaterItems(value, claimRefs, resolvedClaims, depth) {
        if (!value || depth > 5) {
            return;
        }
        if (Array.isArray(value)) {
            for (var i = 0; i < value.length; i += 1) {
                collectWatchLaterItems(value[i], claimRefs, resolvedClaims, depth + 1);
            }
            return;
        }
        if (typeof value === "string") {
            var fromText = normalizeWatchLaterRef(value);
            if (fromText) {
                claimRefs.push(fromText);
            }
            return;
        }
        if (typeof value !== "object") {
            return;
        }

        if (looksLikeStreamEntry(value)) {
            var refCandidate = normalizeWatchLaterRef(
                value.claim_id ||
                value.claimId ||
                value.id ||
                (value.claim && (value.claim.claim_id || value.claim.claimId || value.claim.id)) ||
                value.uri ||
                value.url ||
                value.permanent_url ||
                value.canonical_url ||
                value.short_url
            );
            if (refCandidate) {
                claimRefs.push(refCandidate);
                if (value.value && value.value.source) {
                    resolvedClaims.push(value);
                }
            }
        }

        var nested = [
            value.items,
            value.claims,
            value.value && value.value.items,
            value.value && value.value.claims,
            value.value && value.value.claim,
            value.claim
        ];
        for (var j = 0; j < nested.length; j += 1) {
            if (nested[j]) {
                collectWatchLaterItems(nested[j], claimRefs, resolvedClaims, depth + 1);
            }
        }
    }

    function uniqueWatchLaterRefs(refs) {
        var out = [];
        var seen = {};
        for (var i = 0; i < refs.length; i += 1) {
            var ref = String(refs[i] || "").trim();
            if (!ref) {
                continue;
            }
            var key = normalizeClaimId(ref) || String(ref).toLowerCase();
            if (seen[key]) {
                continue;
            }
            seen[key] = true;
            out.push(ref);
        }
        return out;
    }

    function extractWatchLaterCollection(payload) {
        var claimRefs = [];
        var resolvedClaims = [];
        var candidates = [];
        var watchLaterCount = 0;
        var data = payload || {};

        function appendCandidate(value) {
            if (!value) {
                return;
            }
            if (Array.isArray(value)) {
                for (var i = 0; i < value.length; i += 1) {
                    appendCandidate(value[i]);
                }
                return;
            }
            candidates.push(value);
        }

        appendCandidate(data.watchlater);
        appendCandidate(data.watchLater);
        appendCandidate(data.watch_later);
        appendCandidate(data.builtinCollections && data.builtinCollections.watchlater);
        appendCandidate(data.builtinCollections && data.builtinCollections.watchLater);
        appendCandidate(data.builtinCollections && data.builtinCollections.watch_later);
        appendCandidate(data.builtin_collections && data.builtin_collections.watchlater);
        appendCandidate(data.builtin_collections && data.builtin_collections.watchLater);
        appendCandidate(data.builtin_collections && data.builtin_collections.watch_later);
        appendCandidate(data.builtin && data.builtin.watchlater);
        appendCandidate(data.builtin && data.builtin.watchLater);
        appendCandidate(data.builtin && data.builtin.watch_later);
        appendCandidate(data.items);
        appendCandidate(data.collections);
        appendCandidate(data.data && data.data.watchlater);
        appendCandidate(data.data && data.data.watchLater);
        appendCandidate(data.data && data.data.watch_later);
        appendCandidate(data.data && data.data.builtinCollections && data.data.builtinCollections.watchlater);
        appendCandidate(data.data && data.data.builtinCollections && data.data.builtinCollections.watchLater);
        appendCandidate(data.data && data.data.builtinCollections && data.data.builtinCollections.watch_later);
        appendCandidate(data.data && data.data.builtin_collections && data.data.builtin_collections.watchlater);
        appendCandidate(data.data && data.data.builtin_collections && data.data.builtin_collections.watchLater);
        appendCandidate(data.data && data.data.builtin_collections && data.data.builtin_collections.watch_later);
        appendCandidate(data.data && data.data.builtin && data.data.builtin.watchlater);
        appendCandidate(data.data && data.data.builtin && data.data.builtin.watchLater);
        appendCandidate(data.data && data.data.builtin && data.data.builtin.watch_later);
        appendCandidate(data.data && data.data.items);
        appendCandidate(data.data && data.data.collections);
        appendCandidate(data.result && data.result.watchlater);
        appendCandidate(data.result && data.result.watchLater);
        appendCandidate(data.result && data.result.watch_later);
        appendCandidate(data.result && data.result.builtinCollections && data.result.builtinCollections.watchlater);
        appendCandidate(data.result && data.result.builtinCollections && data.result.builtinCollections.watchLater);
        appendCandidate(data.result && data.result.builtinCollections && data.result.builtinCollections.watch_later);
        appendCandidate(data.result && data.result.builtin_collections && data.result.builtin_collections.watchlater);
        appendCandidate(data.result && data.result.builtin_collections && data.result.builtin_collections.watchLater);
        appendCandidate(data.result && data.result.builtin_collections && data.result.builtin_collections.watch_later);
        appendCandidate(data.result && data.result.builtin && data.result.builtin.watchlater);
        appendCandidate(data.result && data.result.builtin && data.result.builtin.watchLater);
        appendCandidate(data.result && data.result.builtin && data.result.builtin.watch_later);
        appendCandidate(data.result && data.result.items);
        appendCandidate(data.result && data.result.collections);

        var foundWatchLater = false;
        if (isWatchLaterCollectionEntry(data)) {
            foundWatchLater = true;
            watchLaterCount = Math.max(watchLaterCount, getWatchLaterEntryCount(data));
            collectWatchLaterItems(data, claimRefs, resolvedClaims, 0);
        }
        if (data.data && isWatchLaterCollectionEntry(data.data)) {
            foundWatchLater = true;
            watchLaterCount = Math.max(watchLaterCount, getWatchLaterEntryCount(data.data));
            collectWatchLaterItems(data.data, claimRefs, resolvedClaims, 0);
        }
        if (data.result && isWatchLaterCollectionEntry(data.result)) {
            foundWatchLater = true;
            watchLaterCount = Math.max(watchLaterCount, getWatchLaterEntryCount(data.result));
            collectWatchLaterItems(data.result, claimRefs, resolvedClaims, 0);
        }
        for (var k = 0; k < candidates.length; k += 1) {
            var candidate = candidates[k];
            if (!candidate || typeof candidate !== "object") {
                continue;
            }
            if (isWatchLaterCollectionEntry(candidate)) {
                foundWatchLater = true;
                watchLaterCount = Math.max(watchLaterCount, getWatchLaterEntryCount(candidate));
                collectWatchLaterItems(candidate, claimRefs, resolvedClaims, 0);
            }
        }

        if (!foundWatchLater) {
            if (candidates.length === 1) {
                watchLaterCount = Math.max(watchLaterCount, getWatchLaterEntryCount(candidates[0]));
                collectWatchLaterItems(candidates[0], claimRefs, resolvedClaims, 0);
            }
        }

        return {
            claimRefs: uniqueWatchLaterRefs(claimRefs),
            resolvedClaims: resolvedClaims,
            itemCount: watchLaterCount
        };
    }

    function getWatchLaterCollectionData(config, authToken) {
        var sdkParams = {
            page: 1,
            page_size: 2047,
            resolve: true
        };
        return getWatchLaterFromSharedPreference(config, authToken).then(function (sharedCollection) {
            if (hasWatchLaterCollectionData(sharedCollection) && debug.verbose) {
                debug.log("[api] watch later source", "preference_get:shared", "refs", sharedCollection.claimRefs.length, "resolved", sharedCollection.resolvedClaims.length, "count", sharedCollection.itemCount || 0);
            }
            if (hasWatchLaterCollectionData(sharedCollection)) {
                return sharedCollection;
            }
            return getWatchLaterFromSync(config, authToken);
        }).then(function (syncCollection) {
            if (hasWatchLaterCollectionData(syncCollection) && debug.verbose) {
                debug.log("[api] watch later source", "sync/get", "refs", syncCollection.claimRefs.length, "resolved", syncCollection.resolvedClaims.length, "count", syncCollection.itemCount || 0);
            }
            if (hasWatchLaterCollectionData(syncCollection)) {
                return syncCollection;
            }
            return callSdk(config, "collection_list", sdkParams, { authToken: authToken }).then(function (payload) {
                var parsed = extractWatchLaterCollection(payload);
                if (hasWatchLaterCollectionData(parsed)) {
                    if (debug.verbose) {
                        debug.log("[api] watch later source", "collection_list", "refs", parsed.claimRefs.length, "resolved", parsed.resolvedClaims.length, "count", parsed.itemCount || 0);
                    }
                    return parsed;
                }
                return { claimRefs: [], resolvedClaims: [], itemCount: 0 };
            }).catch(function (error) {
                debug.warn("[api] collection_list sdk failed", getErrorMessage(error));
                return { claimRefs: [], resolvedClaims: [], itemCount: 0 };
            });
        }).then(function (resultCollection) {
            if (!hasWatchLaterCollectionData(resultCollection) && debug.verbose) {
                debug.warn("[api] watch later source unavailable across preference/sync/collection fallbacks");
            }
            return resultCollection;
        });
    }

    function normalizeUriKey(value) {
        var text = String(value || "").trim();
        if (!text) {
            return "";
        }
        if (text.indexOf("lbry://") === 0) {
            return text.toLowerCase();
        }
        return "";
    }

    function reorderClaimsByRefs(claims, refs) {
        if (!Array.isArray(claims) || !claims.length || !Array.isArray(refs) || !refs.length) {
            return claims || [];
        }
        var byId = {};
        var byUri = {};
        var used = {};
        var i;
        for (i = 0; i < claims.length; i += 1) {
            var claim = claims[i];
            if (claim && claim.claim_id) {
                byId[String(claim.claim_id).toLowerCase()] = claim;
            }
            if (claim) {
                var uriCandidates = [
                    claim.canonical_url,
                    claim.permanent_url,
                    claim.short_url
                ];
                for (var u = 0; u < uriCandidates.length; u += 1) {
                    var uriKey = normalizeUriKey(uriCandidates[u]);
                    if (uriKey && !byUri[uriKey]) {
                        byUri[uriKey] = claim;
                    }
                }
            }
        }
        var ordered = [];
        for (i = 0; i < refs.length; i += 1) {
            var ref = String(refs[i] || "").trim();
            if (!ref) {
                continue;
            }
            var claimId = normalizeClaimId(ref);
            var uriRefKey = claimId ? "" : normalizeUriKey(ref);
            var key = claimId || uriRefKey;
            var claimMatch = claimId ? byId[claimId] : byUri[uriRefKey];
            if (!key || !claimMatch || used[key]) {
                continue;
            }
            ordered.push(claimMatch);
            used[key] = true;
        }
        for (i = 0; i < claims.length; i += 1) {
            var fallbackClaim = claims[i];
            var fallbackId = fallbackClaim && fallbackClaim.claim_id ? String(fallbackClaim.claim_id).toLowerCase() : "";
            var fallbackUri = normalizeUriKey(
                fallbackClaim && (fallbackClaim.canonical_url || fallbackClaim.permanent_url || fallbackClaim.short_url)
            );
            if ((fallbackId && used[fallbackId]) || (fallbackUri && used[fallbackUri])) {
                continue;
            }
            ordered.push(fallbackClaim);
        }
        return ordered;
    }

    function resolveWatchLaterUriRefs(config, uriRefs, authToken) {
        var uris = Array.isArray(uriRefs) ? uriRefs.filter(function (value) {
            return normalizeUriKey(value);
        }) : [];
        if (!uris.length) {
            return Promise.resolve([]);
        }

        return callSdk(config, "resolve", {
            urls: uris
        }, { authToken: authToken }).then(function (payload) {
            var rows = [];
            var value;
            var keys;
            var i;

            if (payload && Array.isArray(payload.items)) {
                rows = payload.items.slice(0);
            } else if (payload && typeof payload === "object" && !Array.isArray(payload)) {
                keys = Object.keys(payload);
                for (i = 0; i < keys.length; i += 1) {
                    value = payload[keys[i]];
                    if (!value || typeof value !== "object") {
                        continue;
                    }
                    rows.push(value.stream || value.claim || value);
                }
            }
            return rows;
        }).catch(function () {
            var jobs = [];
            for (var i = 0; i < uris.length; i += 1) {
                jobs.push(callSdk(config, "get", { uri: uris[i] }, { authToken: authToken }).catch(function () {
                    return null;
                }));
            }
            return Promise.all(jobs).then(function (rows) {
                return rows.filter(Boolean);
            });
        });
    }

    function loadWatchLaterVideos(config, page) {
        return ensureAnonymousAuth(config, false).then(function (authToken) {
            if (!authToken) {
                return [];
            }
            return getWatchLaterCollectionData(config, authToken).then(function (collectionData) {
                var allClaimRefs = Array.isArray(collectionData.claimRefs) ? collectionData.claimRefs : [];
                var resolvedClaims = Array.isArray(collectionData.resolvedClaims) ? collectionData.resolvedClaims : [];
                var pageNumber = Math.max(1, Number(page) || 1);
                var pageSize = 36;
                var start = (pageNumber - 1) * pageSize;
                var pageRefs = allClaimRefs.slice(start, start + pageSize);

                if (!pageRefs.length) {
                    if (!resolvedClaims.length) {
                        return [];
                    }
                    var normalizedResolved = normalizeClaimList(config, resolvedClaims);
                    return normalizedResolved.slice(start, start + pageSize);
                }

                var pageClaimIds = [];
                var pageUris = [];
                for (var i = 0; i < pageRefs.length; i += 1) {
                    var ref = String(pageRefs[i] || "");
                    var refClaimId = normalizeClaimId(ref);
                    if (refClaimId) {
                        pageClaimIds.push(refClaimId);
                        continue;
                    }
                    var uriKey = normalizeUriKey(ref);
                    if (uriKey) {
                        pageUris.push(ref);
                    }
                }

                var jobs = [];
                if (pageClaimIds.length) {
                    jobs.push(callSdk(config, "claim_search", {
                        no_totals: true,
                        page: 1,
                        page_size: pageClaimIds.length,
                        claim_ids: pageClaimIds
                    }, { authToken: authToken }).then(function (result) {
                        return Array.isArray(result.items) ? result.items : [];
                    }).catch(function () {
                        return [];
                    }));
                }
                if (pageUris.length) {
                    jobs.push(resolveWatchLaterUriRefs(config, pageUris, authToken));
                }

                return Promise.all(jobs).then(function (groups) {
                    var rows = [];
                    for (var g = 0; g < groups.length; g += 1) {
                        if (Array.isArray(groups[g])) {
                            rows = rows.concat(groups[g]);
                        }
                    }
                    rows = reorderClaimsByRefs(rows, pageRefs);
                    return normalizeClaimList(config, rows).slice(0, pageSize);
                }).catch(function (error) {
                    debug.warn("[api] watch later resolve failed", getErrorMessage(error));
                    var fallbackRows = reorderClaimsByRefs(resolvedClaims, pageRefs);
                    return normalizeClaimList(config, fallbackRows).slice(0, pageSize);
                });
            }).catch(function (error) {
                debug.warn("[api] watch later load failed", getErrorMessage(error));
                return [];
            });
        });
    }

    function hasWatchLaterVideos(config) {
        return ensureAnonymousAuth(config, false).then(function (authToken) {
            if (!authToken) {
                return false;
            }
            return getWatchLaterCollectionData(config, authToken).then(function (collectionData) {
                var claimRefs = Array.isArray(collectionData.claimRefs) ? collectionData.claimRefs : [];
                var resolvedClaims = Array.isArray(collectionData.resolvedClaims) ? collectionData.resolvedClaims : [];
                var itemCount = Number(collectionData.itemCount || 0);
                if (debug.verbose) {
                    debug.log("[api] watch later availability", "refs", claimRefs.length, "resolved", resolvedClaims.length, "count", itemCount);
                }
                return claimRefs.length > 0 || resolvedClaims.length > 0 || (isFinite(itemCount) && itemCount > 0);
            }).catch(function (error) {
                debug.warn("[api] hasWatchLaterVideos failed", getErrorMessage(error));
                return false;
            });
        });
    }

    function loadFollowingVideos(config, page) {
        var pageNumber = Math.max(1, Number(page) || 1);
        return ensureAnonymousAuth(config, false).then(function (authToken) {
            if (!authToken) {
                return [];
            }
            return postAuthEndpoint(config, "/subscription/list", {
                auth_token: authToken,
                page: 1,
                page_size: 2047
            }, "auth:subscription/list").then(function (payload) {
                var channelIds = extractFollowingChannelIds(payload).slice(0, 180);
                if (debug.verbose) {
                    debug.log("[api] following channel ids", channelIds.length);
                }
                if (!channelIds.length) {
                    return [];
                }
                return callSdk(config, "claim_search", {
                    claim_type: ["stream"],
                    stream_types: ["video"],
                    has_source: true,
                    no_totals: true,
                    page: pageNumber,
                    page_size: 36,
                    order_by: ["release_time"],
                    fee_amount: "<=0",
                    not_tags: NSFW_TAGS,
                    channel_ids: channelIds,
                    limit_claims_per_channel: 5,
                    release_time: "<" + Math.floor(Date.now() / 1000)
                }).then(function (result) {
                    return normalizeClaimList(config, Array.isArray(result.items) ? result.items : []);
                });
            }).catch(function (error) {
                debug.warn("[api] following load failed", getErrorMessage(error));
                return [];
            });
        });
    }

    function loadChannelVideos(config, channelId, page) {
        var normalizedChannelId = normalizeClaimId(channelId);
        if (!normalizedChannelId) {
            return Promise.resolve([]);
        }
        var pageNumber = Math.max(1, Number(page) || 1);
        return callSdk(config, "claim_search", {
            claim_type: ["stream"],
            stream_types: ["video"],
            has_source: true,
            no_totals: true,
            page: pageNumber,
            page_size: 36,
            order_by: ["release_time"],
            fee_amount: "<=0",
            not_tags: NSFW_TAGS,
            channel_ids: [normalizedChannelId],
            release_time: "<" + Math.floor(Date.now() / 1000)
        }).then(function (result) {
            return normalizeClaimList(config, Array.isArray(result.items) ? result.items : []);
        }).catch(function (error) {
            debug.warn("[api] channel videos load failed", normalizedChannelId, getErrorMessage(error));
            return [];
        });
    }

    function logFileView(config, viewData) {
        var claimId = normalizeClaimId(
            viewData && (viewData.claimId || viewData.claim_id)
        );
        var uri = String(
            viewData && (viewData.uri || viewData.canonicalUrl || viewData.canonical_url || "")
        ).trim();
        var outpoint = String(
            viewData && (viewData.outpoint || "")
        ).trim();

        if (!outpoint) {
            var txid = String(viewData && (viewData.txid || "")).trim();
            var nout = viewData && viewData.nout;
            if (txid && (typeof nout !== "undefined" && nout !== null && nout !== "")) {
                outpoint = txid + ":" + String(nout);
            }
        }

        if (!claimId || !uri || !outpoint) {
            return Promise.reject(new Error("Missing view params"));
        }

        return ensureAnonymousAuth(config, false).then(function (authToken) {
            var body = {
                uri: uri,
                claim_id: claimId,
                outpoint: outpoint
            };
            if (authToken) {
                body.auth_token = authToken;
            }
            return postAuthEndpoint(config, "/file/view", body, "auth:file/view");
        });
    }

    function listSubscribedChannelIds(config, authToken) {
        if (!authToken) {
            return Promise.resolve([]);
        }
        return postAuthEndpoint(config, "/subscription/list", {
            auth_token: authToken,
            page: 1,
            page_size: 2047
        }, "auth:subscription/list").then(function (payload) {
            return extractFollowingChannelIds(payload);
        }).catch(function (error) {
            debug.warn("[api] subscription list failed", getErrorMessage(error));
            return [];
        });
    }

    function isChannelFollowed(config, channelId) {
        var normalizedChannelId = normalizeClaimId(channelId);
        if (!normalizedChannelId) {
            return Promise.resolve(false);
        }
        return ensureAnonymousAuth(config, false).then(function (authToken) {
            return listSubscribedChannelIds(config, authToken).then(function (ids) {
                for (var i = 0; i < ids.length; i += 1) {
                    if (String(ids[i]).toLowerCase() === normalizedChannelId) {
                        return true;
                    }
                }
                return false;
            });
        });
    }

    function followChannel(config, channelId, channelName) {
        var normalizedChannelId = normalizeClaimId(channelId);
        if (!normalizedChannelId) {
            return Promise.reject(new Error("Missing channel id"));
        }
        return ensureAnonymousAuth(config, false).then(function (authToken) {
            if (!authToken) {
                throw new Error("Unable to initialize auth token");
            }
            var primaryBody = {
                auth_token: authToken,
                claim_id: normalizedChannelId,
                channel_name: String(channelName || "")
            };
            return postAuthEndpoint(config, "/subscription/new", primaryBody, "auth:subscription/new").catch(function (error) {
                debug.warn("[api] subscription/new with channel_name failed, retrying without channel_name", getErrorMessage(error));
                return postAuthEndpoint(config, "/subscription/new", {
                    auth_token: authToken,
                    claim_id: normalizedChannelId
                }, "auth:subscription/new");
            });
        });
    }

    function unfollowChannel(config, channelId) {
        var normalizedChannelId = normalizeClaimId(channelId);
        if (!normalizedChannelId) {
            return Promise.reject(new Error("Missing channel id"));
        }
        return ensureAnonymousAuth(config, false).then(function (authToken) {
            if (!authToken) {
                throw new Error("Unable to initialize auth token");
            }
            return postAuthEndpoint(config, "/subscription/delete", {
                auth_token: authToken,
                claim_id: normalizedChannelId
            }, "auth:subscription/delete");
        });
    }

    function listClaimReactions(config, claimId) {
        var normalizedClaimId = normalizeClaimId(claimId);
        if (!normalizedClaimId) {
            return Promise.resolve({});
        }
        return ensureAnonymousAuth(config, false).then(function (authToken) {
            var body = {
                claim_ids: normalizedClaimId
            };
            if (authToken) {
                body.auth_token = authToken;
            }
            return postAuthEndpoint(config, "/reaction/list", body, "auth:reaction/list");
        });
    }

    function reactToClaim(config, claimId, reactionType, remove) {
        var normalizedClaimId = normalizeClaimId(claimId);
        if (!normalizedClaimId) {
            return Promise.reject(new Error("Missing claim id"));
        }
        var normalizedReaction = String(reactionType || "").toLowerCase();
        if (normalizedReaction !== "like" && normalizedReaction !== "dislike") {
            return Promise.reject(new Error("Unsupported reaction type"));
        }
        return ensureAnonymousAuth(config, false).then(function (authToken) {
            if (!authToken) {
                throw new Error("Unable to initialize auth token");
            }
            var body = {
                auth_token: authToken,
                claim_ids: normalizedClaimId,
                type: normalizedReaction,
                clear_types: normalizedReaction === "like" ? "dislike" : "like"
            };
            if (remove) {
                body.remove = true;
            }
            return postAuthEndpoint(config, "/reaction/react", body, "auth:reaction/react");
        });
    }

    function loadCategoryVideos(config, category, page) {
        if (category && (category.isFollowing || String(category.id || "").toLowerCase() === "following")) {
            return loadFollowingVideos(config, page);
        }
        if (category && (category.isWatchLater || isWatchLaterToken(category.id))) {
            return loadWatchLaterVideos(config, page);
        }
        var query = buildCategoryQuery(category, page);
        if (debug.verbose) {
            debug.log("[api] load category videos", category && category.id, "query", safeStringify(query));
        }
        return callSdk(config, "claim_search", query).then(function (result) {
            var primaryItems = Array.isArray(result.items) ? result.items : [];
            if (primaryItems.length > 0) {
                if (debug.verbose) {
                    debug.log("[api] category primary items", primaryItems.length, "for", category && category.id);
                }
                return normalizeClaimList(config, primaryItems);
            }

            var fallbackQuery = {
                claim_type: ["stream"],
                stream_types: ["video"],
                has_source: true,
                no_totals: true,
                page: page || 1,
                page_size: 36,
                order_by: ["trending_group", "trending_mixed"],
                fee_amount: "<=0",
                not_tags: NSFW_TAGS
            };
            debug.warn("[api] category query returned 0 items, trying fallback query", category && category.id);
            return callSdk(config, "claim_search", fallbackQuery).then(function (fallbackResult) {
                var fallbackItems = Array.isArray(fallbackResult.items) ? fallbackResult.items : [];
                if (debug.verbose) {
                    debug.log("[api] fallback query items", fallbackItems.length);
                }
                return normalizeClaimList(config, fallbackItems);
            });
        }).catch(function () {
            debug.warn("[api] category load failed, trying lighthouse fallback", category && category.id);
            return loadCategoryVideosFromLighthouse(config, category, page);
        });
    }

    function searchVideos(config, query) {
        var trimmed = String(query || "").trim();
        if (!trimmed) {
            return Promise.resolve([]);
        }
        var primaryUrl = buildSearchUrl(config.LIGHTHOUSE_API, trimmed);
        var altUrl = buildSearchUrl(config.LIGHTHOUSE_ALT, trimmed);
        if (debug.verbose) {
            debug.log("[api] search start", trimmed);
        }
        return requestSearchRows(config, primaryUrl, "lighthouse-search").then(function (rows) {
            if (!rows.length && altUrl) {
                return requestSearchRows(config, altUrl, "lighthouse-search-alt");
            }
            return rows;
        }).then(function (rows) {
            if (debug.verbose) {
                debug.log("[api] search rows", rows.length);
            }
            var ids = extractClaimIdsFromSearchRows(rows);
            if (debug.verbose) {
                debug.log("[api] search extracted claim ids", ids.length);
            }
            if (!ids.length) {
                return runDirectTextSearch(config, trimmed);
            }
            return callSdk(config, "claim_search", {
                claim_type: ["stream"],
                stream_types: ["video"],
                has_source: true,
                claim_ids: ids.slice(0, 2047),
                no_totals: true,
                page_size: 36,
                not_tags: NSFW_TAGS,
                fee_amount: "<=0",
                order_by: ["release_time"]
            }).then(function (result) {
                var items = normalizeClaimList(config, Array.isArray(result.items) ? result.items : []);
                if (!items.length) {
                    return runDirectTextSearch(config, trimmed);
                }
                if (debug.verbose) {
                    debug.log("[api] search complete", trimmed, "items", items.length);
                }
                return items;
            });
        }).catch(function (error) {
            debug.warn("[api] search pipeline failed, trying direct text fallback", trimmed, getErrorMessage(error));
            return runDirectTextSearch(config, trimmed);
        }).catch(function (error) {
            debug.warn("[api] search failed", trimmed, getErrorMessage(error));
            return [];
        });
    }

    function buildSearchUrl(base, query) {
        if (!base) {
            return "";
        }
        return base + "?s=" + encodeURIComponent(query) + "&size=48&from=0&claimType=file&nsfw=false&free_only=true";
    }

    function requestSearchRows(config, url, label) {
        if (!url) {
            return Promise.resolve([]);
        }
        return Odysee.http.requestJson(url, {
            headers: getHeaders(config),
            timeoutMs: config.REQUEST_TIMEOUT_MS,
            retries: config.RETRIES,
            label: label
        }).then(function (payload) {
            if (Array.isArray(payload)) {
                return payload;
            }
            if (payload && Array.isArray(payload.data)) {
                return payload.data;
            }
            if (payload && Array.isArray(payload.results)) {
                return payload.results;
            }
            return [];
        });
    }

    function extractClaimIdsFromSearchRows(rows) {
        var ids = [];
        for (var i = 0; i < rows.length; i += 1) {
            var row = rows[i] || {};
            var candidates = [
                row.claimId,
                row.claim_id,
                row.id,
                row.guid,
                row.claim && (row.claim.claimId || row.claim.claim_id || row.claim.id),
                row.value && row.value.claim_id
            ];
            for (var j = 0; j < candidates.length; j += 1) {
                var normalized = normalizeClaimId(candidates[j]);
                if (normalized) {
                    ids.push(normalized);
                    break;
                }
            }
        }
        return uniqueClaimIds(ids);
    }

    function normalizeClaimId(value) {
        if (!value) {
            return "";
        }
        var text = String(value).trim();
        var match = text.match(/[a-f0-9]{40}/i);
        return match ? match[0].toLowerCase() : "";
    }

    function uniqueClaimIds(ids) {
        var out = [];
        var seen = {};
        for (var i = 0; i < ids.length; i += 1) {
            var id = ids[i];
            if (!id || seen[id]) {
                continue;
            }
            seen[id] = true;
            out.push(id);
        }
        return out;
    }

    function runDirectTextSearch(config, query) {
        if (debug.verbose) {
            debug.log("[api] direct text search fallback", query);
        }
        return callSdk(config, "claim_search", {
            claim_type: ["stream"],
            stream_types: ["video"],
            has_source: true,
            no_totals: true,
            page: 1,
            page_size: 36,
            order_by: ["release_time"],
            fee_amount: "<=0",
            not_tags: NSFW_TAGS,
            text: query
        }).then(function (result) {
            var items = normalizeClaimList(config, Array.isArray(result.items) ? result.items : []);
            if (debug.verbose) {
                debug.log("[api] direct text search items", items.length);
            }
            return items;
        });
    }

    function resolveStreamUrl(config, video) {
        var uri = video.canonicalUrl;
        if (!uri && video.normalizedName && video.claimId) {
            uri = "lbry://" + video.normalizedName + "#" + video.claimId;
        }
        if (!uri) {
            return Promise.reject(new Error("Missing claim URI"));
        }

        return getStreamResultWithAuthRetry(config, uri).then(function (result) {
            if (result && result.streaming_url) {
                if (debug.verbose) {
                    debug.log("[api] resolveStreamUrl via sdk get", result.streaming_url);
                }
                return result.streaming_url;
            }
            var apiV3Url = buildApiV3StreamUrl(config, video);
            if (apiV3Url) {
                if (debug.verbose) {
                    debug.log("[api] resolveStreamUrl fallback v3", apiV3Url);
                }
                return apiV3Url;
            }
            throw new Error("No stream URL available");
        });
    }

    function buildApiV3StreamUrl(config, video) {
        return buildApiV3StreamUrlWithBase(config.VIDEO_API, video);
    }

    function buildApiV3StreamUrlWithBase(baseUrl, video) {
        if (!video || !video.normalizedName || !video.claimId) {
            return "";
        }
        if (!baseUrl) {
            return "";
        }
        var base = baseUrl + "/api/v3/streams/free/" + encodeURIComponent(video.normalizedName) + "/" + video.claimId;
        var fileExt = getExtensionFromMediaType(video.sourceMediaType);
        var sdHash = "";
        var sourceHash = "";
        if (video.sourceSdHash && video.sourceSdHash.length >= 6) {
            sdHash = video.sourceSdHash.substring(0, 6);
        }
        if (video.sourceHash && video.sourceHash.length >= 6) {
            sourceHash = video.sourceHash.substring(0, 6);
        }

        if (sdHash && fileExt) {
            return base + "/" + sdHash + "." + fileExt;
        }
        if (sdHash) {
            return base + "/" + sdHash;
        }
        if (sourceHash) {
            return base + "/" + sourceHash;
        }
        return base;
    }

    function buildLegacyApiV3StreamUrl(config, video) {
        var legacyBase = config.LEGACY_VIDEO_API || "https://cdn.lbryplayer.xyz";
        return buildApiV3StreamUrlWithBase(legacyBase, video);
    }

    function uniqueUrls(urls) {
        var out = [];
        var seen = {};
        for (var i = 0; i < urls.length; i += 1) {
            var url = urls[i];
            if (!url || typeof url !== "string") {
                continue;
            }
            if (seen[url]) {
                continue;
            }
            seen[url] = true;
            out.push(url);
        }
        return out;
    }

    function flattenUrlGroups(groups) {
        var out = [];
        for (var i = 0; i < groups.length; i += 1) {
            var group = groups[i];
            if (!Array.isArray(group)) {
                continue;
            }
            for (var j = 0; j < group.length; j += 1) {
                out.push(group[j]);
            }
        }
        return out;
    }

    function addAuthTokenToUrl(url, authToken) {
        var value = String(url || "");
        var token = String(authToken || "");
        if (!value || !token) {
            return value;
        }
        if (value.indexOf("auth_token=") !== -1) {
            return value;
        }
        return value + (value.indexOf("?") === -1 ? "?" : "&") + "auth_token=" + encodeURIComponent(token);
    }

    function resolveCandidateWithRedirect(url, label) {
        if (!url) {
            return Promise.resolve([]);
        }
        return Odysee.http.resolveFinalUrl(url, 6000).then(function (finalUrl) {
            var candidates = uniqueUrls([finalUrl, url]);
            if (debug.verbose) {
                debug.log("[api] candidate resolved", label, safeStringify(candidates));
            }
            return candidates;
        }).catch(function (error) {
            debug.warn("[api] candidate resolve failed", label, getErrorMessage(error));
            return [url];
        });
    }

    function pruneCandidatesForTv(candidates) {
        var hasHttps = false;
        var i;
        for (i = 0; i < candidates.length; i += 1) {
            if (String(candidates[i] || "").indexOf("https://") === 0) {
                hasHttps = true;
                break;
            }
        }

        var out = [];
        for (i = 0; i < candidates.length; i += 1) {
            var url = String(candidates[i] || "");
            if (!url) {
                continue;
            }
            if (hasHttps && url.indexOf("http://") === 0) {
                continue;
            }
            out.push(url);
        }
        return out;
    }

    function rankStreamCandidate(url) {
        var score = 0;
        if (!url) {
            return score;
        }
        if (url.indexOf("https://") === 0) {
            score += 40;
        } else if (url.indexOf("http://") === 0) {
            score -= 30;
        }
        if (url.indexOf("/api/v3/streams/free/") !== -1) {
            score += 320;
        }
        if (url.indexOf("cdn.lbryplayer.xyz") !== -1) {
            score += 220;
        }
        if (url.indexOf("/v6/streams/") !== -1) {
            score += 120;
        }
        if (url.indexOf("auth_token=") !== -1) {
            score += 200;
        }
        if (/\/playlist\.m3u8(?:$|\?)/i.test(url)) {
            score += 160;
        } else if (/\/master\.m3u8(?:$|\?)/i.test(url)) {
            score += 90;
        } else if (/\.m3u8(?:$|\?)/i.test(url)) {
            score += 150;
        } else if (/\.mp4(?:$|\?)/i.test(url)) {
            score += 35;
        } else {
            score -= 260;
        }
        return score;
    }

    function prioritizeStreamCandidates(candidates) {
        return candidates.map(function (url, index) {
            return {
                url: url,
                index: index,
                score: rankStreamCandidate(url)
            };
        }).sort(function (left, right) {
            if (right.score !== left.score) {
                return right.score - left.score;
            }
            return left.index - right.index;
        }).map(function (entry) {
            return entry.url;
        });
    }

    function resolveStreamCandidates(config, video) {
        var uri = video.canonicalUrl;
        if (!uri && video.normalizedName && video.claimId) {
            uri = "lbry://" + video.normalizedName + "#" + video.claimId;
        }
        if (!uri) {
            return Promise.reject(new Error("Missing claim URI"));
        }

        var apiV3Url = buildApiV3StreamUrl(config, video);
        var legacyApiV3Url = buildLegacyApiV3StreamUrl(config, video);
        return Promise.all([
            getStreamResultWithAuthRetry(config, uri),
            ensureAnonymousAuth(config, false).catch(function () { return ""; })
        ]).then(function (parts) {
            var result = parts[0] || {};
            var authToken = parts[1] || "";
            var streamUrl = result && result.streaming_url;
            var jobs = [];
            if (streamUrl) {
                jobs.push(resolveCandidateWithRedirect(streamUrl, "sdk-streaming-url"));
            }
            if (apiV3Url) {
                jobs.push(resolveCandidateWithRedirect(addAuthTokenToUrl(apiV3Url, authToken), "api-v3"));
            }
            if (!streamUrl && legacyApiV3Url) {
                jobs.push(resolveCandidateWithRedirect(addAuthTokenToUrl(legacyApiV3Url, authToken), "legacy-api-v3"));
            }

            if (!jobs.length) {
                throw new Error("No stream URL available");
            }
            return Promise.all(jobs).then(function (groups) {
                var candidates = flattenUrlGroups(groups);
                candidates = pruneCandidatesForTv(uniqueUrls(candidates));
                if (!candidates.length) {
                    throw new Error("No stream URL available");
                }
                debug.log("[api] stream candidates", candidates.length, safeStringify(candidates));
                return candidates;
            });
        }).catch(function () {
            var fallbacks = [apiV3Url, legacyApiV3Url].filter(Boolean);
            fallbacks = prioritizeStreamCandidates(pruneCandidatesForTv(uniqueUrls(fallbacks)));
            if (fallbacks.length) {
                debug.warn("[api] sdk get failed, using only api/v3 fallback candidates");
                return fallbacks;
            }
            throw new Error("No stream URL available");
        });
    }

    function getExtensionFromMediaType(mediaType) {
        var value = String(mediaType || "").toLowerCase();
        if (!value) {
            return "";
        }
        if (value.indexOf("video/mp4") === 0) {
            return "mp4";
        }
        if (value.indexOf("video/webm") === 0) {
            return "webm";
        }
        if (value.indexOf("video/quicktime") === 0) {
            return "mov";
        }
        if (value.indexOf("video/x-matroska") === 0) {
            return "mkv";
        }
        if (value.indexOf("application/vnd.apple.mpegurl") === 0 || value.indexOf("application/x-mpegurl") === 0) {
            return "m3u8";
        }
        var slashIndex = value.indexOf("/");
        if (slashIndex === -1) {
            return "";
        }
        var ext = value.substring(slashIndex + 1).replace(/[^a-z0-9]+/g, "");
        if (!ext) {
            return "";
        }
        return ext;
    }

    function safeStringify(value) {
        try {
            return JSON.stringify(value);
        } catch (error) {
            return String(value);
        }
    }

    Odysee.api = {
        loadRuntimeConfig: loadRuntimeConfig,
        loadCategories: loadCategories,
        loadCategoryVideos: loadCategoryVideos,
        searchVideos: searchVideos,
        resolveStreamUrl: resolveStreamUrl,
        resolveStreamCandidates: resolveStreamCandidates,
        requestMagicLink: requestMagicLink,
        checkSignedInUser: checkSignedInUser,
        resolveChannelContext: resolveChannelContext,
        listMyChannels: listMyChannels,
        setDefaultChannel: setDefaultChannel,
        signOutUser: signOutUser,
        hasWatchLaterVideos: hasWatchLaterVideos,
        loadChannelVideos: loadChannelVideos,
        isChannelFollowed: isChannelFollowed,
        followChannel: followChannel,
        unfollowChannel: unfollowChannel,
        listClaimReactions: listClaimReactions,
        reactToClaim: reactToClaim,
        logFileView: logFileView
    };

    function getErrorMessage(error) {
        if (!error) {
            return "unknown";
        }
        if (error.message) {
            return error.message;
        }
        return String(error);
    }
})(window);
