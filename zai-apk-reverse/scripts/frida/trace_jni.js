// trace_jni.js - RegisterNatives + dlopen + so 加载顺序
// 用于：native-jni task
// 输出：Java <-> Native 映射表 / so 加载时序

(function () {
    var prefix = '[jni]';
    function L(m) { console.log(prefix + ' ' + m); }
    L('=== trace_jni ===');

    var dlopen = Module.findExportByName(null, 'dlopen');
    var dlopen_ext = Module.findExportByName(null, 'android_dlopen_ext');
    var loaded = {};

    function hookDlopen(name, addr) {
        if (!addr) return;
        Interceptor.attach(addr, {
            onEnter: function (args) { this.path = Memory.readCString(args[0]); },
            onLeave: function (retval) {
                if (this.path && !loaded[this.path]) {
                    loaded[this.path] = true;
                    L(name + ' ' + this.path);
                }
            }
        });
    }

    hookDlopen('dlopen', dlopen);
    hookDlopen('android_dlopen_ext', dlopen_ext);

    // RegisterNatives - JNI 注册表抓取（运行时拿到 Java<->Native 映射）
    // Android 各版本符号略不同，遍历常见
    var symbols = [
        '_ZN3art3JNI15RegisterNativesEP7_JNIEnvP7_jclassPK15JNINativeMethodi',
        '_ZN3art3JNIILb0EE15RegisterNativesEP7_JNIEnvP7_jclassPK15JNINativeMethodi',
        '_ZN3art3JNIILb1EE15RegisterNativesEP7_JNIEnvP7_jclassPK15JNINativeMethodi'
    ];

    Java.perform(function () {
        var GetStringUTFChars = Module.findExportByName('libart.so', '_ZN3art3JNI18GetStringUTFCharsEP7_JNIEnvP8_jstringPh');
        symbols.forEach(function (sym) {
            var addr = Module.findExportByName('libart.so', sym);
            if (!addr) return;
            try {
                Interceptor.attach(addr, {
                    onEnter: function (args) {
                        var env = args[0];
                        var klass = args[1];
                        var methods = args[2];
                        var count = args[3].toInt32();
                        L('RegisterNatives count=' + count);
                        for (var i = 0; i < count; i++) {
                            var m = methods.add(i * Process.pointerSize * 3);
                            try {
                                var name = Memory.readCString(Memory.readPointer(m));
                                var sig = Memory.readCString(Memory.readPointer(m.add(Process.pointerSize)));
                                var fn = Memory.readPointer(m.add(Process.pointerSize * 2));
                                L('  ' + name + ' ' + sig + ' @ ' + fn);
                            } catch (e) {}
                        }
                    }
                });
                L('[hook] ' + sym + ' OK');
            } catch (e) {}
        });
    });

    setInterval(function () { L('[hb] so loaded: ' + Object.keys(loaded).length); }, 10000);
})();
