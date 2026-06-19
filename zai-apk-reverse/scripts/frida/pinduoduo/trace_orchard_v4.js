// trace_orchard_v4.js - 精简版：专注主文档+容器初始化+商品RPC+预加载
// 修改：RealCall URL提取、响应体捕获、WebView主文档内容抓取
Java.perform(function () {
    var H = createHelper('v4');
    H.log('=== trace_orchard_v4 精简版 ===');

    var COUNT = { rpc: 0, doc: 0, nav: 0, preload: 0 };
    var T0 = Java.use('java.lang.System').currentTimeMillis();
    function ts() { return Java.use('java.lang.System').currentTimeMillis() - T0; }
    function logE(tag, detail) { COUNT.nav++; H.log('[' + tag + ' +' + ts() + 'ms] ' + H.trunc(detail, 500)); }

    // =========================================================
    // 1. OkHttp：从 Request 对象正确提取 URL + 响应体
    // =========================================================
    // Hook Request$Builder.addHeader 捕获签名header
    H.waitForClass('okhttp3.Request$Builder', function (RB) {
        try {
            RB.addHeader.implementation = function (name, value) {
                var n = '' + name;
                if (n === 'anti-content' || n === 'x-api-version' || n === 'access-token' || n === 'Authorization') {
                    H.log('[REQ.hdr] ' + n + '=' + H.trunc('' + value, 100));
                }
                return this.addHeader(name, value);
            };
            H.log('[OK] Request$Builder.addHeader hooked');
        } catch (e) {}
    }, 120);

    // Hook RealCall：从 this.originalRequest 取 URL
    H.waitForClass('okhttp3.RealCall', function (RC) {
        try {
            // enqueue（异步，拼多多主流）
            RC.enqueue.implementation = function (callback) {
                COUNT.rpc++;
                var url = '';
                try { url = this.originalRequest().url().toString(); } catch (e) {
                    try { url = this.request().url().toString(); } catch (e2) {}
                }
                if (url && (url.indexOf('pinduoduo') !== -1 || url.indexOf('yangkeduo') !== -1 || url.indexOf('pdd') !== -1 || url.indexOf('hzpdd') !== -1)) {
                    logE('RPC.enq', H.trunc(url, 400));
                }
                return this.enqueue(callback);
            };
            H.log('[OK] RealCall.enqueue hooked (URL提取修复)');
        } catch (e) { H.warn('RealCall.enqueue: ' + e); }

        // execute（同步，少用但关键）
        try {
            RC.execute.implementation = function () {
                COUNT.rpc++;
                var url = '';
                var t0 = Java.use('java.lang.System').currentTimeMillis();
                try { url = this.originalRequest().url().toString(); } catch (e) {
                    try { url = this.request().url().toString(); } catch (e2) {}
                }
                var resp = this.execute();
                var t1 = Java.use('java.lang.System').currentTimeMillis();
                if (url && (url.indexOf('pinduoduo') !== -1 || url.indexOf('yangkeduo') !== -1 || url.indexOf('pdd') !== -1)) {
                    var bodyLen = 0;
                    var bodySample = '';
                    try {
                        var body = resp.peekBody(256 * 1024); // 256KB
                        var bodyStr = body.string();
                        bodyLen = bodyStr.length();
                        bodySample = bodyStr;
                        // 检测商品/任务数据
                        if (bodyStr.indexOf('goods_list') !== -1 || bodyStr.indexOf('item_list') !== -1 || bodyStr.indexOf('goods') !== -1 && bodyStr.indexOf('price') !== -1) {
                            logE('RPC.resp.GOODS', H.trunc(url, 200) + ' size=' + bodyLen + ' time=' + (t1 - t0) + 'ms');
                            // 输出前2KB内容
                            H.dumpString('GOODS-' + COUNT.rpc, bodyStr.substring(0, 2048));
                        }
                        if (bodyStr.indexOf('task_list') !== -1 || bodyStr.indexOf('water') !== -1 || bodyStr.indexOf('mission') !== -1) {
                            logE('RPC.resp.TASK', H.trunc(url, 200) + ' size=' + bodyLen + ' time=' + (t1 - t0) + 'ms');
                            H.dumpString('TASK-' + COUNT.rpc, bodyStr.substring(0, 2048));
                        }
                        // 记录所有 PDD 响应摘要
                        H.log('[RPC.resp] ' + H.trunc(url, 200) + ' size=' + bodyLen + ' time=' + (t1 - t0) + 'ms');
                    } catch (e) {
                        H.log('[RPC.resp] ' + H.trunc(url, 200) + ' time=' + (t1 - t0) + 'ms (body err)');
                    }
                }
                return resp;
            };
            H.log('[OK] RealCall.execute hooked (含响应体)');
        } catch (e) {}
    }, 120);

    // =========================================================
    // 2. WebView：抓主文档HTML内容 + 加载时序
    // =========================================================
    try {
        var WV = Java.use('android.webkit.WebView');
        // loadUrl
        WV.loadUrl.overload('java.lang.String').implementation = function (url) {
            COUNT.doc++;
            logE('WV.loadUrl', url);
            return this.loadUrl(url);
        };
        WV.loadUrl.overload('java.lang.String', 'java.util.Map').implementation = function (url, headers) {
            COUNT.doc++;
            var hdrStr = '';
            try {
                if (headers) {
                    var iter = headers.entrySet().iterator();
                    var cnt = 0;
                    while (iter.hasNext() && cnt < 10) {
                        var e = iter.next();
                        hdrStr += e.getKey() + ':' + H.trunc('' + e.getValue(), 60) + '; ';
                        cnt++;
                    }
                }
            } catch (e) {}
            logE('WV.loadUrl+h', url + ' hdr=[' + hdrStr + ']');
            return this.loadUrl(url, headers);
        };
        H.log('[OK] WebView.loadUrl hooked');
    } catch (e) {}

    // WebViewClient: onPageStarted / onPageFinished / shouldInterceptRequest
    try {
        var WVC = Java.use('android.webkit.WebViewClient');
        WVC.onPageStarted.implementation = function (view, url, favicon) {
            logE('WVC.onPageStarted', url);
            return this.onPageStarted(view, url, favicon);
        };
        WVC.onPageFinished.implementation = function (view, url) {
            logE('WVC.onPageFinished', url + ' <- 主文档加载完成');
            // 抓主文档HTML内容
            try {
                var js = 'document.documentElement.outerHTML.length';
                view.evaluateJavascript(js, Java.registerImplements('android.webkit.ValueCallback', {
                    onReceiveValue: function (v) {
                        var len = v ? parseInt(v) : 0;
                        H.log('[WV.htmlLen] ' + url + ' -> ' + len + ' bytes');
                    }
                }));
            } catch (e) {}
            // 提取关键DOM节点
            try {
                var js2 = '(function(){var m=document.getElementById("main");return m?m.innerHTML.length:-1})()';
                view.evaluateJavascript(js2, Java.registerImplements('android.webkit.ValueCallback', {
                    onReceiveValue: function (v) {
                        H.log('[WV.#main] innerHTML len=' + v);
                    }
                }));
            } catch (e) {}
            // 提取SSR数据
            try {
                var js3 = '(function(){var d=window.__INITIAL_STATE__||window.__PRELOADED_STATE__||window.__DATA__;return d?JSON.stringify(d).substring(0,500):"none"})()';
                view.evaluateJavascript(js3, Java.registerImplements('android.webkit.ValueCallback', {
                    onReceiveValue: function (v) {
                        H.log('[WV.SSR_DATA] ' + v);
                    }
                }));
            } catch (e) {}
            // 提取商品DOM数量
            try {
                var js4 = '(function(){var g=document.querySelectorAll("[class*=goods],[class*=item],[class*=product],[class*=card]");return g?g.length:0})()';
                view.evaluateJavascript(js4, Java.registerImplements('android.webkit.ValueCallback', {
                    onReceiveValue: function (v) {
                        H.log('[WV.goodsDOM] count=' + v);
                    }
                }));
            } catch (e) {}
            return this.onPageFinished(view, url);
        };
        // shouldInterceptRequest：捕获所有子资源请求
        WVC.shouldInterceptRequest.overload('android.webkit.WebView', 'android.webkit.WebResourceRequest').implementation = function (view, request) {
            var url = '';
            try { url = request.getUrl().toString(); } catch (e) {}
            // 只记录关键子资源
            if (url.indexOf('.json') !== -1 || url.indexOf('/api/') !== -1 || url.indexOf('/rpc/') !== -1 ||
                (url.indexOf('pinduoduo') !== -1 || url.indexOf('.js') === -1 && url.indexOf('.css') === -1 && url.indexOf('.png') === -1 && url.indexOf('.jpg') === -1)) {
                H.log('[WVC.intercept] ' + H.trunc(url, 300));
            }
            return this.shouldInterceptRequest(view, request);
        };
        H.log('[OK] WebViewClient hooked (onPageStarted/Finished/intercept)');
    } catch (e) { H.warn('WebViewClient: ' + e); }

    // =========================================================
    // 3. Activity/Fragment 导航（精简）
    // =========================================================
    try {
        var Act = Java.use('android.app.Activity');
        Act.onCreate.overload('android.os.Bundle').implementation = function (bundle) {
            var name = this.$className;
            logE('Act.onCreate', name);
            // Intent extras
            try {
                var intent = this.getIntent();
                var extras = intent.getExtras();
                if (extras) {
                    var keys = extras.keySet().iterator();
                    var s = '';
                    var cnt = 0;
                    while (keys.hasNext() && cnt < 8) {
                        var k = keys.next();
                        s += k + '=' + H.trunc('' + extras.get(k), 80) + '; ';
                        cnt++;
                    }
                    if (s) H.log('[Act.intent] [' + s + ']');
                }
            } catch (e) {}
            this.onCreate(bundle);
        };
        Act.onWindowFocusChanged.implementation = function (hasFocus) {
            if (hasFocus) logE('Act.focus+', this.$className + ' <- 可交互');
            this.onWindowFocusChanged(hasFocus);
        };
        H.log('[OK] Activity lifecycle hooked');
    } catch (e) {}

    try {
        var XFrag = Java.use('androidx.fragment.app.Fragment');
        XFrag.onCreateView.overload('android.view.LayoutInflater', 'android.view.ViewGroup', 'android.os.Bundle').implementation = function (inflater, container, bundle) {
            logE('Frag.onCreateView', this.$className);
            return this.onCreateView(inflater, container, bundle);
        };
        H.log('[OK] Fragment.onCreateView hooked');
    } catch (e) {}

    // =========================================================
    // 4. 预加载：LegoPreCreate + MecoWebView + PagePreload
    // =========================================================
    // 直接 hook 已加载的类，不等 waitForClass
    Java.enumerateLoadedClasses({
        onMatch: function (name) {
            // LegoPreCreate
            if (name === 'com.xunmeng.pinduoduo.app_lego.v8.preload.LegoPreCreateServiceImpl') {
                try {
                    var cls = Java.use(name);
                    var methods = cls.class.getDeclaredMethods();
                    for (var i = 0; i < methods.length; i++) {
                        var mn = methods[i].getName();
                        if (mn.indexOf('preCreate') !== -1 || mn.indexOf('preLoad') !== -1 || mn.indexOf('warmUp') !== -1) {
                            (function (methodName, className) {
                                try {
                                    cls[methodName].overloads.forEach(function (overload) {
                                        overload.implementation = function () {
                                            COUNT.preload++;
                                            logE('PRELOAD.' + methodName, className);
                                            return this[methodName].apply(this, arguments);
                                        };
                                    });
                                    H.log('[OK] PRELOAD ' + className + '.' + methodName);
                                } catch (e) {}
                            })(mn, name);
                        }
                    }
                } catch (e) {}
            }

            // IPagePreloadService
            if (name === 'com.xunmeng.pinduoduo.app_base_activity.service.IPagePreloadService') {
                try {
                    var cls2 = Java.use(name);
                    var methods2 = cls2.class.getDeclaredMethods();
                    for (var j = 0; j < methods2.length; j++) {
                        var mn2 = methods2[j].getName();
                        if (mn2.indexOf('preload') !== -1 || mn2.indexOf('Preload') !== -1) {
                            (function (methodName, className) {
                                try {
                                    cls2[methodName].overloads.forEach(function (overload) {
                                        overload.implementation = function () {
                                            COUNT.preload++;
                                            logE('PRELOAD.' + methodName, className);
                                            return this[methodName].apply(this, arguments);
                                        };
                                    });
                                    H.log('[OK] PRELOAD ' + className + '.' + methodName);
                                } catch (e) {}
                            })(mn2, name);
                        }
                    }
                } catch (e) {}
            }

            // RouterRadicalPreload
            if (name === 'com.xunmeng.pinduoduo.router.proxy.RouterRadicalPreload') {
                try {
                    var cls3 = Java.use(name);
                    var methods3 = cls3.class.getDeclaredMethods();
                    for (var k = 0; k < methods3.length; k++) {
                        var mn3 = methods3[k].getName();
                        if (mn3.indexOf('preload') !== -1 || mn3.indexOf('Preload') !== -1 || mn3.indexOf('radical') !== -1) {
                            (function (methodName, className) {
                                try {
                                    cls3[methodName].overloads.forEach(function (overload) {
                                        overload.implementation = function () {
                                            COUNT.preload++;
                                            logE('PRELOAD.' + methodName, className);
                                            return this[methodName].apply(this, arguments);
                                        };
                                    });
                                    H.log('[OK] PRELOAD ' + className + '.' + methodName);
                                } catch (e) {}
                            })(mn3, name);
                        }
                    }
                } catch (e) {}
            }
        },
        onComplete: function () {
            H.log('[枚举] 预加载类 scan 完成');
        }
    });

    // SecureNative.gal（JNI签名）
    H.waitForClass('com.xunmeng.pinduoduo.secure.SecureNative', function (SN) {
        try {
            H.hookOverLoads(SN, 'gal', function (args, sig) {
                COUNT.rpc++;
                logE('SecureNative.gal', 'JNI签名 argLen=' + sig.length);
            });
            H.log('[OK] SecureNative.gal hooked');
        } catch (e) {}
    }, 120);

    H.heartbeat(8);
    H.log('=== orchard_v4 ready ===');
});
