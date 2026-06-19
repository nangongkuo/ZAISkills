// trace_pdd_rpc.js - 拼多多网络请求追踪
// Hook: HttpCall + PDD RPC + 新页面 Activity
//
// 用法:
//   frida -U -f <pkg> -l lib/_common.js -l lib/_anti_detect.js -l 00_bootstrap.js -l pinduoduo/trace_pdd_rpc.js

Java.perform(function () {
    var H = createHelper('pdd');
    H.log('=== trace_pdd_rpc (Pinduoduo) ===');

    var COUNT = { req: 0, resp: 0, act: 0 };

    // =========================================================
    // 1. HttpCall - 拼多多核心 HTTP 客户端
    // =========================================================
    H.waitForClass('com.xunmeng.pinduoduo.network.HttpCall', function (HC) {
        // Builder 模式: HttpCall.Builder.build()
        try {
            var Builder = HC.Builder || Java.use('com.xunmeng.pinduoduo.network.HttpCall$Builder');
            H.hookOverloads(Builder, 'build', function (args, sig) {
                COUNT.req++;
                try {
                    var builder = this;
                    var url = '';
                    var method = '';
                    // 尝试读取 url 和 method
                    try { url = builder.url ? builder.url.value : (builder.mUrl || ''); } catch (e) {}
                    try { method = builder.method ? builder.method.value : (builder.mMethod || ''); } catch (e) {}
                    H.log('[HttpCall.build] ' + method + ' ' + H.trunc(url, 300));
                } catch (e) {
                    H.log('[HttpCall.build] (parse err)');
                }
                return this.build();
            });
            H.log('[OK] HttpCall.Builder.build hooked');
        } catch (e) {
            H.warn('HttpCall.Builder hook failed: ' + e);
        }
    }, 30);

    // 备选: 旧版 HttpCall
    H.waitForClass('com.pinduoduo.network.HttpCall', function (HC) {
        H.hookOverloads(HC, 'execute', function (args, sig) {
            COUNT.req++;
            H.log('[HttpCall(legacy).execute]');
            return this.execute();
        });
    }, 30);

    // =========================================================
    // 2. OkHttp 拦截器（通用兜底，签名 header 在这层加）
    // =========================================================
    H.waitForClass('okhttp3.Interceptor$Chain', function (Chain) {
        try {
            Chain.proceed.implementation = function (request) {
                var url = '';
                var headers = '';
                try {
                    url = request.url().toString();
                    var h = request.headers();
                    // 检查拼多多特有签名 header
                    var signKeys = ['anti-content', 'x-api-version', 'access-token', 'Bearer'];
                    for (var i = 0; i < signKeys.length; i++) {
                        var v = h.get(signKeys[i]);
                        if (v) {
                            headers += signKeys[i] + '=' + H.trunc(v, 80) + ' ';
                        }
                    }
                } catch (e) {}
                if (url && (url.indexOf('pinduoduo') !== -1 || url.indexOf('yangkeduo') !== -1 || url.indexOf('pdd') !== -1)) {
                    COUNT.req++;
                    H.log('[OkHttp.proceed] ' + H.trunc(url, 300) + ' headers=[' + headers + ']');
                }
                return this.proceed(request);
            };
        } catch (e) {}
    }, 30);

    // =========================================================
    // 3. SecureNative - 拼多多安全签名（JNI）
    // =========================================================
    H.waitForClass('com.xunmeng.pinduoduo.secure.SecureNative', function (SN) {
        try {
            H.hookOverloads(SN, 'gal', function (args, sig) {
                COUNT.req++;
                H.log('[SecureNative.gal] sig=' + sig.length + 'p (JNI 签名)');
                // 参数和返回值是 byte[]，可以 dump
                try {
                    if (args && args[0]) {
                        H.dumpBytes('SecureNative.gal.in', Java.array('byte', args[0]));
                    }
                } catch (e) {}
                var result = this.gal.apply(this, args);
                try {
                    if (result) {
                        H.dumpBytes('SecureNative.gal.out', result);
                    }
                } catch (e) {}
                return result;
            });
            H.log('[OK] SecureNative.gal hooked');
        } catch (e) {
            H.warn('SecureNative.gal hook failed: ' + e);
        }
    }, 30);

    // =========================================================
    // 4. Activity 跳转（关键页面追踪）
    // =========================================================
    var KEY_ACTIVITIES = [
        'MainFrameActivity',      // 首页
        'NewPageActivity',        // 商品详情
        'SearchResultActivity',   // 搜索
        'LoginActivity',          // 登录
        'SplashActivity'          // 启动页
    ];

    H.waitForClass('android.app.Activity', function (Act) {
        try {
            Act.onCreate.overload('android.os.Bundle').implementation = function (bundle) {
                var name = this.$className;
                for (var i = 0; i < KEY_ACTIVITIES.length; i++) {
                    if (name.indexOf(KEY_ACTIVITIES[i]) !== -1) {
                        COUNT.act++;
                        H.log('[Act.onCreate] * ' + name);
                        break;
                    }
                }
                this.onCreate(bundle);
            };
        } catch (e) {}
    });

    // =========================================================
    // 5. LegoView（Lego 渲染引擎）追踪
    // =========================================================
    H.waitForClass('com.xunmeng.pinduoduo.lego.view.LegoView', function (LV) {
        try {
            LV.loadUrl.implementation = function (url) {
                COUNT.act++;
                H.log('[LegoView.loadUrl] ' + H.trunc(url, 500));
                return this.loadUrl(url);
            };
        } catch (e) {}
    }, 30);

    H.waitForClass('com.xunmeng.pinduoduo.lego.service.LegoPreCreateServiceImpl', function (LPS) {
        try {
            LPS.preCreate.implementation = function () {
                COUNT.act++;
                H.log('[LegoPreCreateServiceImpl.preCreate]');
                return this.preCreate();
            };
        } catch (e) {}
    }, 30);

    // =========================================================
    // 心跳
    // =========================================================
    H.heartbeat(5);
    H.log('=== pdd hooks staged, waiting class loads ===');
});
