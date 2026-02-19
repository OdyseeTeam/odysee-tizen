(function (global) {
    var Odysee = global.Odysee || (global.Odysee = {});
    var DEBUG_SETTINGS = {
        enabled: true,
        verbose: true
    };

    var DEFAULT_CONFIG = {
        QUERY_API: "https://api.na-backend.odysee.com",
        ROOT_API: "https://api.odysee.com",
        ROOT_SSO: "https://sso.odysee.com",
        LIGHTHOUSE_API: "https://lighthouse.odysee.tv/search",
        LIGHTHOUSE_ALT: "https://recsys.odysee.tv/search",
        VIDEO_API: "https://player.odycdn.com",
        LEGACY_VIDEO_API: "https://cdn.lbryplayer.xyz",
        LBRY_LEGACY_API: "https://api.lbry.com",
        NEW_LIVE_API: "https://api.odysee.live/livestream",
        FRONTPAGE_URL: "https://odysee.com/$/api/content/v2/get?format=roku",
        IMAGE_PROCESSOR: "https://thumbnails.odycdn.com/optimize/s:390:220/quality:85/plain/",
        RUNTIME_CONFIG_URL: "https://raw.githubusercontent.com/OdyseeTeam/odysee-roku/latest-version/appConstants.json",
        REQUEST_TIMEOUT_MS: 30000,
        RETRIES: 4,
        ACCESS_HEADERS: {
            "Accept": "application/json"
        },
        FALLBACK_CATEGORIES: [
            { id: "home", title: "Home", channelIds: [], tags: ["featured"], orderBy: ["release_time"] },
            { id: "trending", title: "Trending", channelIds: [], tags: ["trending"], orderBy: ["trending_group", "trending_mixed"] },
            { id: "gaming", title: "Gaming", channelIds: [], tags: ["gaming"], orderBy: ["release_time"] },
            { id: "news", title: "News & Politics", channelIds: [], tags: ["news"], orderBy: ["release_time"] }
        ]
    };

    function getDefaultConfig() {
        return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    }

    Odysee.constants = {
        getDefaultConfig: getDefaultConfig
    };

    function stamp() {
        try {
            return new Date().toISOString();
        } catch (error) {
            return "";
        }
    }

    function bindConsoleMethod(method) {
        return function () {
            if (!Odysee.debug || !Odysee.debug.enabled) {
                return;
            }
            var args = Array.prototype.slice.call(arguments);
            args.unshift("[Odysee][" + stamp() + "]");
            var fn = console[method] || console.log;
            fn.apply(console, args);
        };
    }

    Odysee.debug = {
        enabled: DEBUG_SETTINGS.enabled,
        verbose: DEBUG_SETTINGS.verbose,
        log: bindConsoleMethod("log"),
        warn: bindConsoleMethod("warn"),
        error: bindConsoleMethod("error")
    };
})(window);
