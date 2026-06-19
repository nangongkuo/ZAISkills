# H5 容器与落地页 (h5-container)

> 分析 App 内 WebView/小程序容器 + 落地页加载链路。
> 适用于：H5 活动页、小程序、内嵌网页商品详情。

## 容器识别

| 容器 | 关键类 | 主要厂商 |
|---|---|---|
| WindVane | `android.taobao.windvane.*` / `WVApi` | 淘宝 |
| PHA | `com.taobao.pha.*` | 淘宝 |
| Themis（新版小程序） | `com.taobao.themis.container.app.TMSActivity` | 淘宝 |
| Zebra/Ark SSR | `mtop.gaia.nodejs.gaia.arkact.handler` | 淘宝 |
| Weex 2.0 | `com.taobao.weex.*` / `WXSDKEngine` | 淘宝 |
| UC 内核 WebView | `com.uc.webview.export.WebView` | 阿里 |
| Lynx | `com.lynx.tasm.*` | 字节 |
| TTWebView | `com.bytedance.webx.*` | 字节 |
| Hippy | `com.tencent.mtt.hippy.*` | 腾讯 |
| Nebula | `com.alipay.mobile.nebula*` | 支付宝 |

## 静态分析要点

1. **WebView 创建路径**：grep `setJavaScriptEnabled`、`addJavascriptInterface` -> 找暴露的 JSBridge
2. **离线包**：`Zcache`（淘宝）/ `Gecko`（字节）/ `Forest`（字节）的初始化路径
3. **SSR 预拉接口**（淘宝 Zebra）：`mtop.gaia.nodejs.gaia.arkact.handler` 一定有
4. **路由器**：`com.taobao.android.nav.Nav.toUri`、`com.alipay.mobile.h5container`

## 动态 hook 要点

| Hook 点 | 抓什么 |
|---|---|
| `android.webkit.WebView.loadUrl` | 标准内核 H5 URL |
| `com.uc.webview.export.WebView.loadUrl` | UC 内核 H5 URL |
| `com.taobao.android.nav.Nav.toUri` | 客户端路由 |
| `mtop.gaia.nodejs.gaia.arkact.handler` | 响应 / SSR 容器配置 + 组件清单 + failApp 降级 |

## 未登录态降级机制（重要）

服务端响应里可能含：

| 字段 | 含义 |
|---|---|
| `acl_willLogin: "true"` | 页面要求登录 -> 客户端拉起登录 Activity |
| `failApp: <comp_uuid_field>` | 因登录态/风控被跳过的楼层（关键商品数据常在此） |
| `data.result: []` | 非 SUCCESS 但实际数据空 |
| `needLogin: true` | 通用风控降级 |

**对策**：

- 若需真实商品数据，用真机 + 已登录账号
- 或用抓到的请求体 + cookie 在 curl 重放
- 不要试图模拟登录（阿里 IFAA 人脸校验在模拟器过不去）
