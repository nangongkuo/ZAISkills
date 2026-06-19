// _force_load_classes.js - 强制初始化常见动态加载脚本
// 遍历 ClassLoader + 枚举已加载类 -> 辅助 Java.use 触发类初始化
// 目的：让加固方解密尽可能多的方法体，便于 frida-dexdump 抓到完整 DEX。
//
// 用法：在 frida-dexdump 之前执行
// python3 run_frida.py --attach <pkg> lib/_common.js lib/_force_load_classes.js

Java.perform(function () {
    var H = createHelper('warmup');
    H.log('=== force_load_classes: 开始 ClassLoader 遍历预热 ===');

    var LOADED = 0;
    var FAILED = 0;
    var TOTAL_LOADERS = 0;

    // 业务包名前缀（按厂商分类，触发类加载）
    var BIZ_PREFIXES = [
        // 阿里系
        'com.taobao.', 'com.alibaba.', 'com.alipay.', 'com.ali.',
        'com.tmall.', 'com.etao.', 'com.mtop.',
        // 字节系
        'com.ss.', 'com.bytedance.', 'com.ss.android.',
        'com.android.bytedance.', 'com.byteteam.',
        // 拼多多
        'com.xunmeng.', 'com.pinduoduo.', 'com.pdd.',
        // 腾讯系
        'com.tencent.', 'com.qq.', 'com.weixin.',
        // 美团
        'com.meituan.', 'com.sankuai.',
        // 京东
        'com.jingdong.', 'com.jd.',
        // 快手
        'com.kuaishou.', 'com.smile.',
        // Android 框架
        'androidx.fragment.', 'androidx.recyclerview.',
        'androidx.viewpager.'
    ];

    function isBizClass(name) {
        for (var i = 0; i < BIZ_PREFIXES.length; i++) {
            if (name.indexOf(BIZ_PREFIXES[i]) === 0) return true;
        }
        return false;
    }

    // 1. 遍历所有 ClassLoader
    var loaders = [];
    try {
        Java.enumerateClassLoaders({
            onMatch: function (loader) {
                loaders.push(loader);
                TOTAL_LOADERS++;
            },
            onComplete: function () {}
        });
    } catch (e) {
        H.warn('enumerateClassLoaders 失败: ' + e);
    }

    H.log('发现 ' + TOTAL_LOADERS + ' 个 ClassLoader');

    // 2. 对每个 ClassLoader，枚举已加载的类并强制触发加载
    loaders.forEach(function (loader, idx) {
        try {
            Java.classFactory.loader = loader;
        } catch (e) {
            return; // 跳过不可用的 ClassLoader
        }

        var classCount = 0;
        try {
            Java.enumerateLoadedClasses({
                onMatch: function (name) {
                    if (!isBizClass(name)) return;
                    try {
                        Java.use(name);
                        LOADED++;
                        classCount++;
                    } catch (e) {
                        FAILED++;
                    }
                },
                onComplete: function () {}
            });
        } catch (e) {
            // 某些 ClassLoader 不支持枚举，跳过
        }

        if (classCount > 0) {
            H.log('[Loader-' + idx + '] 预热 ' + classCount + ' 个业务类');
        }
    });

    // 3. 对常见关键类做显式加载（即使枚举没发现也尝试）
    var CRITICAL_CLASSES = [
        // 阿里 mtop
        'mtopsdk.mtop.intf.MtopBuilder',
        'mtopsdk.mtop.domain.MtopResponse',
        'mtopsdk.mtop.common.model.MtopRequest',
        // 阿里 Nav
        'com.taobao.android.nav.Nav',
        // 阿里 WebView
        'com.taobao.android.windvane.webview.WVWebView',
        // 字节网络
        'com.bytedance.retrofit2.Retrofit',
        'com.bytedance.news.ad.api.IAdService',
        // 字节 WebView
        'com.bytedance.webx.core.WebView',
        // 拼多多
        'com.xunmeng.pinduoduo.base.activity.MainActivity',
        'com.xunmeng.pinduoduo.ui.home.HomeFragment',
        // 通用
        'androidx.fragment.app.Fragment',
        'androidx.recyclerview.widget.RecyclerView',
        'androidx.viewpager.widget.ViewPager'
    ];

    CRITICAL_CLASSES.forEach(function (cls) {
        try {
            Java.use(cls);
            LOADED++;
        } catch (e) {
            // 类未加载或不存在，跳过
        }
    });

    H.log('=== 预热完成: loaded=' + LOADED + ' failed=' + FAILED + ' loaders=' + TOTAL_LOADERS + ' ===');
});
