# Native + JNI (native-jni)

> 分析 App 的 `.so` 文件 / JNI 方法 / 加密算法位置。
> **不还原 VMP 化算法**，只做定位。

## 静态分析要点

### 1. so 文件分类

由 `extract_meta.sh` 自动抓到 `meta.libs[]`，按以下分类：

| 类型 | 命名特征 | 处理方式 |
|---|---|---|
| 业务 native | `lib<biz>.so` | jadx 看 `System.loadLibrary("<biz>")` 调用位置 |
| 加密/签名 | `libsgmain.so`、`libbdd_secure.so`、`libtongdun.so` | VMP 化，仅定位 JNI 入口 |
| 渲染/视频 | `libmnn.so`、`libffmpeg.so` | 第三方算法，引用即可 |
| 崩溃监控 | `libcrashsdk.so`、`libbugly.so` | SBOM，列出 |

### 2. 导出函数 (readelf)

```bash
readelf -s <so> | awk '$5 == "GLOBAL" && $7 != "UND" {print $8}' | head -30
```

关注 `Java_<package>_<class>_<method>` 命名 = JNI 方法。

### 3. 加密算法字符串

```bash
strings <so> | grep -E "AES|RSA|HmacSHA|PKCS5|PKCS7|CBC|ECB"
```

### 4. JNI_OnLoad / RegisterNatives

- `nm <so> | grep JNI_OnLoad` -> 看有没有显式注册
- 有 = JNI 方法名运行时绑定（静态 jadx 看不到映射）-> 需 frida 动态抓

## 动态 hook 要点

| Hook 点 | 抓什么 | 脚本 |
|---|---|---|
| `RegisterNatives` (`libart.so`) | Java↔Native 函数指针映射 | `trace_jni.js` |
| `dlopen` / `android_dlopen_ext` | so 加载顺序 + 触发方 | `trace_jni.js` |
| `System.loadLibrary` (Java) | 业务侧加载时机 | `trace_lifecycle.js` |

## VMP / OLLVM 判定

`runtime_mods.json.vmp_indicators` 已列出候选 so。VMP 特征：

- 文件大（>1 MB）+ 高熵
- `readelf -d` 看 `DT_NEEDED` 异常（自定义 linker）
- 函数体异常长且无有意义分支（OLLVM 控制流平坦化）
- 大量 dispatch + switch case + 间接跳转

**如确认 VMP**：报告标 `T4 不可达`，只输出：

- so 路径 + 大小
- 关键 JNI 方法名
- 推测用途（“签名”/“加密”/“风控”）
- 建议人工 Ghidra/IDA 接管

## 报告输出字段

```
| .so | abi | size | JNI? | crypto strings | 推测用途 | VMP? |
|---|---|---|---|---|---|---|
| libsgmain.so | arm64-v8a | 4.5 MB | Java_com_taobao_wireless_security_*_sign | AES/HmacSHA256 | 阿里安全签名 | 是 |
```
