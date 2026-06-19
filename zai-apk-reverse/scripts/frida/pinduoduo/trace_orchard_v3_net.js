// trace_orchard_v3_net.js - 第二轮：专注拼多多 hera 网络层 + WebView 响应
// 目标：捕获浏览商品页的所有 RPC 请求和响应
Java.perform(function () {
    var H = createHelper('net');
    H.log('=== trace_orchard_v3_net (hera 网络层) ===');

    var COUNT = { req: 0, resp: 0 };
    var T0 = Java.use('java.lang.System').currentTimeMillis();

    function logNav(tag, detail) {
        var elapsed = Java.use('java.lang.System').currentTimeMillis() - T0;
        COUNT.req++;
        H.log('[NET +' + elapsed + 'ms] ' + tag + ' | ' + H.trunc(detail, 500));
    }

    // =========================================================
    // 1. WrapperInterceptor（拼多多 hera 网络层拦截器）
    // =========================================================
    H.waitForClass('com.xunmeng.pinduoduo.net_adapter.hera.interceptors.WrapperInterceptor', function (WI) {
        try {
            var methods = WI.class.getDeclaredMethods();
            for (var i = 0; i < methods.length; i++) {
                var mn = methods[i].getName();
                if (mn === 'intercept' || mn === 'doIntercept' || mn === 'onIntercept') {
                    (function (methodName, className) {
                        try {
                            WI[methodName].overloads.forEach(function (overload) {
                                overload.implementation = function () {
                                    COUNT.req++;
                                    logNav('Hera.intercept', className + '.' + methodName + ' args=' + arguments.length);
                                    // 尝试提取 URL
                                    for (var a = 0; a < arguments.length; a++) {
                                        try {
                                            var argStr = '' + arguments[a];
                                            if (argStr.indexOf('http') >= 0 || argStr.indexOf('pinduoduo') !== -1 || argStr.indexOf('yangkeduo') !== -1) {
                                                logNav('Hera.URL', H.trunc(argStr, 500));
                                            }
                                        } catch (e) {}
                                    }
                                    return this[methodName].apply(this, arguments);
                                };
                            });
                            H.log('[OK] hook ' + className + '.' + methodName);
                        } catch (e) { H.warn('hera hook err: ' + e); }
                    })(mn, 'WrapperInterceptor');
                }
            }
        } catch (e) { H.warn('WrapperInterceptor: ' + e); }
    }, 120);

    // =========================================================
    // 2. OkHttp RealCall（比 Interceptor 更底层）
    // =========================================================
    H.waitForClass('okhttp3.RealCall', function (RC) {
        try {
            RC.execute.implementation = function () {
                COUNT.req++;
                var url = '';
                try { url = this.request().url().toString(); } catch (e) {}
                logNav('RealCall.execute', H.trunc(url, 400));
                var t0 = Java.use('java.lang.System').currentTimeMillis();
                var resp = this.execute();
                var t1 = Java.use('java.lang.System').currentTimeMillis();
                logNav('RealCall.execute.RESP', H.trunc(url, 200) + ' time=' + (t1 - t0) + 'ms');
                return resp;
            };
            H.log('[OK] RealCall.execute hook');
        } catch (e) {}

        try {
            RC.enqueue.implementation = function (callback) {
                COUNT.req++;
                var url = '';
                try { url = this.request().url().toString(); } catch (e) {}
                logNav('RealCall.enqueue', H.trunc(url, 400));
                return this.enqueue(callback);
            };
            H.log('[OK] RealCall.enqueue hook');
        } catch (e) {}
    }, 120);

    // =========================================================
    // 3. OkHttp Response（捕获响应体）
    // =========================================================
    H.waitForClass('okhttp3.internal.http.RealResponseBody', function (Body) {
        try {
            Body.string.implementation = function () {
                var result = this.string();
                var len = result ? result.length() : 0;
                // 只记录拼多多相关
                if (len > 100) {
                    logNav('ResponseBody.string', 'len=' + len);
                    // 检查关键内容
                    if (result.indexOf('goods_list') !== -1 || result.indexOf('item_list') !== -1) {
                        logNav('GOODS_IN_RESPONSE', 'bodyLen=' + len);
                        H.dumpString('GOODS-' + COUNT.resp, result);
                        COUNT.resp++;
                    }
                    if (result.indexOf('task_list') !== -1 || result.indexOf('water') !== -1 ||
                        result.indexOf('mission') !== -1 || result.indexOf('orchard') !== -1) {
                        logNav('ORCHARD_IN_RESPONSE', 'bodyLen=' + len);
                        H.dumpString('ORCHARD-' + COUNT.resp, result);
                        COUNT.resp++;
                    }
                    if (result.indexOf('goods') !== -1 && result.indexOf('price') !== -1) {
                        logNav('GOODS_PRICE_IN_RESPONSE', 'bodyLen=' + len);
                    }
                }
                return result;
            };
            H.log('[OK] RealResponseBody.string hook');
        } catch (e) { H.warn('RealResponseBody: ' + e); }
    }, 120);

    // =========================================================
    // 4. URL.openConnection（最底层兜底）
    // =========================================================
    try {
        var URL = Java.use('java.net.URL');
        URL.openConnection.overload().implementation = function () {
            var url = this.toString();
            if (url.indexOf('pinduoduo') !== -1 || url.indexOf('yangkeduo') !== -1 ||
                url.indexOf('pdd') !== -1 || url.indexOf('hzpdd') !== -1) {
                logNav('URL.openConnection', H.trunc(url, 400));
            }
            return this.openConnection();
        };
        H.log('[OK] URL.openConnection hook');
    } catch (e) {}

    // =========================================================
    // 5. WebView 应该已有的 hook - onPageStarted/Finished
    // =========================================================
    try {
        var WVC = Java.use('android.webkit.WebViewClient');
        WVC.onPageStarted.implementation = function (view, url, favicon) {
            logNav('WebViewClient.onPageStarted', url);
            return this.onPageStarted(view, url, favicon);
        };
        WVC.onPageFinished.implementation = function (view, url) {
            logNav('WebViewClient.onPageFinished+', url + ' <- 主文档加载完成');
            return this.onPageFinished(view, url);
        };
        H.log('[OK] WebViewClient.onPageStarted/Finished hook');
    } catch (e) {}

    // =========================================================
    // 6. FastJS/Meco WebView（拼多多自研 WebView）
    // =========================================================
    H.waitForClass('com.xunmeng.pinduoduo.fastjs.api.FastJsWebView', function (FJW) {
        try {
            FJW.loadUrl.overload('java.lang.String').implementation = function (url) {
                logNav('FastJsWebView.loadUrl', url);
                return this.loadUrl(url);
            };
            H.log('[OK] FastJsWebView.loadUrl hook');
        } catch (e) {}

        try {
            FJW.loadUrl.overload('java.lang.String', 'java.util.Map').implementation = function (url, headers) {
                logNav('FastJsWebView.loadUrl+h', url + ' hdr=' + H.trunc(headers ? headers.toString() : '', 200));
                return this.loadUrl(url, headers);
            };
        } catch (e) {}
    }, 120);

    // =========================================================
    // 7. InternalLegoView（拼多多 Lego 渲染引擎）
    // =========================================================
    H.waitForClass('com.xunmeng.pinduoduo.lego.v8.view.InternalLegoView', function (ILV) {
        try {
            var methods = ILV.class.getDeclaredMethods();
            for (var i = 0; i < methods.length; i++) {
                var mn = methods[i].getName();
                if (mn === 'loadUrl' || mn === 'loadData' || mn === 'renderTemplate' ||
                    mn === 'onPageFinished' || mn === 'onTemplateLoaded') {
                    (function (methodName) {
                        try {
                            ILV[methodName].overloads.forEach(function (overload) {
                                overload.implementation = function () {
                                    logNav('LegoView.' + methodName, 'args=' + arguments.length + ' class=' + this.$className);
                                    for (var a = 0; a < arguments.length && a < 2; a++) {
                                        try {
                                            var s = '' + arguments[a];
                                            if (s.length > 10) {
                                                H.log('[LegoView.' + methodName + '.arg' + a + '] ' + H.trunc(s, 300));
                                            }
                                        } catch (e) {}
                                    }
                                    return this[methodName].apply(this, arguments);
                                };
                            });
                        } catch (e) {}
                    })(mn);
                }
            }
            H.log('[OK] InternalLegoView hooks');
        } catch (e) {}
    }, 120);

    // =========================================================
    // 8. WebViewChromeClient.onProgressChanged（加载进度）
    // =========================================================
    try {
        var WCC = Java.use('android.webkit.WebChromeClient');
        // 不直接 hook onProgressChanged（太高频），只 hook 100%
    } catch (e) {}

    // =========================================================
    // 9. RecyclerView（商品列表渲染）
    // =========================================================
    H.waitForClass('androidx.recyclerview.widget.RecyclerView$Adapter', function (Adapter) {
        try {
            Adapter.notifyDataSetChanged.implementation = function () {
                var count = 0;
                try { count = this.getItemCount(); } catch (e) {}
                if (count > 0 && count < 500) {
                    logNav('RV.notifyDataSetChanged', 'count=' + count + ' cls=' + this.$className);
                }
                return this.notifyDataSetChanged();
            };

            Adapter.notifyItemRangeInserted.implementation = function (pos, cnt) {
                logNav('RV.notifyItemRangeInserted', 'pos=' + pos + ' count=' + cnt);
                return this.notifyItemRangeInserted(pos, cnt);
            };
            H.log('[OK] RecyclerView.Adapter hooks');
        } catch (e) {}
    }, 120);

    H.waitForClass('androidx.recyclerview.widget.RecyclerView', function (RV) {
        try {
            RV.onScrollStateChanged.implementation = function (state) {
                if (state === 0) return this.onScrollStateChanged(state);
                var sn = { '0': 'IDLE', '1': 'DRAGGING', '2': 'SETTLING' };
                try {
                    var lm = this.getLayoutManager();
                    var lastPos = -1;
                    if (lm && lm.getChildCount() > 0) {
                        lastPos = lm.getPosition(lm.getChildAt(lm.getChildCount() - 1));
                    }
                    var total = this.getAdapter() ? this.getAdapter().getItemCount() : 0;
                    if (total > 0 && lastPos >= total - 3) {
                        logNav('RV_NEAR_BOTTOM', 'last=' + lastPos + ' total=' + total);
                    }
                } catch (e) {}
                return this.onScrollStateChanged(state);
            };
            H.log('[OK] RecyclerView scroll hook');
        } catch (e) {}
    }, 120);

    H.heartbeat(8);
    H.log('=== v3_net hooks staged ===');
});
