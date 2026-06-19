// _common.js - Frida 通用辅助库（所有 App 逆向脚本都先 include 它）
//
// 解决：
// 1. 业务类按需加载（多 dex / InstantRun） -> waitForClass()
// 2. 大响应被截断 -> dumpBytes() 分段无上限输出 + 标 [GROUP] 便于重组
// 3. JSON 安全打印 -> safeJson()
// 4. 时序定位 -> traceTime() / [+1234ms] 相对时间戳
// 5. 重载方法批量 hook -> hookOverloads()
// 6. URL-encoded body 自动解码 -> decodeBody()
// 7. 心跳 -> heartbeat()
// 8. 安全 Map 遍历 -> safeIterateMap() 避免 entrySet().iterator() TypeError
// 9. 运行时类发现 -> discoverRuntimeClass() 解决 R8 混淆名 != 运行时类名
// 10. Hook 实际子类 -> hookActualImpl() 解决 hook 基类不触发子类 override
//
// 用法（在你的 trace_xxx.js 顶部）：
// ;(function() {
//   // 把本文件内容复制到这里，或者用 frida-compile 合并
// })();
//
// var H = createHelper('myhook'); // 创建一个 Logger
// H.waitForClass('com.foo.Bar', function(Bar) {
//   H.hookOverloads(Bar, 'doRequest', function(args, sig) {
//     H.log('REQ args=' + H.safeJson(args[0]));
//   });
// });
// H.dumpBytes('mtop-resp', bytes); // 大字节流分段输出
//
// 重组工具（在 host 端）：reassemble_body.py <log> <group_Label>

(function (global) {
    var _start = (function () {
        try { return java_currentTimeMillis(); } catch (e) { return 0; }
    })();

    function java_currentTimeMillis() {
        try {
            var S = Java.use('java.lang.System');
            return S.currentTimeMillis();
        } catch (e) { return 0; }
    }

    function relMs() {
        if (!_start) _start = java_currentTimeMillis();
        return java_currentTimeMillis() - _start;
    }

    function createHelper(prefix) {
        prefix = prefix || 'hk';
        var counters = {};

        var H = {
            prefix: prefix,

            log: function (msg) {
                console.log('[' + prefix + ' +' + relMs() + 'ms] ' + msg);
            },

            warn: function (msg) {
                console.log('[' + prefix + ' WARN +' + relMs() + 'ms] ' + msg);
            },

            bump: function (key) {
                counters[key] = (counters[key] || 0) + 1;
                return counters[key];
            },

            counts: function () {
                return counters;
            },

            waitForClass: function (name, cb, timeoutSec) {
                timeoutSec = timeoutSec || 60;
                try {
                    var cls = Java.use(name);
                    this.log('[wait] ' + name + ' 已就绪');
                    cb(cls);
                    return;
                } catch (e) {}

                var self = this;
                var retries = 0;
                var max = timeoutSec * 2;
                var iv = setInterval(function () {
                    retries++;
                    try {
                        var cls = Java.use(name);
                        clearInterval(iv);
                        self.log('[wait] ' + name + ' 加载完成（重试 ' + retries + ' 次）');
                        cb(cls);
                    } catch (e) {
                        if (retries >= max) {
                            clearInterval(iv);
                            self.warn('[wait] ' + name + ' 超时 ' + timeoutSec + 's 未加载');
                        }
                    }
                }, 500);
            },

            waitForClasses: function (names, cb, timeoutSec) {
                timeoutSec = timeoutSec || 60;
                var resolved = {};
                var self = this;
                var pending = names.slice();
                var retries = 0;
                var max = timeoutSec * 2;

                function tryOnce() {
                    var still = [];
                    pending.forEach(function (n) {
                        try {
                            resolved[n] = Java.use(n);
                        } catch (e) {
                            still.push(n);
                        }
                    });
                    pending = still;
                }

                tryOnce();
                if (pending.length === 0) {
                    cb(resolved);
                    return;
                }

                var iv = setInterval(function () {
                    retries++;
                    tryOnce();
                    if (pending.length === 0 || retries >= max) {
                        clearInterval(iv);
                        if (pending.length > 0) self.warn('[wait] 仍缺：' + pending.join(','));
                        cb(resolved);
                    }
                }, 500);
            },

            hookOverloads: function (cls, methodName, cb) {
                var self = this;
                var hooked = 0;
                try {
                    cls.class.getDeclaredMethods().forEach(function (m) {
                        if (m.getName() !== methodName) return;
                        var ptypes = m.getParameterTypes();
                        var sig = [];
                        for (var i = 0; i < ptypes.length; i++) sig.push(ptypes[i].getName());
                        try {
                            cls[methodName].overload.apply(cls[methodName], sig).implementation = function () {
                                try {
                                    cb.call(this, arguments, sig, this);
                                } catch (e) {
                                    self.warn('hook cb err: ' + e);
                                }
                                return this[methodName].apply(this, arguments);
                            };
                            hooked++;
                        } catch (e) {
                            self.warn('hook ' + methodName + '(' + sig.join(',') + ') 失败: ' + e);
                        }
                    });
                } catch (e) {
                    self.warn('hookOverloads ' + methodName + ' 异常: ' + e);
                }
                this.log('[hook] ' + cls.$className + '.' + methodName + ' 命中 ' + hooked + ' 个重载');
                return hooked;
            },

            hookOverLoads: function (cls, methodName, cb) {
                return this.hookOverloads(cls, methodName, cb);
            },

            hookMethod: function (cls, methodName, cb) {
                return this.hookOverloads(cls, methodName, cb);
            },

            safeJson: function (obj) {
                try {
                    var FJ = Java.use('com.alibaba.fastjson.JSON');
                    return FJ.toJSONString(obj);
                } catch (e) {
                    try {
                        var GS = Java.use('com.google.gson.Gson');
                        return GS.$new().toJson(obj);
                    } catch (ee) {}
                    try {
                        return obj ? '' + obj.toString() : 'null';
                    } catch (eee) {
                        return '<unprintable>';
                    }
                }
            },

            trunc: function (s, n) {
                n = n || 4000;
                if (!s) return s;
                var t = '' + s;
                return t.length > n ? t.substring(0, n) + '...(' + (t.length - n) + ')' : t;
            },

            dumpBytes: function (label, bytes) {
                if (!bytes) return;
                try {
                    var s = Java.use('java.lang.String').$new(bytes, 'UTF-8').toString();
                    this.dumpString(label, s);
                } catch (e) {
                    this.warn('dumpBytes err: ' + e);
                }
            },

            dumpString: function (label, s, chunkSize) {
                chunkSize = chunkSize || 3500;
                if (!s) {
                    this.log(label + '<empty>');
                    return;
                }

                var len = s.length;
                if (len <= chunkSize) {
                    this.log(label + '[0..' + len + ']: ' + s);
                    return;
                }

                for (var i = 0; i < len; i += chunkSize) {
                    var end = Math.min(i + chunkSize, len);
                    this.log(label + '[' + i + '..' + end + ']: ' + s.substring(i, end));
                }
            },

            decodeUrlForm: function (bodyStr) {
                try {
                    var URLD = Java.use('java.net.URLDecoder');
                    var out = {};
                    bodyStr.split('&').forEach(function (kv) {
                        var idx = kv.indexOf('=');
                        if (idx < 0) return;
                        var k = kv.substring(0, idx);
                        var v = kv.substring(idx + 1);
                        try {
                            out[k] = URLD.decode(v, 'UTF-8');
                        } catch (e) {
                            out[k] = v;
                        }
                    });
                    return out;
                } catch (e) {
                    return null;
                }
            },

            decodeBody: function (bodyStr) {
                return this.decodeUrlForm(bodyStr);
            },

            heartbeat: function (intervalSec) {
                intervalSec = intervalSec || 5;
                var self = this;
                setInterval(function () {
                    var c = self.counts();
                    var msg = Object.keys(c).map(function (k) {
                        return k + '=' + c[k];
                    }).join(' ');
                    self.log('[hb] ' + (msg || '<no counts>'));
                }, intervalSec * 1000);
            },

            currentStack: function (skipFrames) {
                skipFrames = skipFrames || 0;
                try {
                    var Log = Java.use('android.util.Log');
                    var Ex = Java.use('java.lang.Exception');
                    var trace = Log.getStackTraceString(Ex.$new());
                    return trace.split('\n').slice(2 + skipFrames).join('\n');
                } catch (e) {
                    return '<stack unavailable>';
                }
            },

            safeIterateMap: function (map, callback) {
                if (!map) return;
                try {
                    var keys = map.keySet().toArray();
                    for (var i = 0; i < keys.length; i++) {
                        try {
                            var val = map.get(keys[i]);
                            callback(keys[i], val, i);
                        } catch (e) {
                            this.warn('safeIterateMap entry err: ' + e);
                        }
                    }
                } catch (e) {
                    this.warn('safeIterateMap err: ' + e);
                }
            },

            discoverRuntimeClass: function (stableClass, getterMethod) {
                var self = this;
                try {
                    Java.choose(stableClass, {
                        onMatch: function (instance) {
                            try {
                                var result = instance[getterMethod]();
                                var className = result ? result.$className : '<null>';
                                self.log('[DISCOVERY] ' + stableClass + '.' + getterMethod + '() -> ' + className);
                                return className;
                            } catch (e) {
                                self.warn('[DISCOVERY] ' + stableClass + '.' + getterMethod + '() err: ' + e);
                            }
                        },
                        onComplete: function () {}
                    });
                } catch (e) {
                    self.warn('[DISCOVERY] choose ' + stableClass + ' err: ' + e);
                }
            },

            hookActualImpl: function (stableClass, getterMethod, methodName, callback) {
                var self = this;
                var hooked = {};
                try {
                    Java.choose(stableClass, {
                        onMatch: function (instance) {
                            try {
                                var impl = instance[getterMethod]();
                                if (!impl) return;
                                var className = impl.$className;
                                if (hooked[className]) return;
                                hooked[className] = true;
                                var cls = Java.use(className);
                                try {
                                    cls[methodName].implementation = function () {
                                        try {
                                            callback.apply(this, arguments);
                                        } catch (e) {
                                            self.warn('hookActualImpl cb err: ' + e);
                                        }
                                        return this[methodName].apply(this, arguments);
                                    };
                                    self.log('[hookActualImpl] ' + className + '.' + methodName + '/');
                                } catch (e) {
                                    // 可能没有该方法，尝试 overload
                                    try {
                                        var methods = cls.class.getDeclaredMethods();
                                        methods.forEach(function (m) {
                                            if (m.getName() === methodName) {
                                                var ptypes = m.getParameterTypes();
                                                var sig = [];
                                                for (var i = 0; i < ptypes.length; i++) sig.push(ptypes[i].getName());
                                                cls[methodName].overload.apply(cls[methodName], sig).implementation = function () {
                                                    try {
                                                        callback.apply(this, arguments);
                                                    } catch (e2) {
                                                        self.warn('hookActualImpl cb err: ' + e2);
                                                    }
                                                    return this[methodName].apply(this, arguments);
                                                };
                                                self.log('[hookActualImpl] ' + className + '.' + methodName + '(' + sig.join(',') + ')');
                                            }
                                        });
                                    } catch (e3) {
                                        self.warn('[hookActualImpl] ' + className + '.' + methodName + ' failed: ' + e3);
                                    }
                                }
                            } catch (e) {
                                self.warn('[hookActualImpl] ' + stableClass + '.' + getterMethod + '() err: ' + e);
                            }
                        },
                        onComplete: function () {
                            var names = Object.keys(hooked);
                            if (names.length === 0) {
                                self.warn('[hookActualImpl] 未找到 ' + stableClass + ' 的运行时实例');
                            }
                        }
                    });
                } catch (e) {
                    self.warn('[hookActualImpl] choose ' + stableClass + ' err: ' + e);
                }
            }
        };

        return H;
    }

    global.createHelper = createHelper;
    global.relMs = relMs;
})(this);
