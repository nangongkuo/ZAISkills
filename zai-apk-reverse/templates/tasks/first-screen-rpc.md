# 首屏 RPC (first-screen-rpc)

> 抓“App 冷启动 -> 首页第一屏内容呈现”链路上的所有 RPC + 数据接口。
> 适用于：电商首页、信息流首页、新闻列表首页。

## 静态分析要点

1. **入口 Activity 的 onCreate / setContentView 调用链** -> 找首屏 fragment
2. **网关类**：`*Request*` / `*Gateway*` / `*Loader*` 的 `request / fetch / load` 方法
3. **API 名常量** grep:
   - 阿里系：`mtop.taobao.*` / `mtop.alibaba.*` 字面量
   - 字节系：`/aweme/v1/` / `/lite/v2/`
   - 通用：`https://api.<biz>.com/`
4. **request DTO 类**：`IMTOPDataObject` 实现类 = 阿里 mtop 请求；查它的字段就知道请求体 schema
5. **response DTO 类**：`BaseOutDo` 子类 = 阿里 mtop 响应

## 动态分析要点 (frida)

| Hook 点 | 抓什么 | 脚本 |
|---|---|---|
| `mtopsdk.mtop.intf.MtopBuilder.asyncRequest` | 业务层入口 + API 名 + 请求 JSON | `trace_mtop.js` |
| `mtopsdk.mtop.domain.MtopResponse.setBytedata` | 响应字节流（每个 API 必经） | `trace_mtop.js` |
| `anet.channel.request.Request.getBodyBytes` | 底层 HTTPS body（含 wua 签名） | `trace_mtop.js` |
| `Application.onCreate` / `Activity.onCreate` | 启动时序 | `trace_lifecycle.js` |

**典型证据时序**（淘宝实测）：

```
T+0    App.attachBaseContext
T+30ms App.onCreate
T+1.2s Welcome.onCreate
T+1.5s Welcome.onResume
T+1.8s 用户点 Agree
T+2.0s MtopBuilder.asyncRequest -> mtop.taobao.wireless.home.newface.awesome.get
T+3.5s MtopResponse.setBytedata size=425000
T+3.6s TBMainActivity.onResume
```

## 关键发现要记录的字段

- API 全名 + 版本
- 请求 body（JSON 完整）
- 响应 body（JSON 完整，必要时只贴 schema）
- 触发时机（冷启动 / 下拉刷新 / 滚动加载下一页）
- 是否需要登录态
