---
name: apk-reverse-skill
description: 一键自动化 Android APK 逆向分析。用户说“分析/逆向 xxx APK 代码”、“分析/逆向 xxx 技术链路/实现方案”时触发。一键自动化 + MASTG 风格报告 + 语雀同步
human-name: APK 逆向分析
owner: 凌逸
model: sonnet
allowed-tools: [Bash, Read, Write, Edit, Agent, TaskCreate, TaskUpdate, AskUserQuestion]
---

# APK 逆向分析 v3

**一键自动化** + **MASTG 风格报告** + **语雀等同步**

> 输入: 1 个 APK 路径
> 输出: 1 份语雀文档 + 本地 `~/.apk-reverse/reports/<pkg>/`

## 触发条件

用户描述含以下任一即触发:
- “分析/逆向 xxx APK，冷启动链路首页关键技术链路”
- “帮我分析首页进入详情页预加载策略”
- “分析 xxx H5容器/小程序的加载流程”
- “分析 xxx 场景启动链路的RPC”
- “分析 xxx 场景的安全审计”

## 能力边界

| Tier | 能力 | 自动达成 |
|---|---|---|
| **T1** | 元信息/Manifest/签名/DeepLink/资源/SDK 画像/加固识别 | `analyze.sh` |
| **T2** | Java 业务代码/H5 容器/RPC 调用链 | `analyze.sh`（packer=none 时） |
| **T3** | Frida 动态 hook / 抓包 / 截图 | 需用户配合（启动模拟器 + 业务路径手动） |
| **T4** | Native、VMP、算法还原 | **默认不做**，只输出定位，除非用户要求 |

## 工作流（4 命令，按需调用）

```
1. analyze.sh <apk> [--task <task>]        # T1+T2 全自动（必跑）
2. dynamic.sh <workdir> <round_id>         # T3，按需调（可多轮）
3. render.sh <workdir>                     # 聚合渲染单个 MASTG 报告（必跑）
4. publish.sh <pkg> [--namespace ns]       # 推语雀（幂等：首次 create，后续 update）
```

详细见 `PLAYBOOK.md`。

## Task 列表（决定要 grep 什么 + 用哪些 frida 脚本）

| task | 适用 | 默认 frida 脚本 |
|---|---|---|
| `first-screen-rpc` | 首页/首页商品_RPC | `_common + 00_bootstrap + trace_mtop + trace_lifecycle` |
| `h5-container` | WebView/小程序/落地页 | `_common + 00_bootstrap + trace_mtop` |
| `deeplink` | scheme/intent 入口 | `_common + 00_bootstrap + trace_deeplink` |
| `security-audit` | 权限/exported/明文 key | `_common + 00_bootstrap + trace_lifecycle` |
| `native-jni` | so/JNI/加密 | `_common + 00_bootstrap + trace_jni` |

未指定 task 时默认走 `first-screen-rpc`（最通用）。

## 标准编排（Claude 看这里）

```
user: "分析 /path/to/x.apk 看首屏 RPC"
  ↓
1. bash $SKILL_DIR/scripts/analyze.sh /path/to/x.apk --task first-screen-rpc
   -> workdir 路径打印在最后一行
   -> 内容 meta.json / runtime_mods.json / static_findings.json / decompiled/
  ↓
Claude:
- 读 meta.json + runtime_mods.json + static_findings.json
- 草拟 §1 §2 内容
- 用 AskUserQuestion 一次问: "要做 T3 动态吗？(y/n)"
  ↓ (y)
Claude: "请在模拟器：[具体步骤，由 task 决定]。做完回复 done。"
  ↓ (用户: done)
2. bash $SKILL_DIR/scripts/dynamic.sh <workdir> round-1
   -> findings/round-1.json
   -> evidence/screenshots/round-1-{before,after}.png
   -> evidence/logs/round-1.log
   -> evidence/bodies/round-1/<all dumped bodies>
  ↓ (可多轮 round-2 / round-3 ...)
3. bash $SKILL_DIR/scripts/render.sh <workdir>
   -> ~/.apk-reverse/reports/<pkg>/report.md
  ↓
Claude: Edit report.md 把 §4 关键发现 / §5 建议 / TL;DR 改成实际分析结论
  ↓
4. bash $SKILL_DIR/scripts/publish.sh <pkg>
   -> 语雀 URL
```

## 证据标注

- 📖 jadx 静态代码
- 🧪 Frida 真实观测
- ⚠️ 推测

**绝不**把推测标 📖，**绝不**把“写了没跑”标 🧪。

## 数据目录

```
~/.apk-reverse/
├── reports/<package>/          <- 单一报告 + evidence（持久化）
│   ├── report.md               <- MASTG 风格 6 章
│   ├── meta.json
│   ├── runtime_mods.json
│   ├── static_findings.json
│   ├── decision-log.md
│   └── evidence/
│       ├── screenshots/round-N-{before,after}.png
│       ├── logs/round-N.log
│       └── bodies/round-N/*.txt
├── state/<package>.json        <- yuque slug 记忆
└── knowledge/                  <- 跨会话沉淀（可选）

/tmp/apk-reverse-<pkg>-<ts>/    <- 临时工作目录（不持久！完成后必须备份到项目目录）
```

## 核心规则（MUST）

1. **产物持久化到项目目录**: 所有最终产物（Frida脚本、分析报告、日志、hook结果、findings）**必须**写到项目目录（`<project_dir>/`）或 `~/.apk-reverse/reports/<pkg>/`。写 `/tmp` 的仅限 analyze.sh 等脚本的中间临时工作目录，**完成后必须将关键产物复制/备份到项目目录**。`/tmp` 系统清理会丢失所有工作！（血泪教训：整个 xhs-reverse 工作成果因写 /tmp 被清空）
2. 每条结论必须证据标注，**绝不捏造**
3. Tier 标在报告 §1 头部
4. 大响应（>10KB）一律用 `H.dumpString/dumpBytes` 分段输出 + `reassemble_body.py` 拼回
5. 模拟器交互前先 `bash scripts/lib/emu.sh keep-awake`
6. 同一 APK 多次调用 `publish.sh` 的 slug 记忆，**不重复建文档**
7. 动态阶段最多问用户 1 次（要不要做 T3）；之后每轮明确告知“请做 XX，做完回复 done”
8. **不**自动点屏幕（用户在模拟器手动）
9. Native VMP 默认不还原，只列入口 + 推测用途，用户明确要求再反编译；

## Claude 分析原则（MUST）

1. **Grep 先于 Read**: 分析日志时，先用 `grep` 按 Tag 过滤，再按需 Read 过滤结果或特定行。URL 单条 2-3K 字符，直接全量 Read 会消耗大量 token
2. **签名先于实现**: 让 Agent 返回反编译代码时，只要求方法签名和关键代码 和 if条件，默认不需要完整方法体
3. **结论先于过程**: 分析结论写入 `findings/` 目录，下次读取作为重要参考，不重新分析原始日志
4. **混淆名验证**: jadx 反编译的类名可能 ≠ 运行时类名（尤其短混淆名如 `w72.g`），关键类必须运行时确认，用 `H.discoverRuntimeClass()` 通过稳定 API 锚点发现实际类名
5. **渐进式分析**: 不要一次性全量 hook，抓关键点，从最小 hook 集开始逐步扩大（V1 最小 -> V2 功能 -> V3 完整 -> V4 验证）

## 文件索引

- `PLAYBOOK.md` - 详细操作手册（每个命令的参数 + 输出 + 排错）
- `config.json` - 任务关键字 / yuque 默认 namespace / static-grep 模式
- `templates/report.md.tpl` - MASTG 报告模板
- `templates/tasks/*.md` - 5 个 task 特化分析指南
- `scripts/`
    - `analyze.sh` `dynamic.sh` `render.sh` `publish.sh` - 4 个入口
    - `lib/_common.sh` `extract_meta.sh` `runtime_mods.sh` `decompile.sh` `emu.sh` `run_frida.py` `reassemble_body.py`
    - `frida/` `lib/_common.js` `00_bootstrap.js` `trace_mtop.js` `trace_lifecycle.js` `trace_deeplink.js` `trace_jni.js`

## 合规

仅供本机研究 / 竞品分析 / 自家审计 / CTF。**禁止**发布破解、规模化爬取、破解付费/风控。

---

## 用户使用指南维护

本 skill 配套一份用户使用指南，发布在语雀:

- **URL**: https://yuque.antfin.com/lingxi.mly/dbqqab/qlzc7t1sg6da501g
- **本地源**: `~/.apk-reverse/GUIDE.md`
- **Slug 记忆**: `~/.apk-reverse/state/_guide.json`

**任何 skill 变更（新增脚本 / 改命令参数 / 改默认行为）后，MUST 执行**:

1. 编辑 `~/.apk-reverse/GUIDE.md`（追加更新日志 + 改对应章节）
2. 跑同步:
   ```bash
   bash $SKILL_DIR/scripts/update_guide.sh
   ```

会自动 update 同一 slug，URL 不变。
