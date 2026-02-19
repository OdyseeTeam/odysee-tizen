(function (global) {
    var Odysee = global.Odysee || (global.Odysee = {});

    function FocusManager() {
        this.zone = "sidebar";
        this.indices = {
            topbar: 0,
            sidebar: 0,
            grid: 0
        };
    }

    FocusManager.prototype.setZone = function (zone, index) {
        this.zone = zone;
        if (typeof index === "number") {
            this.indices[zone] = Math.max(0, index);
        }
    };

    FocusManager.prototype.getZone = function () {
        return this.zone;
    };

    FocusManager.prototype.getIndex = function (zone) {
        return this.indices[zone] || 0;
    };

    FocusManager.prototype.setIndex = function (zone, index) {
        this.indices[zone] = Math.max(0, index);
    };

    Odysee.FocusManager = FocusManager;
})(window);
