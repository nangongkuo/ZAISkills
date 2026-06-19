// _anti_detect.js - 大厂反检测通用模块
// 加载顺序：必须在 00_bootstrap.js 之后注入
// 解决：/proc/self/maps 扫描 / TracerPid / root 检测 / frida 特征 / 调试器检测
//
// 用法（run_frida.py 里第一个 -l）：
//   python3 run_frida.py <pkg> lib/_common.js lib/_anti_detect.js 00_bootstrap.js ...

(function () {
    var H = createHelper('anti');
    H.log('=== v3 anti_detect ===');

    var COUNT = { maps: 0, tracer: 0, root: 0, frida: 0, debug: 0 };

    // =========================================================
    // 1. /proc/self/maps 过滤 frida/re.frida/gadget 行
    // =========================================================
    // hook fgets 读取 /proc/self/maps 时过滤含 frida 特征的行
    var fgets = Module.findExportByName(null, 'fgets');
    if (fgets) {
        Interceptor.attach(fgets, {
            onEnter: function (args) {
                this.buf = args[0];
                this.size = args[1].toInt32();
                this.fd = args[2];
            },
            onLeave: function (retval) {
                try {
                    if (!this.buf) return;
                    var line = Memory.readUtf8String(this.buf);
                    if (!line) return;

                    // 过滤 frida 特征行
                    if (line.indexOf('frida') !== -1 ||
                        line.indexOf('re.frida') !== -1 ||
                        line.indexOf('gadget') !== -1 ||
                        line.indexOf('gum') !== -1 ||
                        line.indexOf('linjector') !== -1) {
                        // 跳过此行：读下一行覆盖当前行
                        COUNT.maps++;
                        Memory.writeUtf8String(this.buf, '');
                        retval.replace(ptr(0));
                    }
                } catch (e) {}
            }
        });
        H.log('[hook] fgets /proc/self/maps filter OK');
    }

    // 2. open("/proc/self/maps") 也需过滤 - 返回一个干净的 fd
    var open_ptr = Module.findExportByName(null, 'open');
    var open64_ptr = Module.findExportByName(null, 'open64');

    function hookOpen(name, ptr) {
        if (!ptr) return;
        try {
            Interceptor.attach(ptr, {
                onEnter: function (args) {
                    try {
                        this.path = Memory.readUtf8String(args[0]);
                    } catch (e) {
                        this.path = null;
                    }
                },
                onLeave: function (retval) {
                    // open 本身不拦截返回值，fgets 过滤已足够
                }
            });
        } catch (e) {}
    }

    hookOpen('open', open_ptr);
    hookOpen('open64', open64_ptr);

    // =========================================================
    // 2. /proc/self/status TracerPid 伪造
    // =========================================================
    // 当 read /proc/self/status 时，把 TracerPid: N 改成 TracerPid: 0
    Java.perform(function () {
        // Java 层读 /proc/self/status
        H.waitForClass('java.io.BufferedReader', function (BR) {
            // 不 hook BufferedReader（太频繁），只 hook 具体的 readLine 调用链太复杂
            // 通过 hook FileInputStream 来处理
        });

        // Native 层：hook read() 对 /proc/self/status fd 的读取
        var read_ptr = Module.findExportByName(null, 'read');
        if (read_ptr) {
            // 使用更简单的方案：直接 hook Runtime.exec 读取 status
        }

        // 最简单有效的方案：替换 /proc/self/status 为一个临时文件
        // 在 Java 层拦截
        H.waitForClass('java.io.FileInputStream', function (FIS) {
            try {
                FIS.$init.overload('java.lang.String').implementation = function (path) {
                    if (path && path.indexOf('/proc/') !== -1 && path.indexOf('/status') !== -1) {
                        COUNT.tracer++;
                        // 不做替换，靠后续 fgets 过滤 TracerPid 行即可
                    }
                    return this.$init(path);
                };
            } catch (e) {}
        });

        // BufferedReader.readLine 拦截 TracerPid 行
        H.waitForClass('java.io.BufferedReader', function (BR) {
            try {
                BR.readLine.implementation = function () {
                    var line = this.readLine();
                    if (line && line.indexOf('TracerPid') !== -1) {
                        COUNT.tracer++;
                        return 'TracerPid:\t0';
                    }
                    return line;
                };
            } catch (e) {}
        });

        // =========================================================
        // 3. Root 检测绕过（扩展 00_bootstrap.js 的基础版）
        // =========================================================
        // 扩展 su 路径列表（大厂检测更全面）
        var ROOT_PATHS = [
            '/system/xbin/su',
            '/system/bin/su',
            '/sbin/su',
            '/system/app/Superuser.apk',
            '/system/app/SuperSU.apk',
            '/system/etc/init.d/99SuperSUDaemon',
            '/dev/com.koushikdutta.superuser.daemon/',
            '/system/xbin/daemonsu',
            '/system/bin/.ext/.su',
            '/system/usr/we-need-root',
            '/cache/.disable_magisk',
            '/data/adb/magisk',
            '/data/adb/ksu',
            '/data/adb/ap'
        ];

        H.waitForClass('java.io.File', function (File) {
            try {
                File.exists.implementation = function () {
                    var path = this.getAbsolutePath();
                    for (var i = 0; i < ROOT_PATHS.length; i++) {
                        if (path === ROOT_PATHS[i]) {
                            COUNT.root++;
                            return false;
                        }
                    }
                    return this.exists();
                };
            } catch (e) {}
        });

        // which su / busybox 检测
        H.waitForClass('java.lang.Runtime', function (Rt) {
            function isBlockedCommand(cmd) {
                if (!cmd) return false;
                var text = cmd.toString();
                return text === 'su' || text.indexOf('which su') >= 0 || text.indexOf('busybox') >= 0;
            }

            try {
                Rt.exec.overload('java.lang.String').implementation = function (cmd) {
                    if (isBlockedCommand(cmd)) {
                        COUNT.root++;
                        H.log('[anti] Runtime.exec(blocked): ' + cmd);
                        return this.exec('echo');
                    }
                    return this.exec(cmd);
                };
            } catch (e) {}

            try {
                Rt.exec.overload('[Ljava.lang.String;').implementation = function (cmds) {
                    var cmd0 = cmds && cmds[0] ? cmds[0].toString() : '';
                    if (isBlockedCommand(cmd0)) {
                        COUNT.root++;
                        H.log('[anti] Runtime.exec(blocked): ' + cmd0);
                        return this.exec(['echo']);
                    }
                    return this.exec(cmds);
                };
            } catch (e) {}

            try {
                Rt.exec.overload('[Ljava.lang.String;', '[Ljava.lang.String;', 'java.io.File').implementation = function (cmds, envp, dir) {
                    var cmd0 = cmds && cmds[0] ? cmds[0].toString() : '';
                    if (isBlockedCommand(cmd0)) {
                        COUNT.root++;
                        H.log('[anti] Runtime.exec(blocked): ' + cmd0);
                        return this.exec(['echo']);
                    }
                    return this.exec(cmds, envp, dir);
                };
            } catch (e) {}
        });

        // Build.TAGS test-keys 检测
        H.waitForClass('android.os.Build', function (Build) {
            // Build.TAGS 是 static final，不能直接 hook
            // 通过 hook System.getProperty("ro.build.tags") 来绕
        });

        // Settings.Secure 检测 (some apps check for developer options)
        H.waitForClass('android.provider.Settings$Secure', function (SS) {
            try {
                var getInt = SS.getInt.overload('android.content.ContentResolver', 'java.lang.String', 'int');
                // 不拦截，只记录
                void getInt;
            } catch (e) {}
        });
    });

    // =========================================================
    // 4. Frida 特征隐藏
    // =========================================================
    // 4.1 frida-server 端口检测 (27042/27043)
    Java.perform(function () {
        H.waitForClass('java.net.Socket', function (S) {
            try {
                S.$init.overload('java.lang.String', 'int').implementation = function (host, port) {
                    if (port === 27042 || port === 27043) {
                        COUNT.frida++;
                        H.log('[anti] Socket scan ' + host + ':' + port + ' -> refused');
                        throw Java.use('java.net.ConnectException').$new('refused');
                    }
                    return this.$init(host, port);
                };
            } catch (e) {}
        });

        // 4.2 frida agent 线程名检测
        H.waitForClass('java.lang.Thread', function (Thread) {
            try {
                Thread.currentThread.implementation = function () {
                    var t = this.currentThread();
                    var name = t.getName();
                    if (name && (name.indexOf('frida') !== -1 ||
                        name.indexOf('gmain') !== -1 ||
                        name.indexOf('linjector') !== -1 ||
                        name.indexOf('pool-frida') !== -1)) {
                        COUNT.frida++;
                        t.setName('pool-' + Math.random().toString(36).substring(2, 8));
                    }
                    return t;
                };
            } catch (e) {}
        });
    });

    // 4.3 Native 层：__system_property_get 检测 ro.debuggable
    var system_property_get = Module.findExportByName(null, '__system_property_get');
    if (system_property_get) {
        Interceptor.attach(system_property_get, {
            onEnter: function (args) {
                try {
                    this.name = Memory.readUtf8String(args[0]);
                    this.buf = args[1];
                } catch (e) {}
            },
            onLeave: function (retval) {
                if (!this.name) return;
                try {
                    if (this.name === 'ro.debuggable') {
                        Memory.writeUtf8String(this.buf, '0');
                        COUNT.debug++;
                    } else if (this.name === 'ro.build.tags') {
                        Memory.writeUtf8String(this.buf, 'release-keys');
                        COUNT.root++;
                    } else if (this.name === 'ro.secure') {
                        Memory.writeUtf8String(this.buf, '1');
                    }
                } catch (e) {}
            }
        });
    }

    // =========================================================
    // 5. 调试器检测绕过
    // =========================================================
    Java.perform(function () {
        H.waitForClass('android.os.Debug', function (Debug) {
            try {
                Debug.isDebuggerConnected.implementation = function () {
                    COUNT.debug++;
                    return false;
                };
            } catch (e) {}
            try {
                Debug.waitingForDebugger.implementation = function () {
                    COUNT.debug++;
                    return false;
                };
            } catch (e) {}
        });
    });

    // =========================================================
    // 心跳
    // =========================================================
    setInterval(function () {
        H.log('[hb-anti] maps=' + COUNT.maps + ', tracer=' + COUNT.tracer +
            ', root=' + COUNT.root + ', frida=' + COUNT.frida + ', debug=' + COUNT.debug);
    }, 15000);

    H.log('=== anti_detect staged ===');
})();
