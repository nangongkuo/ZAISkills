// trace_lynx.js - 字节 Lynx 容器追踪
// Hook: Lynx 容器加载 + SSR 数据 + 卡片渲染
//
// 用法：
//   frida -U -f <pkg> -l lib/_common.js -l lib/_anti_detect.js -l 00_bootstrap.js -l bytedance/trace_lynx.js

Java.perform(function () {
    var H = createHelper('lynx');
    H.log('=== trace_lynx (ByteDance Lynx Container) ===');

    var COUNT = { load: 0, render: 0, data: 0 };

    // =========================================================
    // 1. LynxView / LynxContainer
    // =========================================================
    H.waitForClass('com.lynx.tasm.LynxView', function (LV) {
        try {
            LV.loadUrl.implementation = function (url) {
                COUNT.load++;
                H.log('[LynxView.loadUrl] ' + H.trunc(url, 500));
                return this.loadUrl(url);
            };
        } catch (e) {}

        try {
            LV.loadData.implementation = function (data, mimeType, encoding) {
                COUNT.data++;
                H.log('[LynxView.loadData] mimeType=' + mimeType + ' len=' + (data ? data.length() : 0));
                if (data) H.dumpString('LynxData.' + COUNT.data, data.toString());
                return this.loadData(data, mimeType, encoding);
            };
        } catch (e) {}

        H.log('[OK] LynxView hooked');
    }, 30);

    // LynxService / LynxEngine 初始化
    H.waitForClass('com.lynx.tasm.LynxEngine', function (LE) {
        try {
            LE.init.implementation = function () {
                COUNT.load++;
                H.log('[LynxEngine.init]');
                return this.init();
            };
        } catch (e) {}
    }, 30);

    // =========================================================
    // 2. 卡片/模板 加载
    // =========================================================
    H.waitForClass('com.lynx.tasm.behavior.LynxBehavior', function (LB) {
        H.hookOverloads(LB, 'onTemplateLoaded', function (args, sig) {
            COUNT.render++;
            H.log('[LynxBehavior.onTemplateLoaded]');
        });
    }, 30);

    // =========================================================
    // 3. SSR 数据注入（类似淘宝 arkact）
    // =========================================================
    // 字节 SSR 走 Grotto / SSRKit
    H.waitForClass('com.bytedance.ssr.SSRKit', function (SSR) {
        try {
            SSR.render.implementation = function () {
                COUNT.render++;
                H.log('[SSRKit.render]');
                return this.render();
            };
        } catch (e) {}
    }, 30);

    // =========================================================
    // 心跳
    // =========================================================
    H.heartbeat(5);
    H.log('=== Lynx hooks staged ===');
});
