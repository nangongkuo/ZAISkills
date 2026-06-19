# 安全审计 (security-audit)

> 通用安全审计：权限滥用、敏感数据、明文 key、组件暴露、网络配置、加密用法。
> 对应 OWASP MASVS 的 MSTG-STORAGE / MSTG-CRYPTO / MSTG-NETWORK / MSTG-PLATFORM。

## 静态分析清单（重要性递减）

### 1. 敏感权限（来自 meta.permissions[]）

| 危险权限 | 是否使用 | 静态依据 |
|---|---|---|
| READ_SMS / SEND_SMS | ? | grep `SmsManager` |
| READ_CONTACTS | ? | grep `ContactsContract` |
| RECORD_AUDIO | ? | grep `AudioRecord` |
| ACCESS_FINE_LOCATION | ? | grep `LocationManager.requestLocationUpdates` |
| CAMERA | ? | grep `Camera.open` / `CameraManager` |

### 2. exported 组件攻击面

- 列出 `meta.components.activities[?.exported==true]`
- 标记 **带 intent-filter 但无权限校验** 的 = 高危
- Provider 是否设置 `grantUriPermissions=true` + URI 缺过滤 = SQL/路径注入风险

### 3. 网络安全

| 项 | 默认 | 风险 |
|---|---|---|
| `application.usesCleartextTraffic` | false 起 | true = HTTP 明文流量 |
| `network_security_config` | 无 | 缺失 = 没证书锁定 / 无 trust_anchor 限制 |
| `cleartextTrafficPermitted` per_domain | - | 部分域名允许 HTTP = 中间人风险 |

### 4. 加密用法

grep:

- `Cipher.getInstance(` -> 看算法（AES/ECB 弱、RSA/NoPadding 弱）
- `KeyGenerator.getInstance(` -> key 长度
- `MessageDigest.getInstance("MD5"|"SHA-1")` -> 弱哈希
- 硬编码密钥：`(API_KEY|SECRET|TOKEN|appkey)\s*=\s*"[A-Za-z0-9]+"`

### 5. WebView 安全

- `setJavaScriptEnabled(true)` 但不限制域名 -> JS 注入
- `addJavascriptInterface` 暴露的方法（<4.2 需 `@JavascriptInterface` 注解）
- `setAllowFileAccess` / `setAllowFileAccessFromFileURLs` / `setAllowUniversalAccessFromFileURLs` 是否启用
- `onReceivedSslError` 是否直接 `handler.proceed()` -> 中间人放行

### 6. 数据存储

- SharedPreferences 明文 token / session
- SQLite 是否加密（SQLCipher / SQLiteOpenHelper 是否没密钥）
- 外部存储敏感数据（`/sdcard/...`）

## 动态 hook 要点

| Hook 点 | 抓什么 | 脚本 |
|---|---|---|
| `Application.onCreate` | SDK 初始化时序 + 第三方 SDK 上报 | `trace_lifecycle.js` |
| `System.loadLibrary` | so 加载顺序 | `trace_lifecycle.js` |
| `SharedPreferences.Editor.putString` | 明文写入 token/session 时机 | (custom) |

## 报告输出格式

每条发现按“风险等级 + 标题 + 静态证据（□） + 动态确认（✅） + 修复建议”列出。

例：

```text
🔴 高 - exported Activity 无鉴权可被外部唤起
  □ com.xxx.PasswordResetActivity android:exported="true"，未在 onCreate 校验调用方
  ✅ adb shell am start -n com.xxx/.PasswordResetActivity 可直接弹出（attached round-2）
  建议：加 android:permission 或在 onCreate 校验 callingPackage
```
