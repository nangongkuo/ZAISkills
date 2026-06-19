// trace_orchard_v5.js - 基于代码分析的精准hook（修复版）
// 修复：AMNetwork.request（BridgeRequest, ICommonCallBack）签名 + DOM抓取用Java.scheduleOnMainThread
Java.perform(function () {
    var H = createHelper('v5');
    H.log('=== trace_orchard_v5 修复版 ===');

    var COUNT = { jsApi: 0, rpc: 0, nav: 0, preload: 0, dom: 0 };
    var T0 = Java.use('java.lang.System').currentTimeMillis();
    function ts() { return Java.use('java.lang.System').currentTimeMillis() - T0; }
    function logN(tag, detail) { COUNT.nav++; H.log('[' + tag + ' +' + ts() + 'ms] ' + H.trunc(detail, 500)); }

    // =========================================================
    // 1. JSBridge.callNative - 所有H5->Native调用的入口
    //    h3.v$a.callNative(String module, String method, String params, Long callId)
    // =========================================================
    H.waitForClass('h3.v$a', function (BridgeInner) {
        try {
            BridgeInner.callNative.overload('java.lang.String', 'java.lang.String', 'java.lang.String', 'long').implementation = function (module, method, params, callId) {
                COUNT.jsApi++;
                var m = '' + module;
                var mt = '' + method;
                var p = params ? ('' + params) : '';

                // JSNetwork.request / JSNetwork.request2 - RPC请求
                if (m === 'JSNetwork' && (mt === 'request' || mt === 'request2')) {
                    logN('JSNetwork.' + mt, 'callId=' + callId + ' params=' + H.trunc(p, 800));
                    // 尝试提取URL和apiName
                    try {
                        var JSONObject = Java.use('org.json.JSONObject');
                        var json = JSONObject.$new(p);
                        var url = json.optString('url', '');
                        var apiName = json.optString('apiName', json.optString('scene', ''));
                        var httpMethod = json.optString('method', 'GET');
                        if (url) logN('RPC.URL *', H.trunc(url, 400));
                        if (apiName) logN('RPC.apiName', apiName);
                        H.log('[RPC.method] ' + httpMethod);
                    } catch (e) {}
                }
                // PreRender / Lifecycle / Page事件
                else if (m === 'JSPreRender' || m === 'JSPageLifecycle' || m === 'JSLifecycleTracker' || m === 'JSVita') {
                    logN('JSApi.' + m + '.' + mt, 'callId=' + callId + ' params=' + H.trunc(p, 300));
                }
                // 其他JS API只记录module.method
                else {
                    if (COUNT.jsApi <= 300) {
                        H.log('[JSApi] ' + m + '.' + mt + ' callId=' + callId);
                    }
                }

                return this.callNative(module, method, params, callId);
            };
            H.log('[OK] h3.v$a.callNative hooked - JSBridge 入口');
        } catch (e) { H.warn('h3.v$a.callNative: ' + e); }
    }, 120);

    // =========================================================
    // 2. AMNetwork.request - RPC真实入口（修正签名：BridgeRequest + ICommonCallBack）
    // =========================================================
    H.waitForClass('com.xunmeng.pinduoduo.network_bridge.AMNetwork', function (AMNet) {
        try {
            AMNet.request.overload('com.aimi.android.hybrid.bridge.BridgeRequest', 'com.aimi.android.common.callback.ICommonCallBack').implementation = function (bridgeReq, callback) {
                COUNT.rpc++;
                var moduleName = '';
                var methodName = '';
                var dataStr = '';
                var url = '';
                var apiName = '';
                try {
                    moduleName = bridgeReq.getModuleName();
                    methodName = bridgeReq.getMethodName();
                    var data = bridgeReq.getData();
                    if (data) {
                        dataStr = data.toString();
                        url = data.optString('url', '');
                        apiName = data.optString('apiName', data.optString('scene', ''));
                    }
                } catch (e) {}

                logN('AMNetwork.req ***', 'module=' + moduleName + ' method=' + methodName + ' apiName=' + apiName + ' url=' + H.trunc(url, 300));

                // 如果包含商品相关关键词，输出更多详情
                if (dataStr.indexOf('goods') !== -1 || dataStr.indexOf('item') !== -1 || dataStr.indexOf('product') !== -1 ||
                    dataStr.indexOf('list') !== -1 || dataStr.indexOf('garden') !== -1 || dataStr.indexOf('water') !== -1) {
                    H.dumpString('RPC-' + COUNT.rpc, dataStr.substring(0, 4096));
                }

                var t0 = Java.use('java.lang.System').currentTimeMillis();
                var result = this.request(bridgeReq, callback);
                var t1 = Java.use('java.lang.System').currentTimeMillis();
                H.log('[AMNetwork.req] 耗时=' + (t1 - t0) + 'ms（同步部分） module=' + moduleName);

                return result;
            };
            H.log('[OK] AMNetwork.request hooked - RPC入口(BridgeRequest签名)');
        } catch (e) { H.warn('AMNetwork.request: ' + e); }
    }, 120);

    // =========================================================
    // 3. h3.g.onCallNative - Bridge分发（带页面状态检测）
    // =========================================================
    H.waitForClass('h3.g', function (CallNativeHandler) {
        try {
            CallNativeHandler.onCallNative.implementation = function (bridge, request) {
                var module = '';
                var method = '';
                var params = '';
                try {
                    module = request.getModule();
                    method = request.getMethod();
                    params = request.getStringParams();
                } catch (e) {}

                var m = '' + module;
                var mt = '' + method;

                if (m === 'JSNetwork' && (mt === 'request' || mt === 'request2')) {
                    logN('CallNative.JSNetwork', mt + ' params=' + H.trunc(params, 500));
                } else if (m === 'JSPreRender' || m.indexOf('Page') !== -1 || m.indexOf('Lifecycle') !== -1) {
                    logN('CallNative.' + m + '.' + mt, H.trunc(params, 300));
                }

                return this.onCallNative(bridge, request);
            };
            H.log('[OK] h3.g.onCallNative hooked - Bridge分发');
        } catch (e) { H.warn('h3.g.onCallNative: ' + e); }
    }, 120);

    // =========================================================
    // 4. WebView.loadUrl - 主文档请求
    // =========================================================
    try {
        var WV = Java.use('android.webkit.WebView');
        WV.loadUrl.overload('java.lang.String').implementation = function (url) {
            logN('WV.loadUrl', url);
            return this.loadUrl(url);
        };
        WV.loadUrl.overload('java.lang.String', 'java.util.Map').implementation = function (url, headers) {
            var hdrStr = '';
            try {
                if (headers) {
                    var iter = headers.entrySet().iterator();
                    var cnt = 0;
                    while (iter.hasNext() && cnt < 8) {
                        var e = iter.next();
                        hdrStr += e.getKey() + '=' + H.trunc('' + e.getValue(), 60) + '; ';
                        cnt++;
                    }
                }
            } catch (e) {}
            logN('WV.loadUrl+h', url + ' hdr=[' + hdrStr + ']');
            return this.loadUrl(url, headers);
        };
        H.log('[OK] WebView.loadUrl hooked');
    } catch (e) {}

    // =========================================================
    // 5. WebViewClient.onPageFinished + DOM抓取
    // 修复：用Java.scheduleOnMainThread + Java.adapter替代Java.registerImplements
    // =========================================================
    try {
        var WVC = Java.use('android.webkit.WebViewClient');
        var WebViewClass = Java.use('android.webkit.WebView');

        WVC.onPageFinished.implementation = function (view, url) {
            logN('WVC.onPageFinished', H.trunc(url, 300) + ' <- 主文档加载完成');

            // 在UI线程执行JS
            var MyRunnable = Java.registerClass({
                name: 'com.frida.domgrab' + COUNT.dom,
                implements: [Java.use('java.lang.Runnable')],
                methods: {
                    run: function () {
                        // HTML总长度
                        view.evaluateJavascript('document.documentElement.outerHTML.length', Java.registerClass({
                            name: 'com.frida.vcb1_' + COUNT.dom,
                            implements: [Java.use('android.webkit.ValueCallback')],
                            methods: {
                                onReceiveValue: function (v) {
                                    H.log('[DOM] HTML总长=' + v + ' url=' + H.trunc(url, 100));
                                }
                            }
                        }).$new());
                        // #main 内容
                        view.evaluateJavascript('(function(){var m=document.getElementById("main");return m?m.innerHTML.length:-1})()', Java.registerClass({
                            name: 'com.frida.vcb2_' + COUNT.dom,
                            implements: [Java.use('android.webkit.ValueCallback')],
                            methods: {
                                onReceiveValue: function (v) {
                                    H.log('[DOM] #main.innerHTML长度=' + v);
                                }
                            }
                        }).$new());
                        // 商品DOM
                        view.evaluateJavascript('(function(){var g=document.querySelectorAll("[class*=goods],[class*=item],[class*=product],[class*=card]");return g?g.length:0})()', Java.registerClass({
                            name: 'com.frida.vcb3_' + COUNT.dom,
                            implements: [Java.use('android.webkit.ValueCallback')],
                            methods: {
                                onReceiveValue: function (v) {
                                    H.log('[DOM] 商品DOM数=' + v);
                                }
                            }
                        }).$new());
                        // SSR数据
                        view.evaluateJavascript('(function(){try{var s=window.__INITIAL_STATE__;if(s)return JSON.stringify(s).substring(0,500);return"no_SSR"}catch(e){return e+""}})()', Java.registerClass({
                            name: 'com.frida.vcb4_' + COUNT.dom,
                            implements: [Java.use('android.webkit.ValueCallback')],
                            methods: {
                                onReceiveValue: function (v) {
                                    H.log('[DOM] SSR=' + v);
                                }
                            }
                        }).$new());
                        // <head> 前1KB
                        view.evaluateJavascript('document.head.innerHTML.substring(0,1024)', Java.registerClass({
                            name: 'com.frida.vcb5_' + COUNT.dom,
                            implements: [Java.use('android.webkit.ValueCallback')],
                            methods: {
                                onReceiveValue: function (v) {
                                    H.dumpString('HEAD-' + COUNT.dom, '' + v);
                                }
                            }
                        }).$new());
                        COUNT.dom++;
                    }
                }
            });

            view.post(MyRunnable.$new());

            return this.onPageFinished(view, url);
        };
        H.log('[OK] WebViewClient.onPageFinished hooked (Java.registerClass版)');
    } catch (e) { H.warn('WebViewClient: ' + e); }

    // =========================================================
    // 6. Activity/Fragment 导航
    // =========================================================
    try {
        var Act = Java.use('android.app.Activity');
        Act.onCreate.overload('android.os.Bundle').implementation = function (bundle) {
            logN('Act.onCreate', this.$className);
            try {
                var intent = this.getIntent();
                var extras = intent.getExtras();
                if (extras) {
                    var keys = extras.keySet().iterator();
                    var s = '';
                    var cnt = 0;
                    while (keys.hasNext() && cnt < 12) {
                        var k = keys.next();
                        var v = '' + extras.get(k);
                        if (v.length > 120) v = v.substring(0, 120) + '...';
                        s += k + '=' + v + '; ';
                        cnt++;
                    }
                    if (s) H.log('[Act.intent] [' + s + ']');
                }
            } catch (e) {}
            this.onCreate(bundle);
        };
        Act.onWindowFocusChanged.implementation = function (hasFocus) {
            if (hasFocus) logN('Act.focus+', this.$className);
            this.onWindowFocusChanged(hasFocus);
        };
        H.log('[OK] Activity lifecycle hooked');
    } catch (e) {}

    try {
        var XFrag = Java.use('androidx.fragment.app.Fragment');
        XFrag.onCreateView.overload('android.view.LayoutInflater', 'android.view.ViewGroup', 'android.os.Bundle').implementation = function (inflater, container, bundle) {
            logN('Frag.onCreateView', this.$className);
            return this.onCreateView(inflater, container, bundle);
        };
        H.log('[OK] Fragment.onCreateView hooked');
    } catch (e) {}

    // =========================================================
    // 7. 预加载事件
    // =========================================================
    Java.enumerateLoadedClasses({
        onMatch: function (name) {
            if (name === 'com.xunmeng.pinduoduo.app_lego.v8.preload.LegoPreCreateServiceImpl') {
                try {
                    var cls = Java.use(name);
                    var methods = cls.class.getDeclaredMethods();
                    for (var i = 0; i < methods.length; i++) {
                        var mn = methods[i].getName();
                        if (mn.indexOf('preCreate') !== -1 || mn.indexOf('preLoad') !== -1 || mn.indexOf('preload') !== -1) {
                            (function (methodName, className) {
                                try {
                                    cls[methodName].overloads.forEach(function (overload) {
                                        overload.implementation = function () {
                                            COUNT.preload++;
                                            logN('PRELOAD.' + methodName, className);
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
                                            logN('PRELOAD.' + methodName, className);
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
        },
        onComplete: function () { H.log('[枚举] 预加载类扫描完成'); }
    });

    // =========================================================
    // 8. 当前页面WebView DOM即时抓取(用Java.registerClass修复)
    // =========================================================
    H.log('--- 尝试抓取当前WebView DOM(修复版) ---');
    try {
        Java.choose('android.webkit.WebView', {
            onMatch: function (instance) {
                H.log('[当前WebView] ' + instance.toString());
                try {
                    var url = instance.getUrl();
                    H.log('[当前WebView.url] ' + url);
                } catch (e) {}
                try {
                    var DomRunnable = Java.registerClass({
                        name: 'com.frida.curdomgrab',
                        implements: [Java.use('java.lang.Runnable')],
                        methods: {
                            run: function () {
                                Java.perform(function () {
                                    try {
                                        instance.evaluateJavascript('document.documentElement.outerHTML.length', Java.registerClass({
                                            name: 'com.frida.curvcb1',
                                            implements: [Java.use('android.webkit.ValueCallback')],
                                            methods: { onReceiveValue: function (v) { H.log('[当前DOM] HTML总长=' + v); } }
                                        }).$new());
                                    } catch (e) { H.warn('HTML长度: ' + e); }
                                    try {
                                        instance.evaluateJavascript('window.location.href', Java.registerClass({
                                            name: 'com.frida.curvcb2',
                                            implements: [Java.use('android.webkit.ValueCallback')],
                                            methods: { onReceiveValue: function (v) { H.log('[当前DOM] URL=' + v); } }
                                        }).$new());
                                    } catch (e) {}
                                    try {
                                        instance.evaluateJavascript('(function(){var m=document.getElementById("main");return m?m.innerHTML.length:-1})()', Java.registerClass({
                                            name: 'com.frida.curvcb3',
                                            implements: [Java.use('android.webkit.ValueCallback')],
                                            methods: { onReceiveValue: function (v) { H.log('[当前DOM] #main长度=' + v); } }
                                        }).$new());
                                    } catch (e) {}
                                    try {
                                        instance.evaluateJavascript('(function(){var g=document.querySelectorAll("[class*=goods],[class*=item],[class*=product],[class*=card]");return g?g.length:0})()', Java.registerClass({
                                            name: 'com.frida.curvcb4',
                                            implements: [Java.use('android.webkit.ValueCallback')],
                                            methods: { onReceiveValue: function (v) { H.log('[当前DOM] 商品DOM数=' + v); } }
                                        }).$new());
                                    } catch (e) {}
                                });
                            }
                        }
                    });
                    instance.post(DomRunnable.$new());
                    H.log('[当前WebView] DOM抓取已投递');
                } catch (e) { H.warn('DOM抓取失败: ' + e); }
            },
            onComplete: function () { H.log('[当前WebView] 枚举完成'); }
        });
    } catch (e) { H.warn('WebView枚举失败: ' + e); }

    H.heartbeat(10);
    H.log('=== orchard_v5 ready ===');
});
