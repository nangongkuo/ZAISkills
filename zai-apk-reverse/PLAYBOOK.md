# PLAYBOOK - apk-reverse-v3 操作手册

> 4 个入口命令的参数、行为、产物、排错。

## 命令 1: `analyze.sh`

**作用**: T1（元信息）+ T2（反编译 + 静态 grep）全自动。

```bash
bash $SKILL_DIR/scripts/analyze.sh <apk_path> [--task <task>] [--skip-decompile]
```

### 参数

- `<apk_path>` - 必填，本地 APK 绝对路径
- `--task <task>` - 可选，决定 decompile 选 dex + static-grep 用什么模式。可选值:
  - `first-screen-rpc`（默认推荐）
  - `h5-container`
  - `deeplink`
  - `security-audit`
  - `native-jni`
- `--skip-decompile` - 可选，跳过 jadx 反编译（只跑 T1，约 30 秒）

### 行为

1. 环境自检（`jadx` / `apkanalyzer` 必须，`apksigner` / `aapt` / `frida` 可选）
2. `extract_meta.sh` -> `meta.json`（包名/版本/签名/Manifest/DeepLink/资源/SDK）
3. `runtime_mods.sh` -> `runtime_mods.json`（InstantRun/DexAOP/Tinker 等运行时框架）
4. **如检测到加固**（`packer != none`）-> 打印手动脱壳指南 + `exit 2`
5. `decompile.sh` -> `class_index.json` + `decompiled/`（按 task 关键字筛 dex，节省 70% 时间）
6. 静态 grep -> `static_findings.json`（`rpc_endpoints` / `sign_headers` / `crypto_algos` / `hardcoded_keys`）

### 输出

- `workdir` 路径打印在 **最后一行 stdout**（用 `$(... | tail -1)` 截取）
- `workdir = /tmp/apk-reverse-<pkg>-<ts>/`（临时目录，系统清理会丢失！完成后必须将关键产物备份到项目目录）
- 内含: `meta.json` `runtime_mods.json` `class_index.json` `static_findings.json` `decompiled/` `decision-log.md` `.task` `evidence/`

### 耗时

- 淘宝级 APK（250MB，50 dex）:
  - `--skip-decompile`: ~30s
  - 完整（50 dex 反编译）: ~6-10 min
  - 按 task 筛选后（3-5 dex）: ~2 min

---

## 命令 2: `dynamic.sh`

**作用**: 跑一轮 Frida 动态 hook，可重复调用累积多轮。

```bash
bash $SKILL_DIR/scripts/dynamic.sh <workdir> <round_id> [--task <task>] [--duration N] [--attach|--spawn] [extra_scripts...]
```

### 参数

- `<workdir>` - `analyze.sh` 产生的工作目录
- `<round_id>` - 本轮 ID（建议 `round-1`、`round-2`、`cold-start`、`pull-refresh` 等）
- `--task <task>` - 用 `config.json` 中的 task 选脚本组合（默认从 `workdir/.task` 读）
- `--duration N` - Frida 跑多少秒，默认 60
- `--attach`（默认）/ `--spawn` - attach 已运行进程 / spawn 冷启
- `extra_scripts...` - 显式追加 Frida 脚本（覆盖 task 默认）

### 行为

1. `emu.sh keep-awake` + 截图（before）
2. 根据 task 从 `config.json` 取脚本组合
3. `run_frida.py` 跑 N 秒 -> log
4. 用户在模拟器做业务路径（Claude 应该明确告诉用户“现在做 XX”）
5. duration 到 -> 截图（after）
6. `reassemble_body.py --all` 拼回所有大响应
7. 解析 log -> `findings/round-N.json`（URLs / requests / responses / activities / so_loaded）

### 输出

```text
workdir/
├── findings/round-N.json
├── evidence/screenshots/round-N-{before,after}.png
├── evidence/logs/round-N.log
└── evidence/bodies/round-N/*.txt   <- 拼回的完整响应
```

### 标准调用模式（Claude 编排）

```text
Claude: "我要做一轮动态：请在模拟器启动 com.xxx.taobao，点 Agree 进首页。
全过程 60s 内完成。做完告诉我 `done`。"
user: done
Claude: 调 dynamic.sh <wd> round-1 --duration 60
```

---

## 命令 3: `render.sh`

**作用**: 把 `meta.json` + `runtime_mods.json` + `static_findings.json` + `findings/round-*.json` 聚合成单一 MASTG 报告。

```bash
bash $SKILL_DIR/scripts/render.sh <workdir>
```

### 输出

`~/.apk-reverse/reports/<package>/report.md` - MASTG 风格 6 章:

1. **APK 画像**（T1）- 元信息表格 + 签名 + 权限 + 组件 + DeepLink + Libs + SDK + runtime_mods
2. **静态分析**（T2）- 反编译概要 + 静态 grep + task 特化分析
3. **动态分析**（T3）- 多 round 折叠分组
4. **关键发现** - 占位，**Claude 必须人工填**
5. **复现与建议** - 自动生成复现命令 + 占位的防御建议
6. **附录** - 决策日志 / 截图 / 原始日志 / meta.json / runtime_mods.json（全部折叠）

### Claude 必须人工补充的部分

`render.sh` 把这几块留为占位，需 Claude 写:

- **§1 TL;DR**: 1-3 句核心结论
- **§4 关键发现**: 跨 §1/§2/§3 综合归纳，按 🔴 高 / 🟡 中 / 🟢 低排序，引用具体证据
- **§5 防御建议**: 针对发现的具体建议

Edit 报告文件直接改这几处。

---

## 命令 4: `publish.sh`

**作用**: 推 `report.md` 到语雀。**幂等**: 同 package 重跑只 update，不重复建文档。

```bash
bash $SKILL_DIR/scripts/publish.sh <package> [--namespace <ns>] [--no-yuque]
```

### 参数

- `<package>` - 必填，APK 包名（如 `com.taobao.taobao`）
- `--namespace <ns>` - 可选，覆盖 `config.json` 的 `default_namespace`（默认 `lingxi.mly/dbqqab`）
- `--no-yuque` - 跳过推送，仅返回本地 `report.md` 路径

### 行为

1. 读 `~/.apk-reverse/reports/<package>/report.md`
2. 查 `~/.apk-reverse/state/<package>.json` 的 slug
3. 有 slug -> `yuque update doc <ns/slug>`
4. 无 slug -> `yuque create doc` + 把返回的 slug 写回 state
5. 自动 `--upload-images --yes` 处理截图

### 输出

最后一行 stdout = 语雀 URL。

---

## 一键全流程示例

```bash
SKILL=$HOME/.codefuse/engine/cc/skills/apk-reverse-v3
APK=$HOME/Downloads/taobao.apk

# 1. T1+T2
WD=$(bash $SKILL/scripts/analyze.sh $APK --task first-screen-rpc | tail -1)
echo "workdir=$WD"

# (Claude 看 $WD/*.json，决定要不要动态)

# 2. T3 多轮（用户每轮在模拟器配合）
bash $SKILL/scripts/dynamic.sh $WD round-1 --duration 60
bash $SKILL/scripts/dynamic.sh $WD round-2 --duration 60

# 3. 渲染
bash $SKILL/scripts/render.sh $WD

# (Claude 用 Edit 把 TL;DR / §4 关键发现 / §5 建议 改成实际结论)

# 4. 发语雀
bash $SKILL/scripts/publish.sh com.taobao.taobao
```

## 排错速查

| 现象 | 原因 | 解法 |
|---|---|---|
| `analyze.sh` 报 `packer != none` 退出 | 检测到加固 | 手动脱壳后复跑（脚本输出脱壳指南） |
| `dynamic.sh` log 0 行 | Frida 没 attach 上 | 检查 `frida-ps -U`；安装/检查 `frida-server` 版本匹配（`emu.sh fs-install`） |
| `dynamic.sh` 启动 Frida 后 hook 0 命中 | 业务路径没加载 / 该 dex 按需加载 | 用 `--attach` 而非 `--spawn`；或脚本里用 `H.waitForClass` |
| `hook` 方法但始终无回调 | hook 了基类方法，子类 override 后该基类不被调 | 用 `H.hookActualImpl()` 通过稳定 API 锚点发现实际子类再 hook |
| `jadx` 反编译的类名 hook 不触发 | R8 混淆后类名与运行时不一致 | 用 `H.discoverRuntimeClass()` 通过稳定 API 锚点发现运行时实际类名 |
| `frida &` 后台输出不完整 | Frida CLI 缓冲行为，后台运行时 `console.log` 丢失 | 用 `tee` 管道或 Python 绑定（`run_frida.py`）获取实时输出 |
| `frida-dexdump -n` 找不到进程 | 进程名匹配失败 | 改用 `frida-dexdump -p <PID>` |
| Java Map 遍历 `TypeError` | `entrySet().iterator()` 在 Frida 下不是数组 | 用 `H.safeIterateMap(map, callback)` 代替 |
| `arguments[0]` 不是第一个参数 | Frida 约定 `arguments[0]` 是 `this`，实际参数从 `arguments[1]` 开始 | 按实际参数位置取值 |
| `spawn` 模式竞态 / `attach` 后进程被杀退出 | APP 有 Frida 检测 / 启动期杀进程 | 见下方“延时 Attach 策略” |
| `hook` 后 CPU 100%，所有回调失效 | `Process.setExceptionHandler` 被异常洪泛阻塞 | 绝对不要用 `Process.setExceptionHandler`；异常密集型 APP 会占满 JS 线程 |
| `render.sh` 大响应不在 `evidence/bodies` | label 命名含特殊字符 | 查 `reassemble_body.py` log 列出的 label 是否符合规则 |
| `publish.sh` 报 401 | yuque 未登录 / token 过期 | `yuque whoami`；必要时重新认证 |
| `publish.sh` 报图片上传失败 | 语雀图床偶发 503，或单张图过大被拒（>10MB） | 重试；或压缩过大的截图 |
| `publish.sh` 每次都新建文档不复用 | `state.json` namespace 不匹配 | 检查 `cat ~/.apk-reverse/state/<pkg>.json` |

## 进阶用法

### 不同 task 跑同一 APK，合并到同一报告

```bash
bash $SKILL/scripts/analyze.sh $APK --task first-screen-rpc   # WD1
bash $SKILL/scripts/dynamic.sh $WD1 round-firstscreen
bash $SKILL/scripts/dynamic.sh $WD1 round-h5 --task h5-container # 同 wd 切 task
bash $SKILL/scripts/render.sh $WD1
bash $SKILL/scripts/publish.sh com.xxx
```

报告 §3 会列出多个 round，分别按时序 + 场景标注。

### 仅做 T1 快速画像（30 秒）

```bash
bash $SKILL/scripts/analyze.sh $APK --skip-decompile
# meta.json + runtime_mods.json 立得，不反编译
```

### 强制重新建语雀文档

```bash
rm ~/.apk-reverse/state/<pkg>.json
bash $SKILL/scripts/publish.sh <pkg>  # 现在会 create 新的
```

---

## 方法论

### 类名稳定性分级

`jadx` 反编译的类名受 R8/ProGuard 混淆影响，需要区分可靠性等级:

| 等级 | 特征 | 示例 | 跨版本稳定性 | 建议 |
|---|---|---|---|---|
| 🟢 非混淆 | 全路径类名 | `com.xunmeng.pinduoduo.web.WebFragment` | 高 | 优先作为 hook 锚点 |
| 🟡 包名稳定 | 包名不变，内部混淆 | `com.xunmeng.pinduoduo.router.proxy.RouterRadicalPreload` | 中 | 可用，但内部方法名可能变 |
| 🔴 短混淆名 | 非完整名 | `w72.g` / `u03.c` / `e72.i` | 低 | 必须运行时确认，静态名放弃 |

**`analyze.sh` 输出的 `class_index.json` 中，类名长度 > 3 段的标 🟢，2 段的标 🟡，1 段的标 🔴。**

**关键原则**: 每个关键类必须用 `jadx` 签名匹配 + 运行时 hook 确认双重验证，运行时确认用 `H.discoverRuntimeClass()`:

```javascript
// 通过稳定 API 锚点发现运行时实际类名
H.discoverRuntimeClass('android.webkit.WebView', 'getWebViewClient');
// 输出: [DISCOVERY] android.webkit.WebView.getWebViewClient() -> com.example.CustomWebViewClient
```

### 渐进式脚本构建

不要一次性全量 hook，按阶段逐步扩大覆盖面:

| 阶段 | 覆盖范围 | 目的 | 对应命令 |
|---|---|---|---|
| V1 最小 | Activity + WebViewClient 发现 | 确认环境，发现运行时类 | `dynamic.sh --profile minimal` |
| V2 功能 | RPC/网络 + 预加载 | 收集业务数据 | `dynamic.sh`（默认） |
| V3 完整 | 全链路追踪 | 完整架构理解 | 多轮 `dynamic.sh` + 自定义脚本 |
| V4 验证 | 针对性 hook | 回答特定问题 | `dynamic.sh` + 专项脚本 |

**每阶段只验证上一阶段的未确认项，不要重做已确认的。V1/V2 阶段只收集数据，hook 不应改变 APP 行为。**

### 日志分析三原则

Claude 分析 Frida 日志时必须遵循:

1. **Grep 先于 Read**: URL 单条 2-3K 字符，直接 Read 日志文件会消耗大量 token。先用 `grep '\[TAG\]' logfile > filtered.log` 过滤，再按需 Read 过滤结果或原文件特定行
2. **签名先于实现**: 让 Agent 返回反编译代码时，只要求方法签名和关键 `if` 判断，不要完整方法体
3. **结论先于过程**: 分析结论写入 `findings/`，下次直接读结论不重新分析。`dynamic.sh` 每轮自动统计各 Tag 命中数帮助判断哪些 Tag 有数据

---

## 条件建议

> 以下建议在遇到特定场景时参考，不是每次逆向都必须执行。

### 延时 Attach 策略

**触发条件**: `--spawn` 模式下进程被杀，或 `--attach` 后进程在 15 秒内退出。

**建议**:
1. 让用户先手动在设备上导航到目标页面
2. 此时 `--attach` Frida（进程已稳定运行，检测相对宽松）
3. 用户立刻执行目标操作
4. 利用存活窗口采集数据
5. 心跳日志（`00_bootstrap.js` 自带 `[hb]`）确认 hook 是否仍在工作

**适用范围**: 强反 Frida 的头部 APP（微信、抖音、银行类等）。普通 APP 用默认 `--attach` 即可。

### 反检测脚本加载顺序

**触发条件**: APP 有 Frida 检测（进程被杀、hook 无效、日志中断）且需要自定义反检测脚本。

**建议**: `_anti_detect.js`（或任何反检测脚本）**必须**在所有业务脚本之前加载。多个脚本用多个 `-l` 参数按依赖顺序排列:

```bash
# 正确顺序: 反检测 -> 通用基础 -> 业务脚本
frida -U -p PID -l _anti_detect.js -l 00_bootstrap.js -l trace_xxx.js
```

**`dynamic.sh` 的 `run_frida.py` 已按 `_common.js > 00_bootstrap.js > 业务脚本` 顺序加载，一般不需要额外调整。**

### Process.setExceptionHandler 陷阱

**触发条件**: hook 后 CPU 飙升至 100% 或所有 hook 回调完全无输出。

**建议**: 检查代码中是否使用了 `Process.setExceptionHandler`。异常密集型 APP（部分加固 APP）每秒产生 10 万+ access-violation，ExceptionHandler 回调会完全占满 Frida JS 线程，导致所有 hook 失效。

**解法**: 绝对不要使用 `Process.setExceptionHandler`。如需捕获异常，改用 try/catch 在具体 hook 回调内处理。

### Hook 层级原则

**触发条件**: hook 了某个方法但始终没有回调输出。

**建议**:
1. 检查是否 hook 了基类方法。Java 多态下子类 override 后基类方法不执行，Frida hook 基类不会触发子类的回调
2. 用 `H.discoverRuntimeClass('android.webkit.WebView', 'getWebViewClient')` 先发现实际实现类
3. 用 `H.hookActualImpl('android.webkit.WebView', 'getWebViewClient', 'onPageStarted', cb)` 直接 hook 实际子类
4. 不假设网络请求走标准 OkHttp。先 hook `okhttp3.RealCall.enqueue` 确认有没有流量，无流量则说明 APP 用了自定义网络栈

### 非标准网络栈

**触发条件**: hook `okhttp3.RealCall.enqueue/execute` 后无流量或流量极少。

**建议**: APP 可能使用了自定义网络栈，H5 请求可能走 JSBridge 桥接到 Native 层。搜索以下特征定位入口:
- `JSBridge` / `NativeBridge` / `callNative` - H5 -> Native 桥接入口
- 类名含 `Network` / `Rpc` / `Dispatch` - Native 侧网络请求入口
- SO 库含 `pnet` / `tnet` / `marmot` - 自研网络库

**“先确认 OkHttp 有没有流量”这一步是通用的，之后的探测路径完全 APP 特定。**

### 多层 WebViewClient

**触发条件**: hook WebViewClient 有回调但时序异常，或 `setWebViewClient` 被调用多次。

**建议**: APP 可能使用了自研 WebView 内核（微信 XWeb、QQ 浏览器 TBS、美团等），架构为:

```text
业务 WebViewClient -> 适配层（Wrapper） -> 内核 WebViewClient
```

两层 WebViewClient 都可能需要 hook，用 `H.hookActualImpl('android.webkit.WebView', 'getWebViewClient', 'onPageStarted', cb)` 自动发现并 hook 实际子类。

**适用范围**: 自研 WebView 内核的 APP。使用标准 `android.webkit.WebView` 的 APP 不需要。

### 渐进验证方法论

**触发条件**: 逆向目标 APP 架构较复杂（多子系统 / 多入口 / 多内核），单轮 `dynamic.sh` 不够。

**建议**:
1. **R1 探索**: `analyze.sh` + 代码阅读 -> 建立初步假设（架构草图 + 关键类清单）
2. **R2 验证**: `dynamic.sh round-1 collection-only` + 运行时确认关键路径（类名映射 + 时序）
3. **R3 补全**: 针对性 hook -> 填补 R2 发现的空白和矛盾
4. **R4 闭环**: 多场景采集 -> 端到端验证整个架构理解

**每轮只验证上轮的未确认项。R2/R3 阶段只收集数据，hook 不应改变 APP 行为。**
