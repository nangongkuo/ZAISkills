// trace_orchard_browse_v2.js - 拼多多果园->浏览商品链路追踪（精简版）
// 策略：先 enumerateLoadedClasses 找已加载类 直接 hook，不等 waitForClass
// 再配合 waitForClass 等后续加载

Java.perform(function () {
    var H = createHelper('orchard');
    H.log('=== trace_orchard_browse_v2 ===');

    var COUNT = { nav: 0, rpc: 0, render: 0, preload: 0, webview: 0 };
    var T0 = Java.use('java.lang.System').currentTimeMillis();

    function logNav(tag, detail) {
        var elapsed = Java.use('java.lang.System').currentTimeMillis() - T0;
        COUNT.nav++;
        H.log('[NAV +' + elapsed + 'ms] ' + tag + ' | ' + H.trunc(detail, 500));
    }

    // =========================================================
    // 0. 枚举已加载类，立即 hook 不等待
    // =========================================================
    var loadedPddClasses = [];
    Java.enumerateLoadedClasses({
        onMatch: function (name) {
            if (name.indexOf('xunmeng') !== -1 || name.indexOf('pinduoduo') !== -1) {
                loadedPddClasses.push(name);
            }
        },
        onComplete: function () {
            H.log('[枚举] 已加载 PDD 类: ' + loadedPddClasses.length + ' 个');

            // 打印关键已加载类（分批输出避免被截断）
            var keywords = ['HttpCall', 'Interceptor', 'LegoView', 'LegoPreCreate',
                'WebView', 'Activity', 'Fragment', 'RecyclerView',
                'SecureNative', 'OkHttp', 'GoodsList', 'GoodsDetail',
                'Orchard', 'TaskCenter', 'BrowseTask', 'WaterDrop',
                'MainFrame', 'NewPage', 'SearchResult', 'Container',
                'PreCreate', 'PreLoad', 'prefetch', 'warmup'];
            var keyClasses = [];
            for (var i = 0; i < loadedPddClasses.length; i++) {
                var cn = loadedPddClasses[i];
                for (var k = 0; k < keywords.length; k++) {
                    if (cn.toLowerCase().indexOf(keywords[k].toLowerCase()) !== -1) {
                        keyClasses.push(cn);
                        break;
                    }
                }
            }

            H.log('[枚举] 关键类: ' + keyClasses.length + ' 个');
            // 分段输出
            for (var j = 0; j < keyClasses.length; j += 20) {
                H.log('[枚举] ' + keyClasses.slice(j, j + 20).join('\n  '));
            }

            // 直接 hook 已加载的 PDD 类
            directHookPddClasses(keyClasses);
        }
    });

    function directHookPddClasses(classes) {
        for (var i = 0; i < classes.length; i++) {
            var cn = classes[i];
            try {
                var cls = Java.use(cn);

                // HttpCall / HttpEngine
                if (cn.indexOf('HttpCall') !== -1 || cn.indexOf('HttpEngine') !== -1) {
                    try {
                        var methods = cls.class.getDeclaredMethods();
                        for (var m = 0; m < methods.length; m++) {
                            var mn = methods[m].getName();
                            if (mn === 'build' || mn === 'execute' || mn === 'enqueue' || mn === 'sendRequest') {
                                (function (methodName, className) {
                                    try {
                                        cls[methodName].overloads.forEach(function (overload) {
                                            overload.implementation = function () {
                                                COUNT.rpc++;
                                                logNav('HTTP.' + methodName, className);
                                                return this[methodName].apply(this, arguments);
                                            };
                                        });
                                        H.log('[OK] 直接 hook ' + className + '.' + methodName);
                                    } catch (e) {}
                                })(mn, cn);
                            }
                        }
                    } catch (e) {}
                }

                // LegoView
                if (cn.indexOf('LegoView') !== -1 && cn.indexOf('$') === -1) {
                    try {
                        if (cls.loadUrl) {
                            cls.loadUrl.overloads.forEach(function (overload) {
                                overload.implementation = function () {
                                    logNav('LegoView.loadUrl', arguments[0]);
                                    return this.loadUrl.apply(this, arguments);
                                };
                            });
                            H.log('[OK] 直接 hook ' + cn + '.loadUrl');
                        }
                    } catch (e) {}
                }

                // LegoPreCreate
                if (cn.indexOf('PreCreate') !== -1) {
                    try {
                        var methods2 = cls.class.getDeclaredMethods();
                        for (var n = 0; n < methods2.length; n++) {
                            var mn2 = methods2[n].getName();
                            if (mn2.indexOf('preCreate') !== -1 || mn2.indexOf('preLoad') !== -1 ||
                                mn2.indexOf('warmUp') !== -1) {
                                (function (methodName, className) {
                                    try {
                                        cls[methodName].overloads.forEach(function (overload) {
                                            overload.implementation = function () {
                                                COUNT.preload++;
                                                logNav('PRELOAD.' + methodName, className);
                                                return this[methodName].apply(this, arguments);
                                            };
                                        });
                                        H.log('[OK] 直接 hook ' + className + '.' + methodName);
                                    } catch (e) {}
                                })(mn2, cn);
                            }
                        }
                    } catch (e) {}
                }

                // WebView 相关
                if (cn.indexOf('WebView') !== -1 && cn.indexOf('$') === -1 &&
                    (cn.indexOf('xunmeng') !== -1 || cn.indexOf('pinduoduo') !== -1)) {
                    try {
                        var methods3 = cls.class.getDeclaredMethods();
                        for (var p = 0; p < methods3.length; p++) {
                            var mn3 = methods3[p].getName();
                            if (mn3 === 'loadUrl' || mn3 === 'loadData' || mn3 === 'loadDataWithBaseURL') {
                                (function (methodName, className) {
                                    try {
                                        cls[methodName].overloads.forEach(function (overload) {
                                            overload.implementation = function () {
                                                COUNT.webview++;
                                                var url = arguments[0] ? '' + arguments[0] : '';
                                                logNav('PDD_WebView.' + methodName, className + ' url=' + H.trunc(url, 300));
                                                return this[methodName].apply(this, arguments);
                                            };
                                        });
                                        H.log('[OK] 直接 hook ' + className + '.' + methodName);
                                    } catch (e) {}
                                })(mn3, cn);
                            }
                        }
                    } catch (e) {}
                }
            } catch (e) {
                // 类加载但无法 hook，跳过
            }
        }
    }

    // =========================================================
    // 1. Activity 全生命周期（Framework 类，已加载）
    // =========================================================
    try {
        var Act = Java.use('android.app.Activity');
        Act.onCreate.overload('android.os.Bundle').implementation = function (bundle) {
            var name = this.$className;
            logNav('Activity.onCreate', name);
            // Intent extras
            try {
                var intent = this.getIntent();
                if (intent) {
                    var uri = intent.getData();
                    if (uri) H.log('[NAV.INTENT] uri=' + uri.toString());
                    var extras = intent.getExtras();
                    if (extras) {
                        var keys = extras.keySet().iterator();
                        var extraStr = '';
                        var count = 0;
                        while (keys.hasNext() && count < 8) {
                            var k = keys.next();
                            var v = extras.get(k);
                            extraStr += k + '=' + H.trunc('' + v, 80) + '; ';
                            count++;
                        }
                        if (extraStr) H.log('[NAV.INTENT] extras=[' + extraStr + ']');
                    }
                }
            } catch (e) {}
            this.onCreate(bundle);
        };

        Act.onResume.implementation = function () {
            H.log('[Act.onResume] ' + this.$className);
            this.onResume();
        };

        Act.onWindowFocusChanged.implementation = function (hasFocus) {
            if (hasFocus) {
                logNav('Act.focus+', this.$className + ' <- 可交互');
            }
            this.onWindowFocusChanged(hasFocus);
        };

        H.log('[OK] Activity lifecycle hooks');
    } catch (e) {
        H.warn('Activity hook fail: ' + e);
    }

    // =========================================================
    // 2. Fragment 生命周期
    // =========================================================
    H.waitForClass('androidx.fragment.app.Fragment', function (XFrag) {
        try {
            XFrag.onCreateView.overload('android.view.LayoutInflater', 'android.view.ViewGroup', 'android.os.Bundle').implementation = function (inflater, container, bundle) {
                logNav('Fragment.onCreateView', this.$className);
                return this.onCreateView(inflater, container, bundle);
            };

            XFrag.onResume.implementation = function () {
                H.log('[XFragment.onResume] ' + this.$className);
                this.onResume();
            };

            H.log('[OK] Fragment lifecycle hooks');
        } catch (e) {}
    }, 180);

    // =========================================================
    // 3. WebView 标准（loadUrl / onPageFinished）
    // =========================================================
    try {
        var WV = Java.use('android.webkit.WebView');
        WV.loadUrl.overload('java.lang.String').implementation = function (url) {
            COUNT.webview++;
            logNav('WebView.loadUrl', url);
            return this.loadUrl(url);
        };

        WV.loadUrl.overload('java.lang.String', 'java.util.Map').implementation = function (url, headers) {
            COUNT.webview++;
            logNav('WebView.loadUrl+hdr', url + ' hdr=' + H.trunc(headers ? headers.toString() : '', 200));
            return this.loadUrl(url, headers);
        };

        H.log('[OK] WebView.loadUrl hooks');
    } catch (e) {
        H.warn('WebView hook: ' + e);
    }

    try {
        var WC = Java.use('android.webkit.WebViewClient');
        WC.onPageStarted.implementation = function (view, url, favicon) {
            logNav('WebViewClient.onPageStarted', url);
            return this.onPageStarted(view, url, favicon);
        };

        WC.onPageFinished.implementation = function (view, url) {
            logNav('WebViewClient.onPageFinished+', url + ' <- 主文档加载完成');
            return this.onPageFinished(view, url);
        };

        H.log('[OK] WebViewClient hooks');
    } catch (e) {
        H.warn('WebViewClient hook: ' + e);
    }

    // =========================================================
    // 4. WebSettings
    // =========================================================
    try {
        var WS = Java.use('android.webkit.WebSettings');
        WS.setJavaScriptEnabled.implementation = function (flag) {
            H.log('[WebSettings] setJavaScriptEnabled=' + flag);
            return this.setJavaScriptEnabled(flag);
        };

        WS.setDomStorageEnabled.implementation = function (flag) {
            H.log('[WebSettings] setDomStorageEnabled=' + flag);
            return this.setDomStorageEnabled(flag);
        };

        H.log('[OK] WebSettings hooks');
    } catch (e) {}

    // =========================================================
    // 5. OkHttp Interceptor（网络请求+响应+耗时）
    // =========================================================
    H.waitForClass('okhttp3.Interceptor$Chain', function (Chain) {
        try {
            Chain.proceed.implementation = function (request) {
                var url = '';
                var method = '';
                var reqHeaders = '';
                var t0 = Java.use('java.lang.System').currentTimeMillis();
                try {
                    url = request.url().toString();
                    method = request.method();
                    var h = request.headers();
                    var signKeys = ['anti-content', 'x-api-version', 'access-token', 'Content-Type'];
                    for (var i = 0; i < signKeys.length; i++) {
                        var v = h.get(signKeys[i]);
                        if (v) reqHeaders += signKeys[i] + '=' + H.trunc(v, 60) + '; ';
                    }
                } catch (e) {}

                if (url && (url.indexOf('pinduoduo') !== -1 || url.indexOf('yangkeduo') !== -1 ||
                    url.indexOf('pdd') !== -1 || url.indexOf('hzpdd') !== -1)) {
                    COUNT.rpc++;
                    logNav('OkHttp.REQ', method + ' ' + H.trunc(url, 400) + ' hdr=[' + reqHeaders + ']');
                }

                var response = this.proceed(request);
                var t1 = Java.use('java.lang.System').currentTimeMillis();
                var elapsed = t1 - t0;

                if (url && (url.indexOf('pinduoduo') !== -1 || url.indexOf('yangkeduo') !== -1 ||
                    url.indexOf('pdd') !== -1 || url.indexOf('hzpdd') !== -1)) {
                    var respSize = 0;
                    try {
                        var respBody = response.peekBody(512 * 1024); // 最多 512KB
                        var bodyStr = respBody.string();
                        respSize = bodyStr.length();

                        logNav('OkHttp.RESP', H.trunc(url, 200) + ' size=' + respSize + ' time=' + elapsed + 'ms');

                        // 大响应分段输出
                        if (respSize > 200) {
                            H.dumpString('RESP-' + COUNT.rpc, bodyStr);
                        }

                        // 检测关键内容
                        try {
                            if (bodyStr.indexOf('"goods_list"') !== -1 || bodyStr.indexOf('"item_list"') !== -1 ||
                                bodyStr.indexOf('"goods_list_v2"') !== -1) {
                                logNav('GOODS_LIST', 'url=' + H.trunc(url, 200) + ' size=' + respSize + ' time=' + elapsed + 'ms');
                                // 检查商品数量
                                var goodsMatch = bodyStr.match(/"goods_list"\s*:|"item_list"\s*:/g);
                                if (goodsMatch) H.log('[GOODS] 匹配数=' + goodsMatch.length);
                            }
                            if (bodyStr.indexOf('"task_list"') !== -1 || bodyStr.indexOf('"water_drop"') !== -1 ||
                                bodyStr.indexOf('"orchard"') !== -1 || bodyStr.indexOf('"mission"') !== -1) {
                                logNav('ORCHARD_API', 'url=' + H.trunc(url, 200) + ' size=' + respSize + ' time=' + elapsed + 'ms');
                            }
                        } catch (e) {}
                    } catch (e) {
                        logNav('OkHttp.RESP', H.trunc(url, 200) + ' (body err) time=' + elapsed + 'ms');
                    }
                }

                return response;
            };

            H.log('[OK] OkHttp Interceptor hook');
        } catch (e) {
            H.warn('OkHttp hook: ' + e);
        }
    }, 180); // 180s 超时

    // =========================================================
    // 6. RecyclerView（商品列表渲染）
    // =========================================================
    H.waitForClass('androidx.recyclerview.widget.RecyclerView$Adapter', function (Adapter) {
        try {
            Adapter.notifyDataSetChanged.implementation = function () {
                var count = 0;
                try { count = this.getItemCount(); } catch (e) {}
                if (count > 0) {
                    COUNT.render++;
                    logNav('RV.notifyDataSetChanged', 'count=' + count + ' adapter=' + this.$className);
                }
                return this.notifyDataSetChanged();
            };

            Adapter.notifyItemRangeInserted.implementation = function (pos, cnt) {
                COUNT.render++;
                logNav('RV.notifyItemRangeInserted', 'pos=' + pos + ' count=' + cnt);
                return this.notifyItemRangeInserted(pos, cnt);
            };

            H.log('[OK] RecyclerView.Adapter hooks');
        } catch (e) {}
    }, 180);

    // RecyclerView 滚动（加载更多）
    H.waitForClass('androidx.recyclerview.widget.RecyclerView', function (RV) {
        try {
            RV.onScrollStateChanged.implementation = function (state) {
                if (state === 0) return this.onScrollStateChanged(state); // skip IDLE
                var stateNames = { '0': 'IDLE', '1': 'DRAGGING', '2': 'SETTLING' };
                try {
                    var lm = this.getLayoutManager();
                    var lastPos = -1;
                    if (lm && lm.getChildCount() > 0) {
                        lastPos = lm.getPosition(lm.getChildAt(lm.getChildCount() - 1));
                    }
                    var total = this.getAdapter() ? this.getAdapter().getItemCount() : 0;
                    H.log('[RV.scroll] ' + (stateNames['' + state] || state) + ' lastVisible=' + lastPos + ' total=' + total);
                    if (total > 0 && lastPos >= total - 3) {
                        logNav('RV_NEAR_BOTTOM', 'last=' + lastPos + ' total=' + total + ' <- 触发加载更多');
                    }
                } catch (e) {}
                return this.onScrollStateChanged(state);
            };

            H.log('[OK] RecyclerView scroll hook');
        } catch (e) {}
    }, 180);

    // =========================================================
    // 7. Instrumentation.startActivity（最全的导航追踪）
    // =========================================================
    try {
        var Inst = Java.use('android.app.Instrumentation');
        Inst.execStartActivity.overload('android.content.Context', 'android.os.IBinder', 'android.os.IBinder', 'android.app.Activity', 'android.content.Intent', 'int', 'android.os.Bundle').implementation = function (who, contextThread, token, target, intent, requestCode, options) {
            var comp = '';
            var uri = '';
            try {
                comp = intent.getComponent() ? intent.getComponent().toString() : '';
                uri = intent.getData() ? intent.getData().toString() : '';
            } catch (e) {}
            if (comp && (comp.indexOf('xunmeng') !== -1 || comp.indexOf('pinduoduo') !== -1 ||
                comp.indexOf('MainFrame') !== -1 || comp.indexOf('NewPage') !== -1 ||
                comp.indexOf('Search') !== -1 || comp.indexOf('Web') !== -1 ||
                comp.indexOf('Lego') !== -1 || comp.indexOf('Orchard') !== -1)) {
                logNav('startActivity', comp + ' uri=' + H.trunc(uri, 300));
            }
            return this.execStartActivity(who, contextThread, token, target, intent, requestCode, options);
        };

        H.log('[OK] Instrumentation.startActivity hook');
    } catch (e) {
        H.warn('Instrumentation hook: ' + e);
    }

    // =========================================================
    // 8. SecureNative.gal（拼多多 JNI 签名）
    // =========================================================
    H.waitForClass('com.xunmeng.pinduoduo.secure.SecureNative', function (SN) {
        try {
            H.hookOverLoads(SN, 'gal', function (args, sig) {
                COUNT.rpc++;
                logNav('SecureNative.gal', 'JNI签名 sig=' + sig.join(','));
            });

            H.log('[OK] SecureNative.gal hook');
        } catch (e) {}
    }, 180);

    // =========================================================
    // 心跳
    // =========================================================
    H.heartbeat(10);
    H.log('=== orchard_browse_v2 fully staged ===');
});
