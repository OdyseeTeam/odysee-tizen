(function (global) {
    var Odysee = global.Odysee || (global.Odysee = {});
    var debug = Odysee.debug || { enabled: false, verbose: false, log: function () {}, warn: function () {}, error: function () {} };

    var mediaKeys = [
        "MediaPlay",
        "MediaPause",
        "MediaPlayPause",
        "MediaStop",
        "MediaFastForward",
        "MediaRewind",
        "ColorF0Blue"
    ];

    function isAvailable() {
        return typeof global.tizen !== "undefined";
    }

    function initRemoteKeys() {
        if (!isAvailable() || !global.tizen.tvinputdevice) {
            return;
        }
        for (var i = 0; i < mediaKeys.length; i += 1) {
            try {
                global.tizen.tvinputdevice.registerKey(mediaKeys[i]);
            } catch (error) {
                debug.warn("[platform] key registration failed", mediaKeys[i], error);
            }
        }
    }

    function exitApp() {
        if (isAvailable()) {
            global.tizen.application.getCurrentApplication().exit();
        }
    }

    Odysee.platform = {
        initRemoteKeys: initRemoteKeys,
        exitApp: exitApp,
        isAvailable: isAvailable
    };
})(window);
