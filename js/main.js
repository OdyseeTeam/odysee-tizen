(function (global) {
    function bootstrap() {
        var Odysee = global.Odysee || {};
        var app = new Odysee.App();
        app.start();
        global.odyseeApp = app;
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", bootstrap);
    } else {
        bootstrap();
    }
})(window);
