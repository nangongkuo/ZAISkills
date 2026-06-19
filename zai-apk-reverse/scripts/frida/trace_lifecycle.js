// trace_lifecycle.js - Application + Activity + SDK 初始化时序
// 用于: first-screen-rpc, security-audit
// 输出: Activity 栈变化 / SDK init 调用栈 / 启动耗时

Java.perform(function () {
    var H = createHelper('life');
    H.log('=== trace_lifecycle ===');

    var COUNT = { app: 0, act: 0, sdk: 0 };

    // 1. Application.onCreate (子类) - 不知道具体子类名, hook 父类
    H.waitForClass('android.app.Application', function (App) {
        try {
            App.onCreate.implementation = function () {
                COUNT.app++;
                var name = this.$className;
                var t0 = Java.use('java.lang.System').currentTimeMillis();
                this.onCreate();
                var t1 = Java.use('java.lang.System').currentTimeMillis();
                H.log('[App.onCreate] ' + name + ' took ' + (t1 - t0) + 'ms');
            };
        } catch (e) {}
        try {
            App.attachBaseContext.overload('android.content.Context').implementation = function (ctx) {
                var t0 = Java.use('java.lang.System').currentTimeMillis();
                this.attachBaseContext(ctx);
                var t1 = Java.use('java.lang.System').currentTimeMillis();
                H.log('[App.attachBase] ' + this.$className + ' took ' + (t1 - t0) + 'ms');
            };
        } catch (e) {}
    });

    // 2. Activity.onCreate / onResume / onPause
    H.waitForClass('android.app.Activity', function (Act) {
        try {
            Act.onCreate.overload('android.os.Bundle').implementation = function (bundle) {
                COUNT.act++;
                H.log('[Act.onCreate] ' + this.$className);
                this.onCreate(bundle);
            };
        } catch (e) {}
        try {
            Act.onResume.implementation = function () {
                H.log('[Act.onResume] ' + this.$className);
                this.onResume();
            };
        } catch (e) {}
        try {
            Act.onPause.implementation = function () {
                H.log('[Act.onPause] ' + this.$className);
                this.onPause();
            };
        } catch (e) {}
    });

    // 3. System.loadLibrary (so 加载时序 + 调用方)
    H.waitForClass('java.lang.System', function (Sys) {
        try {
            Sys.loadLibrary.implementation = function (libname) {
                COUNT.sdk++;
                H.log('[loadLibrary] ' + libname);
                return Sys.loadLibrary(libname);
            };
        } catch (e) {}
    });

    setInterval(function () {
        H.log('[hb] app=' + COUNT.app + ' act=' + COUNT.act + ' loadLib=' + COUNT.sdk);
    }, 10000);

    H.log('=== lifecycle staged ===');
});
