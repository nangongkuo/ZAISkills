// 00_bootstrap.js - v3 启动期必跑的兜底：unpin + 反 frida 检测 + WebView debug
// 用法（在 run_frida.py 里第二个 -l）：
//   python3 scripts/frida/lib/run_frida.py [--spawn] <pkg> \
//     scripts/frida/lib/_common.js scripts/frida/00_bootstrap.js [其它 trace_*.js]
//
// 此脚本不输出业务数据，只做环境/反检测兜底。

Java.perform(function () {
    var H = createHelper('bootstrap');
    H.log('=== v3 bootstrap ===');

    var COUNT = { unpin: 0, anti: 0 };

    // =========================================================
    // 1. SSL pinning bypass
    // =========================================================

    // 1.1 OkHttp3 CertificatePinner
    H.waitForClass('okhttp3.CertificatePinner', function (CP) {
        try {
            CP.check.overload('java.lang.String', 'java.util.List').implementation = function (a, b) {
                COUNT.unpin++;
                H.log('[unpin] OkHttp3.check(' + a + ')');
            };
        } catch (e) {}
    });

    // 1.2 X509TrustManager（动态枚举所有实现）
    try {
        var impls = Java.enumerateMethods('javax.net.ssl.X509TrustManager!checkServerTrusted');
        impls.forEach(function (group) {
            group.classes.forEach(function (Klass) {
                Klass.methods.forEach(function (m) {
                    try {
                        Java.use(Klass.name)[m].implementation = function () {
                            COUNT.unpin++;
                            H.log('[unpin] TM ' + Klass.name + '.' + m);
                        };
                    } catch (e) {}
                });
            });
        });
    } catch (e) {}

    // 1.3 WebViewClient.onReceivedSslError
    H.waitForClass('android.webkit.WebViewClient', function (WVC) {
        try {
            WVC.onReceivedSslError.implementation = function (view, handler, err) {
                COUNT.unpin++;
                H.log('[unpin] WebViewClient.onReceivedSSLError proceed');
                handler.proceed();
            };
        } catch (e) {}
    });

    // 1.4 Conscrypt
    H.waitForClass('com.android.org.conscrypt.TrustManagerImpl', function (C) {
        try {
            C.checkTrustedRecursive.implementation = function () {
                COUNT.unpin++;
                H.log('[unpin] Conscrypt.checkTrustedRecursive');
                return Java.use('java.util.ArrayList').$new();
            };
        } catch (e) {}
    }, 20);

    // =========================================================
    // 2. 反 Frida / Root 检测兜底
    // =========================================================

    H.waitForClass('java.io.File', function (File) {
        var ROOT_PATHS = [
            '/system/xbin/su',
            '/system/bin/su',
            '/sbin/su',
            '/system/su',
            '/system/xbin/daemonsu',
            '/system/bin/magisk',
            '/sbin/magisk'
        ];

        try {
            File.exists.implementation = function () {
                var path = this.getAbsolutePath();
                for (var i = 0; i < ROOT_PATHS.length; i++) {
                    if (path === ROOT_PATHS[i]) {
                        COUNT.anti++;
                        return false;
                    }
                }
                return this.exists();
            };
        } catch (e) {}
    });

    H.waitForClass('java.lang.Runtime', function (Rt) {
        try {
            Rt.exec.overload('java.lang.String').implementation = function (cmd) {
                if (cmd === 'su' || (cmd && (cmd.indexOf('which su') >= 0 || cmd.indexOf('busybox') >= 0))) {
                    COUNT.anti++;
                    H.log('[anti] Runtime.exec ' + cmd);
                    return this.exec('echo');
                }
                return this.exec(cmd);
            };
        } catch (e) {}
    });

    H.waitForClass('java.io.RandomAccessFile', function (RAF) {
        try {
            RAF.$init.overload('java.lang.String', 'java.lang.String').implementation = function (path, mode) {
                if (path && path.indexOf('/proc/') >= 0 && path.indexOf('maps') >= 0) {
                    COUNT.anti++;
                    H.log('[anti] RAF /proc/.../maps -> /dev/null');
                    return this.$init('/dev/null', mode);
                }
                return this.$init(path, mode);
            };
        } catch (e) {}
    });

    H.waitForClass('java.net.Socket', function (S) {
        try {
            S.$init.overload('java.lang.String', 'int').implementation = function (host, port) {
                if (port === 27042 || port === 27043) {
                    COUNT.anti++;
                    H.log('[anti] Socket scan ' + host + ':' + port + ' refused');
                    throw Java.use('java.net.ConnectException').$new('refused');
                }
                return this.$init(host, port);
            };
        } catch (e) {}
    });

    // =========================================================
    // 3. WebView debug 强开（chrome://inspect）
    // =========================================================

    H.waitForClass('android.webkit.WebView', function (WV) {
        try {
            WV.setWebContentsDebuggingEnabled(true);
            H.log('[webview] setWebContentsDebuggingEnabled(true) - chrome://inspect 可见');
        } catch (e) {}
    });

    H.waitForClass('com.uc.webview.export.WebView', function (UCW) {
        try {
            UCW.setWebContentsDebuggingEnabled(true);
            H.log('[webview] UC WebView debug ON');
        } catch (e) {}
    }, 30);

    // 心跳
    setInterval(function () {
        H.log('[hb] unpin=' + COUNT.unpin + ' anti=' + COUNT.anti);
    }, 10000);

    H.log('=== bootstrap staged ===');
});
