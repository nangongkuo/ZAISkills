# DeepLink Scheme 分析（deeplink）

> 列出 App 所有 scheme 入口 + 对应 Activity 处理 + 鉴权检查。
> 用于：外链拉起、跨 App 跳转、Universal Link、安全审计（无鉴权 deeplink 可被滥用）。

## 静态分析要点

1. **AndroidManifest intent-filter**（由 `extract_meta.sh` 自动抽到 `meta.deepLinks[]`）
   - 关注 `BROWSABLE` category + `scheme` data 的 activity
2. **代码内分发**：grep `getData()` / `Uri.parse(` / `getQueryParameter(`
3. **鉴权检查**：handler Activity 是否检查登录态？是否过滤 host/path 白名单？

## 动态 hook 要点

| Hook 点 | 抓什么 |
|---|---|
| `android.net.Uri.parse` | 任何 URL 解析 |
| `android.content.Intent.setData` / `<init>(action, uri)` | 显式构造 Intent |
| `android.app.Activity.startActivity` | 真实跳转目标 |
| `com.taobao.android.nav.Nav.toUri` | 阿里 Nav 路由层 |

## 关键安全风险

- **未鉴权 deeplink** -> 可被任意 App 通过 `am start -W -a android.intent.action.VIEW -d "<scheme>://..."` 触发
- **WebView 内 URL Loader 被 deeplink 串接** -> 可能 XSS / CSRF
- **scheme 重名** -> 多个 App 注册同一 scheme，可被劫持
- **path 注入** -> handler 没校验 path/query 参数

## 复现命令

```bash
# 列 App 注册的所有 deeplink scheme
cat <workdir>/meta.json | jq -r '.deepLinks[] | "\(.scheme)://\(.host) -> \(.activity)"' | sort -u | head -20

# 测试触发一个 deeplink
adb shell am start -W -a android.intent.action.VIEW -d "taobao://shop?xxx=yyy"
```
