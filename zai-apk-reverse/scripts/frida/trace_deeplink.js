// trace_deeplink.js - Intent / Uri / startActivity 抓 scheme 跳转
// 用于: deeplink task
// 输出: 谁触发了哪个 scheme/host/path -> 解析到哪个 Activity

Java.perform(function () {
    var H = createHelper('dl');
    H.log('=== trace_deeplink ===');

    var COUNT = { uri: 0, intent: 0, start: 0 };

    // 1. Uri.parse
    H.waitForClass('android.net.Uri', function (Uri) {
        try {
            Uri.parse.implementation = function (u) {
                if (u && (u.indexOf('://') > 0)) {
                    COUNT.uri++;
                    if (u.indexOf('http') !== 0 || u.indexOf('m.taobao.com') >= 0 || u.indexOf('h5.m') >= 0) {
                        H.log('[Uri.parse] ' + H.trunc(u, 300));
                    }
                }
                return Uri.parse(u);
            };
        } catch (e) {}
    });

    // 2. Intent.setData / Intent.<init>(action, data)
    H.waitForClass('android.content.Intent', function (Intent) {
        try {
            Intent.setData.implementation = function (uri) {
                COUNT.intent++;
                try { H.log('[Intent.setData] ' + uri.toString()); } catch (e) {}
                return Intent.setData.call(this, uri);
            };
        } catch (e) {}
        try {
            Intent.$init.overload('java.lang.String', 'android.net.Uri').implementation = function (action, uri) {
                COUNT.intent++;
                try { H.log('[new Intent] action=' + action + ' uri=' + (uri ? uri.toString() : 'null')); } catch (e) {}
                return Intent.$init.call(this, action, uri);
            };
        } catch (e) {}
    });

    // 3. Activity.startActivity / startActivityForResult
    H.waitForClass('android.app.Activity', function (Act) {
        try {
            Act.startActivity.overload('android.content.Intent').implementation = function (intent) {
                COUNT.start++;
                try {
                    var cls = intent.getComponent() ? intent.getComponent().getClassName() : '<implicit>';
                    var data = intent.getData() ? intent.getData().toString() : '';
                    H.log('[startActivity] ' + cls + ' data=' + H.trunc(data, 300));
                } catch (e) {}
                Act.startActivity.call(this, intent);
            };
        } catch (e) {}
    });

    // 4. 阿里 Nav.toUri 兜底（淘宝/支付宝/天猫常见路由器）
    H.waitForClass('com.taobao.android.nav.Nav', function (Nav) {
        H.hookOverloads(Nav, 'toUri', function (args, sig) {
            try { H.log('[Nav.toUri] ' + (args[0] ? args[0].toString() : 'null')); } catch (e) {}
        });
    }, 30);

    setInterval(function () {
        H.log('[hb] uri=' + COUNT.uri + ' intent=' + COUNT.intent + ' start=' + COUNT.start);
    }, 10000);

    H.log('=== deeplink staged ===');
});
