(function (global) {
    var Odysee = global.Odysee || (global.Odysee = {});
    var hasAbortController = typeof global.AbortController !== "undefined";
    var debug = Odysee.debug || { enabled: false, verbose: false, log: function () {}, warn: function () {}, error: function () {} };

    function sleep(ms) {
        return new Promise(function (resolve) {
            setTimeout(resolve, ms);
        });
    }

    function withTimeout(fetchPromise, timeoutMs, controller) {
        return new Promise(function (resolve, reject) {
            var completed = false;
            var timeoutId = setTimeout(function () {
                if (completed) {
                    return;
                }
                if (controller && hasAbortController) {
                    controller.abort();
                }
                completed = true;
                reject(new Error("Request timeout after " + timeoutMs + "ms"));
            }, timeoutMs);

            fetchPromise.then(function (response) {
                if (completed) {
                    return;
                }
                completed = true;
                clearTimeout(timeoutId);
                resolve(response);
            }).catch(function (error) {
                if (completed) {
                    return;
                }
                completed = true;
                clearTimeout(timeoutId);
                reject(error);
            });
        });
    }

    function isRetryable(status) {
        return status >= 500 || status === 429;
    }

    function requestJson(url, options) {
        options = options || {};
        if (url.indexOf("https://") !== 0) {
            return Promise.reject(new Error("Only HTTPS endpoints are allowed: " + url));
        }

        var method = options.method || "GET";
        var headers = options.headers || {};
        var body = options.body;
        var retries = typeof options.retries === "number" ? options.retries : 3;
        var timeoutMs = options.timeoutMs || 30000;
        var backoffMs = options.backoffMs || 250;
        var label = options.label || (method + " " + url);
        return new Promise(function (resolve, reject) {
            function runAttempt(attempt) {
                if (debug.verbose) {
                    debug.log("[http] request start", label, "attempt", (attempt + 1) + "/" + (retries + 1), "timeoutMs", timeoutMs);
                }
                var controller = hasAbortController ? new AbortController() : null;
                var requestOptions = {
                    method: method,
                    headers: headers,
                    body: body
                };
                if (controller) {
                    requestOptions.signal = controller.signal;
                }

                withTimeout(fetch(url, {
                    method: requestOptions.method,
                    headers: requestOptions.headers,
                    body: requestOptions.body,
                    signal: requestOptions.signal
                }), timeoutMs, controller).then(function (response) {
                    if (!response.ok) {
                        debug.warn("[http] non-ok response", label, "status", response.status, "attempt", attempt + 1);
                        if (attempt < retries && isRetryable(response.status)) {
                            return sleep(Math.min(backoffMs * Math.pow(2, attempt), 2000))
                                .then(function () {
                                    runAttempt(attempt + 1);
                                });
                        }
                        reject(new Error("HTTP " + response.status + " from " + url));
                        return null;
                    }

                    if (debug.verbose) {
                        debug.log("[http] response ok", label, "status", response.status, "attempt", attempt + 1);
                    }
                    response.json().then(function (json) {
                        resolve(json);
                    }).catch(function (error) {
                        debug.error("[http] json parse failed", label, error && error.message ? error.message : error);
                        reject(error);
                    });
                    return null;
                }).catch(function (error) {
                    debug.warn("[http] request failed", label, "attempt", attempt + 1, getErrorMessage(error));
                    if (attempt >= retries) {
                        reject(error);
                        return;
                    }
                    sleep(Math.min(backoffMs * Math.pow(2, attempt), 2000)).then(function () {
                        runAttempt(attempt + 1);
                    });
                });
            }

            runAttempt(0);
        });
    }

    function resolveFinalUrl(url, timeoutMs) {
        var resolvedTimeout = timeoutMs || 15000;

        function tryMethod(method) {
            return new Promise(function (resolve, reject) {
                var controller = hasAbortController ? new AbortController() : null;
                var requestOptions = {
                    method: method,
                    redirect: "follow"
                };
                if (controller) {
                    requestOptions.signal = controller.signal;
                }

                withTimeout(fetch(url, requestOptions), resolvedTimeout, controller).then(function (response) {
                    if (debug.verbose) {
                        debug.log("[http] resolveFinalUrl", method, "status", response.status, "input", url, "final", response.url || url);
                    }
                    if (response && response.url) {
                        resolve(response.url);
                        return;
                    }
                    resolve(url);
                }).catch(reject);
            });
        }

        return tryMethod("HEAD").catch(function () {
            return tryMethod("GET");
        }).catch(function () {
            return url;
        });
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

    Odysee.http = {
        requestJson: requestJson,
        resolveFinalUrl: resolveFinalUrl
    };
})(window);
