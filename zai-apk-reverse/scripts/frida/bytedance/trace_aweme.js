// trace_aweme.js - 字节系(抖音/头条/火山) 网络请求追踪
// Hook: SSSocket/TTEncrypt/ApiHandler + X-Gorgon 签名 + TTWebView URL
//
// 用法（合并到 task 脚本链）：
//   frida -U -f <pkg> -l lib/_common.js -l lib/_anti_detect.js -l 00_bootstrap.js -l bytedance/trace_aweme.js

Java.perform(function () {
    var H = createHelper('aweme');
    H.log('=== trace_aweme (ByteDance) ===');

    var COUNT = { req: 0, resp: 0, url: 0, sign: 0 };

    // =========================================================
    // 1. SSSocket / SSSocketBuilder - 字节网络层主入口
    // =========================================================
    // 字节系 2023+ 版本：com.bytedance.ssii.adapter.socket.SSSocket
    // 部分版本：com.ss.android.network.SSSocket
    H.waitForClass('com.bytedance.ssii.adapter.socket.SSSocket', function (SS) {
        H.hookOverloads(SS, 'start', function (args, sig) {
            COUNT.req++;
            try {
                H.log('[SSSocket.start] sig=' + sig.length + 'p');
            } catch (e) {}
        });
        H.log('[OK] SSSocket.start hooked');
    }, 30);

    // 备选：旧版网络层
    H.waitForClass('com.ss.android.network.SSSocket', function (SS) {
        H.hookOverloads(SS, 'start', function (args, sig) {
            COUNT.req++;
            H.log('[SSSocket(legacy).start] sig=' + sig.length + 'p');
        });
    }, 30);

    // =========================================================
    // 2. ApiHandler / IApiHandler - RPC 入口
    // =========================================================
    H.waitForClass('com.bytedance.ies.ugc.aweme.network.ApiHandler', function (AH) {
        try {
            AH.doRequest.implementation = function () {
                COUNT.req++;
                var url = '';
                try {
                    // 尝试获取请求 URL
                    var req = this.mRequest || this.request;
                    if (req) url = req.toString();
                } catch (e) {}
                H.log('[ApiHandler.doRequest] ' + H.trunc(url, 300));
                return this.doRequest();
            };
        } catch (e) {}
        H.log('[OK] ApiHandler.doRequest hooked');
    }, 30);

    // =========================================================
    // 3. X-Gorgon / X-Khronos 签名抓取
    // =========================================================
    // 字节系签名在 OkHttpClient interceptor 或 SSSocket header 中
    // Hook: Request.Builder.addHeader 或特定签名类
    var SIGN_HEADERS = ['X-Gorgon', 'X-Khronos', 'X-Ladon', 'X-SS-ReqTicket', 'X-SS-Stub',
        'X-Tt-Token', 'X-Vc-BdturingSdk-Version'];
    var signPattern = new RegExp('(' + SIGN_HEADERS.join('|') + ')', 'i');

    H.waitForClass('okhttp3.Request$Builder', function (RB) {
        try {
            RB.addHeader.implementation = function (name, value) {
                if (signPattern.test(name)) {
                    COUNT.sign++;
                    H.log('[SignHeader] ' + name + ': ' + H.trunc(value, 200));
                }
                return this.addHeader(name, value);
            };
        } catch (e) {}
    });

    // TTEncrypt 签名函数（字节核心签名）
    H.waitForClass('com.bytedance.frameworks.encryptor.TTEncrypt', function (TT) {
        try {
            TT.encrypt.overload('[B').implementation = function (data) {
                COUNT.sign++;
                var len = data ? data.length : 0;
                H.log('[TTEncrypt.encrypt] inputLen=' + len);
                var result = this.encrypt(data);
                if (result) {
                    H.dumpBytes('TTEncrypt.out', result);
                }
                return result;
            };
        } catch (e) {}
        H.log('[OK] TTEncrypt.encrypt hooked');
    }, 30);

    // =========================================================
    // 4. TTWebView / WebView URL 拦截
    // =========================================================
    H.waitForClass('com.bytedance.webx.core.WebView', function (WV) {
        try {
            WV.loadUrl.overload('java.lang.String').implementation = function (u) {
                COUNT.url++;
                H.log('[TTWebView.loadUrl] ' + H.trunc(u, 500));
                return this.loadUrl(u);
            };
        } catch (e) {}
        H.log('[OK] TTWebView.loadUrl hooked');
    }, 30);

    // 标准 WebView（兜底）
    H.waitForClass('android.webkit.WebView', function (WV) {
        try {
            WV.loadUrl.overload('java.lang.String').implementation = function (u) {
                if (u && (u.indexOf('aweme') !== -1 || u.indexOf('douyin') !== -1 ||
                    u.indexOf('tiktok') !== -1 || u.indexOf('bytedance') !== -1)) {
                    COUNT.url++;
                    H.log('[WebView.loadUrl] ' + H.trunc(u, 500));
                }
                return this.loadUrl(u);
            };
        } catch (e) {}
    });

    // =========================================================
    // 5. Activity 跳转（首屏启动轨迹）
    // =========================================================
    H.waitForClass('android.app.Activity', function (Act) {
        try {
            Act.onCreate.overload('android.os.Bundle').implementation = function (bundle) {
                COUNT.req++; // 复用 req 计数
                H.log('[Act.onCreate] ' + this.$className);
                this.onCreate(bundle);
            };
        } catch (e) {}
    });

    // =========================================================
    // 心跳
    // =========================================================
    H.heartbeat(5);
    H.log('=== aweme hooks staged, waiting class loads ===');
});
