// trace_orchard_browse.js - 拼多多多多果园+浏览商品1分钟 全链路追踪
// 目标场景：多多果园领水滴任务 -> 点击浏览商品1分钟 -> 商品浏览页完成渲染
// 追踪：Activity/Fragment 导航 + H5/Lego容器初始化 + RPC请求时序 + 渲染完成
//
// 用法：frida -U -p <pid> -l lib/_common.js -l lib/_anti_detect.js -l 00_bootstrap.js \
//     -l pinduoduo/trace_pdd_rpc.js -l pinduoduo/trace_orchard_browse.js

Java.perform(function () {
    var H = createHelper('orchard');
    H.log('=== trace_orchard_browse started ===');

    var COUNT = { nav: 0, rpc: 0, render: 0, preload: 0 };
    var NAV_LOG = []; // 导航时序记录

    function logNav(tag, detail) {
        var now = Java.use('java.lang.System').currentTimeMillis();
        NAV_LOG.push({ ms: now, tag: tag, detail: detail });
        COUNT.nav++;
        H.log('[NAV] ' + tag + ' | ' + H.trunc(detail, 400));
    }

    // =========================================================
    // 1. Activity 全生命周期（比 trace_pdd_rpc 更全）
    // =========================================================
    H.waitForClass('android.app.Activity', function (Act) {
        // onCreate
        try {
            Act.onCreate.overload('android.os.Bundle').implementation = function (bundle) {
                var name = this.$className;
                logNav('Activity.onCreate', name);
                // 打印 intent extras
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
                            while (keys.hasNext() && count < 10) {
                                var k = keys.next();
                                var v = extras.get(k);
                                extraStr += k + '=' + H.trunc('' + v, 100) + '; ';
                                count++;
                            }
                            if (extraStr) H.log('[NAV.INTENT] extras=[' + extraStr + ']');
                        }
                    }
                } catch (e) {}
                this.onCreate(bundle);
            };
        } catch (e) {}

        // onResume
        try {
            Act.onResume.implementation = function () {
                H.log('[Act.onResume] ' + this.$className);
                this.onResume();
            };
        } catch (e) {}

        // onWindowFocusChanged（真正可交互的时机）
        try {
            Act.onWindowFocusChanged.implementation = function (hasFocus) {
                if (hasFocus) {
                    H.log('[Act.focus+] ' + this.$className + ' <- 可交互');
                }
                this.onWindowFocusChanged(hasFocus);
            };
        } catch (e) {}
    });

    // =========================================================
    // 2. Fragment 生命周期（果园/任务页可能是 Fragment）
    // =========================================================
    H.waitForClass('android.app.Fragment', function (Frag) {
        try {
            Frag.onCreateView.implementation = function (inflater, container, bundle) {
                logNav('Fragment.onCreateView', this.$className);
                return this.onCreateView(inflater, container, bundle);
            };
        } catch (e) {}
    }, 60);

    H.waitForClass('androidx.fragment.app.Fragment', function (XFrag) {
        try {
            XFrag.onCreateView.overload('android.view.LayoutInflater', 'android.view.ViewGroup', 'android.os.Bundle').implementation = function (inflater, container, bundle) {
                logNav('XFragment.onCreateView', this.$className);
                return this.onCreateView(inflater, container, bundle);
            };
        } catch (e) {}

        try {
            XFrag.onResume.implementation = function () {
                H.log('[XFragment.onResume] ' + this.$className);
                this.onResume();
            };
        } catch (e) {}
    }, 60);

    // =========================================================
    // 3. WebView 加载时序（主文档请求 + 页面完成）
    // =========================================================
    H.waitForClass('android.webkit.WebView', function (WV) {
        try {
            WV.loadUrl.overload('java.lang.String').implementation = function (url) {
                logNav('WebView.loadUrl', url);
                return this.loadUrl(url);
            };
        } catch (e) {}

        try {
            WV.loadUrl.overload('java.lang.String', 'java.util.Map').implementation = function (url, headers) {
                var hdr = headers ? headers.toString() : '';
                logNav('WebView.loadUrl+headers', url + ' headers=' + H.trunc(hdr, 200));
                return this.loadUrl(url, headers);
            };
        } catch (e) {}

        try {
            WV.loadDataWithBaseURL.implementation = function (bUrl, data, mime, enc, hUrl) {
                logNav('WebView.loadData', 'base=' + H.trunc(bUrl, 200) + ' dataLen=' + (data ? data.length() : 0));
                return this.loadDataWithBaseURL(bUrl, data, mime, enc, hUrl);
            };
        } catch (e) {}
    }, 60);

    // WebViewClient.onPageStarted / onPageFinished
    H.waitForClass('android.webkit.WebViewClient', function (WVC) {
        try {
            WVC.onPageStarted.implementation = function (view, url, favicon) {
                logNav('WebViewClient.onPageStarted', url);
                return this.onPageStarted(view, url, favicon);
            };
        } catch (e) {}

        try {
            WVC.onPageFinished.implementation = function (view, url) {
                logNav('WebViewClient.onPageFinished', url + ' <- 页面加载完成');
                return this.onPageFinished(view, url);
            };
        } catch (e) {}
    }, 60);

    // =========================================================
    // 4. LegoView（拼多多自研渲染引擎）
    // =========================================================
    H.waitForClass('com.xunmeng.pinduoduo.lego.view.LegoView', function (LV) {
        try {
            LV.loadUrl.implementation = function (url) {
                logNav('LegoView.loadUrl', url);
                return this.loadUrl(url);
            };
        } catch (e) {}

        // LegoView 渲染完成回调
        try {
            var lvCallback = LV.onPageFinished;
            if (lvCallback) {
                // 尝试 hook render 完成
            }
        } catch (e) {}
    }, 30);

    // LegoPreCreateServiceImpl 预创建
    H.waitForClass('com.xunmeng.pinduoduo.lego.service.LegoPreCreateServiceImpl', function (LPS) {
        try {
            LPS.preCreate.implementation = function () {
                COUNT.preload++;
                logNav('LegoPreCreate.preCreate', '<- 预创建容器');
                return this.preCreate();
            };
        } catch (e) {}

        try {
            H.hookOverLoads(LPS, 'preCreateActivity', function (args, sig) {
                COUNT.preload++;
                logNav('LegoPreCreate.preCreateActivity', '<- 预创建Activity');
            });
        } catch (e) {}
    }, 30);

    // =========================================================
    // 5. OkHttp 拦截器 - 捕获完整请求/响应（含时序）
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
                    var signKeys = ['anti-content', 'x-api-version', 'access-token', 'Bearer',
                        'X-Gorgon', 'X-Khronos', 'X-Ladon', 'X-SS-ReqTicket',
                        'Content-Type', 'User-Agent'];
                    for (var i = 0; i < signKeys.length; i++) {
                        var v = h.get(signKeys[i]);
                        if (v) reqHeaders += signKeys[i] + '=' + H.trunc(v, 80) + '; ';
                    }
                } catch (e) {}

                // 只记录拼多多相关请求
                if (url && (url.indexOf('pinduoduo') !== -1 || url.indexOf('yangkeduo') !== -1 ||
                    url.indexOf('pdd') !== -1 || url.indexOf('hzpdd') !== -1)) {
                    COUNT.rpc++;
                    H.log('[OkHttp.REQ] ' + method + ' ' + H.trunc(url, 400) + ' hdr=[' + reqHeaders + ']');
                }

                var response = this.proceed(request);
                var t1 = Java.use('java.lang.System').currentTimeMillis();

                if (url && (url.indexOf('pinduoduo') !== -1 || url.indexOf('yangkeduo') !== -1 ||
                    url.indexOf('pdd') !== -1 || url.indexOf('hzpdd') !== -1)) {
                    try {
                        var respBody = response.peekBody(1024 * 1024); // 最多 1MB
                        var bodyStr = respBody.string();
                        var bodyLen = bodyStr.length();
                        H.log('[OkHttp.RESP] ' + H.trunc(url, 200) + ' size=' + bodyLen + ' time=' + (t1 - t0) + 'ms');

                        // 大响应分段输出
                        if (bodyLen > 200) {
                            H.dumpString('RESP-' + COUNT.rpc, bodyStr);
                        }

                        // 尝试解析关键字段
                        try {
                            if (bodyStr.indexOf('"goods_list"') !== -1 || bodyStr.indexOf('"goods_list_v2"') !== -1) {
                                var goodsStart = bodyStr.indexOf('"goods_list"');
                                var sample = bodyStr.substring(Math.max(0, goodsStart - 50), Math.min(bodyStr.length, goodsStart + 2000));
                                logNav('GOODS_LIST_FOUND', 'url=' + H.trunc(url, 200) + ' offset=' + goodsStart + ' time=' + (t1 - t0) + 'ms');
                                H.dumpString('GOODS-' + COUNT.rpc, sample);
                            }

                            if (bodyStr.indexOf('"task_list"') !== -1 || bodyStr.indexOf('"water_drop"') !== -1 ||
                                bodyStr.indexOf('"orchard"') !== -1) {
                                logNav('ORCHARD_API', 'url=' + H.trunc(url, 200) + ' time=' + (t1 - t0) + 'ms');
                            }
                        } catch (e) {}
                    } catch (e) {
                        H.log('[OkHttp.RESP] ' + H.trunc(url, 200) + ' (body read err: ' + e + ')');
                    }
                }

                return response;
            };
        } catch (e) {}
    }, 30);

    // =========================================================
    // 6. WebView 设置（调试/JS接口）
    // =========================================================
    H.waitForClass('android.webkit.WebSettings', function (WS) {
        try {
            WS.setJavaScriptEnabled.implementation = function (flag) {
                H.log('[WebSettings] setJavaScriptEnabled=' + flag);
                return this.setJavaScriptEnabled(flag);
            };
        } catch (e) {}

        try {
            WS.setDomStorageEnabled.implementation = function (flag) {
                H.log('[WebSettings] setDomStorageEnabled=' + flag);
                return this.setDomStorageEnabled(flag);
            };
        } catch (e) {}

        try {
            WS.setCacheMode.implementation = function (mode) {
                var modeNames = { '-1': 'LOAD_DEFAULT', '0': 'LOAD_NORMAL', '1': 'LOAD_CACHE_ELSE_NETWORK', '2': 'LOAD_NO_CACHE', '3': 'LOAD_CACHE_ONLY' };
                H.log('[WebSettings] setCacheMode=' + (modeNames['' + mode] || mode));
                return this.setCacheMode(mode);
            };
        } catch (e) {}
    }, 30);

    // =========================================================
    // 7. RecyclerView.Adapter 数据变更检测（商品列表渲染）
    // =========================================================
    H.waitForClass('androidx.recyclerview.widget.RecyclerView$Adapter', function (Adapter) {
        try {
            Adapter.notifyDataSetChanged.implementation = function () {
                var adapter = this;
                var count = 0;
                try { count = adapter.getItemCount(); } catch (e) {}
                if (count > 0 && count <= 500) {
                    COUNT.render++;
                    H.log('[RV.Adapter.notifyDataSetChanged] itemCount=' + count + ' adapter=' + adapter.$className);
                }
                return this.notifyDataSetChanged();
            };
        } catch (e) {}

        try {
            Adapter.notifyItemRangeInserted.implementation = function (positionStart, itemCount) {
                COUNT.render++;
                H.log('[RV.Adapter.notifyItemRangeInserted] pos=' + positionStart + ' count=' + itemCount + ' adapter=' + this.$className);
                return this.notifyItemRangeInserted(positionStart, itemCount);
            };
        } catch (e) {}

        try {
            Adapter.notifyItemRangeChanged.implementation = function (positionStart, itemCount) {
                COUNT.render++;
                H.log('[RV.Adapter.notifyItemRangeChanged] pos=' + positionStart + ' count=' + itemCount);
                return this.notifyItemRangeChanged(positionStart, itemCount);
            };
        } catch (e) {}
    }, 60);

    // =========================================================
    // 8. startActivity + Intent 解析（导航链路）
    // =========================================================
    H.waitForClass('android.app.Instrumentation', function (Inst) {
        try {
            Inst.execStartActivity.overload('android.content.Context', 'android.os.IBinder', 'android.os.IBinder', 'android.app.Activity', 'android.content.Intent', 'int', 'android.os.Bundle').implementation = function (who, contextThread, token, target, intent, requestCode, options) {
                var comp = '';
                var url = '';
                try {
                    comp = intent.getComponent() ? intent.getComponent().toString() : '';
                    url = intent.getData() ? intent.getData().toString() : '';
                } catch (e) {}
                if (comp || url) {
                    logNav('startActivity', comp + ' url=' + H.trunc(url, 300));
                }
                return this.execStartActivity(who, contextThread, token, target, intent, requestCode, options);
            };
        } catch (e) {}
    }, 30);

    // =========================================================
    // 9. ScrollView/RecyclerView 滚动检测（下滑加载更多）
    // =========================================================
    H.waitForClass('androidx.recyclerview.widget.RecyclerView', function (RV) {
        try {
            RV.onScrollStateChanged.implementation = function (state) {
                var stateNames = { '0': 'IDLE', '1': 'DRAGGING', '2': 'SETTLING' };
                if (state === 0) return this.onScrollStateChanged(state); // 只记录非 IDLE
                try {
                    var lm = this.getLayoutManager();
                    var lastPos = -1;
                    if (lm) {
                        try {
                            var childCount = lm.getChildCount();
                            if (childCount > 0) {
                                var lastChild = lm.getChildAt(childCount - 1);
                                lastPos = lm.getPosition(lastChild);
                            }
                        } catch (e) {}
                    }
                    var total = this.getAdapter() ? this.getAdapter().getItemCount() : 0;
                    H.log('[RV.SCROLL] state=' + (stateNames['' + state] || state) + ' lastVisible=' + lastPos + ' total=' + total);
                    // 接近底部时标记
                    if (total > 0 && lastPos >= total - 3) {
                        logNav('RV_NEAR_BOTTOM', 'lastVisible=' + lastPos + ' total=' + total + ' <- 触发加载更多');
                    }
                } catch (e) {}
                return this.onScrollStateChanged(state);
            };
        } catch (e) {}
    }, 60);

    // =========================================================
    // 10. Handler 消息追踪（主线程调度）
    // =========================================================
    H.waitForClass('android.os.Handler', function (Hdlr) {
        try {
            Hdlr.dispatchMessage.implementation = function (msg) {
                // 只记录延迟消息（可能的预加载）
                try {
                    if (msg && msg.getWhen && msg.getWhen() > 0) {
                        var when = msg.getWhen();
                        var what = msg.what;
                        var target = msg.getTarget() ? msg.getTarget().toString() : '';
                        if (when > 1000) { // 延迟 >1s 的可能是定时/预加载
                            // 不高频打印，只记录
                        }
                    }
                } catch (e) {}
                return this.dispatchMessage(msg);
            };
        } catch (e) {}
    }, 60);

    // =========================================================
    // 心跳 + 总结
    // =========================================================
    H.heartbeat(8);
    H.log('=== orchard_browse hooks staged, waiting... ===');
});
