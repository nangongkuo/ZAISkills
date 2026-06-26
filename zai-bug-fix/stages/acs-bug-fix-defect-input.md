---
name: acs-bug-fix:defect-input
description: 阶段1-缺陷输入与初始化。接收缺陷描述、创建分支、初始化环境。
---

# 阶段1：缺陷输入与初始化

**交互文案**：引用 `prompts/welcome-prompts.md`

## 任务目标

接收缺陷描述，验证仓库环境，创建开发分支，完成初始化准备。

---

## 输入 Schema

| 字段 | 来源 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| repo_path | 调用参数 / 用户输入 | string | ✅ | 仓库绝对路径 |
| defect_description | 调用参数 / 用户输入 | string | ✅ | 缺陷描述原文，直接使用纯文本缺陷描述 |
| defect_id | 调用参数 / 缺陷查询 | string | ❌ | 缺陷 ID（如 `H1234` / `WI-9876`） |
| defect_source | 调用参数 / 缺陷查询 | string | ❌ | 缺陷来源，取值 `huoban` / `dima` / `manual` |
| branch_name | 调用参数 / 用户输入 | string | ❌ | 分支名，未提供则自动生成 |
| log_path | 调用参数 / 用户输入 | string | ❌ | 本地日志文件/文件夹路径，未提供则跳过日志分析 |
| trigger_time | 调用参数 / 用户输入 | string | ❌ | bug 触发时间（任意格式文本），用于阶段2裁剪日志时间窗口 |
| checking-skip | 调用参数 | boolean | ❌ | 无人驾驶模式，默认 false（注：缺陷查询步骤不受此影响） |

**说明**：阶段 1 支持三种来源：① 调用方预传 `defect_description` → 直接使用；② 调用方预传 `defect_id` + `defect_source` → 跳过查询直接拉详情拼装；③ 默认（含无人驾驶模式）→ 强制执行「缺陷查询 + 用户选择」交互流程，双源都查不到时降级为手动粘贴。

---

## 输出 Schema

| 字段 | 写入位置 | 类型 | 说明 |
|------|----------|------|------|
| branch_name | state.基本信息.分支名 | string | 创建的分支名 |
| repo_path | state.基本信息.仓库路径 | string | 仓库绝对路径 |
| start_time | state.基本信息.启动时间 | string | ISO时间戳 |
| defect_description | state.阶段1.缺陷描述 | string | 缺陷描述原文 / 平台详情拼装文本 |
| defect_id | state.阶段1.缺陷ID | string | 缺陷 ID，手动粘贴模式下为“未提供” |
| defect_source | state.阶段1.缺陷来源 | string | `huoban` / `dima` / `manual` |
| defect_url | state.阶段1.缺陷链接 | string | 平台缺陷详情链接，手动粘贴模式下为“未提供” |
| defect_context | state.阶段1.缺陷上下文 | string | 缺陷上下文文件路径 |
| defect_keywords | state.阶段1.缺陷关键词 | string | 从缺陷描述提取的关键词（用于分析阶段代码搜索） |
| log_path | state.阶段1.日志路径 | string | 本地日志文件/文件夹绝对路径，无效或未提供则为“未提供”或“路径无效” |
| trigger_time | state.阶段1.触发时间 | string | bug 触发时间原文，未提供则为“未提供” |

---

## 步骤清单

> 开始执行前实例化，每步完成后标记 ✅，输出 `[NEXT: stage=2]` 前逐项确认。

- [ ] Step 1：接收缺陷描述
- [ ] Step 2：接收日志路径与触发时间（可选）
- [ ] Step 3：创建分支
- [ ] Step 4：创建状态目录 + 配置 `.gitignore`
- [ ] Step 5：写入缺陷上下文
- [ ] Step 6：写入 state.md

---

## 执行步骤

> **参数预检原则**：每个步骤先检查调用方是否已通过 args 传入对应参数，已传入则直接使用并跳过交互询问，未传入才走交互式收集。

### Step 1：确定缺陷（查询 / args / 手动粘贴）

> **强制说明**：本步骤不受 `checking-skip` 影响。仅当调用方通过 args 显式传入 `defect_description`（分支 A）或 `defect_id` + `defect_source`（分支 B）时才能跳过缺陷查询；其他情况（含无人驾驶）一律走分支 C 的交互查询。

#### 分支 A：args 已传 `defect_description`

```
直接使用 args 中的 defect_description
defect_id     = args.defect_id 或 "未提供"
defect_source = args.defect_source 或 "manual"
defect_url    = "未提供"
输出："缺陷描述：{前100字}...（参数传入）"
→ 跳到 Step 1 末尾的「关键词提取」
```

#### 分支 B：args 已传 `defect_id` + `defect_source`

按 `defect_source` 拉详情，拼装为 `defect_description`：

```
case defect_source of:
  "huoban":
    bash <skill_root>/scripts/huoban-mydefects 不适用；改用：
    huoban-cli defect get --id=<defect_id>  → JSON
    解析字段填入下面「拼装格式」

  "dima":
    dima bug get <defect_id> --with-custom-fields -o json
    解析字段填入下面「拼装格式」

CLI 失败 / 未登录:
  输出警告 "⚠️ 详情拉取失败：{错误}；降级到手动粘贴"
  → 走分支 C 的「双源失败兜底」（直接询问用户粘贴）
```

> ⚠️ **沙箱旁路**：调用 `huoban-cli defect get ...` 和 `dima bug get ...` 时，Bash 工具必须传入 `dangerouslyDisableSandbox: true`，详见 `SKILL.md`「查询脚本」段。

#### 分支 C：默认 - 缺陷查询 + 用户选择（强制）

##### C-1. 输出查询中文案

按 `prompts/welcome-prompts.md` 场景 2.5「状态1：查询中」输出。

##### C-2. 并发执行两个查询脚本（同一响应内同时发两个 Bash tool call）

```bash
bash <skill_root>/scripts/huoban-mydefects wallet 20     # 文本输出，用 awk/grep 解析
bash <skill_root>/scripts/query-dima-bugs.sh -o json     # JSON 输出，用 jq 解析
```

> `<skill_root>` = `acs-bug-fix` skill 的安装根目录（即 SKILL.md 所在目录）。无现成 resolve 机制时，由调度器替换为绝对路径。
>
> ⚠️ **沙箱旁路（强制）**：上面两个 Bash tool call 都必须传入 `dangerouslyDisableSandbox: true`。默认沙箱仅放行 `code.alipay.com`，huoban-cli / dima 走的内部 API 域名会被静默阻塞，表现为“卡住直到超时”。两个 CLI 都是受信内部工具，禁用沙箱安全可控。

**单源失败处理**（CLI 未装 / 未登录 / 网络错误）：

- huoban 失败 → 警告（场景 2.5 状态4），huoban 结果置空
- dima 失败 → 警告（场景 2.5 状态4），dima 结果置空
- 双源失败或都为空 → 转到 C-5（兜底降级）

##### C-3. 解析 + 合并 + 编号展示

```
对 huoban 输出（文本）：
  按「缺陷ID:」「标题:」「状态:」「优先级:」「严重程度:」「描述:」分隔符切块
  每条提取 id/title/status/priority/severity 用于列表

对 dima 输出（JSON）：
  jq 提取 .data[] 的 id/title/status/priority/severity 用于列表

合并为统一编号列表（伙伴在前，Dima 在后），按场景 2.5 状态2 展示。
内部维护映射：编号 → (source, id, title 等)，用于后续 fetch 详情。
```

##### C-4. 文本列表展示 + 等待用户回复

按 `prompts/welcome-prompts.md` 场景 2.5「状态2：列表展示」输出**完整**编号列表（不裁剪），末尾固定带提示行 `→ 输入编号选择缺陷，输入 m 手动粘贴，或直接粘贴缺陷描述:`。

输出后**结束本轮回复**，等待用户下一条消息，按以下规则解析：

| 用户输入 | 处理 |
|----------|------|
| 纯数字 N，且 1 ≤ N ≤ 列表长度 | 取 `编号 → (source, id)` 映射 → 转下方 fetch 规则拉详情 |
| 纯数字但越界 / 其他无意义短串（如 `y` / `n`） | 输出场景 2.5「状态5：输入无效」提示，重新等待 |
| 单字符 `m` / 文本 `手动` / `粘贴` | 跳到 C-5（输出状态3 + 等下一条消息粘贴） |
| 其他多行/长文本 | 视为用户已直接粘贴缺陷描述，按 C-5 兜底处理（defect_source = "manual"） |

**用户选编号后的 fetch**（**Bash 调用必须带 `dangerouslyDisableSandbox: true`**）：

- `huoban` → `huoban-cli defect get --id=<id>` → JSON
- `dima` → `dima bug get <id> --with-custom-fields -o json`

解析详情，按下面「拼装格式」组装为 `defect_description`，记录 `defect_id` / `defect_source` / `defect_url`，输出：`📋 缺陷描述：{标题} | {优先级}/{严重程度} | {ID}`。

> 不使用 `AskUserQuestion`：其 options 数量被 schema 强制限制在 2-4 之间，与“可能 10+ 条缺陷”的现实冲突；纯文本列表 + 自由输入对长列表更自然，也兼容“用户其实想直接粘贴”的场景。

##### C-5. 兜底降级 - 手动粘贴

```
输出场景 2.5 状态3 文案
等待用户下一条消息（粘贴的缺陷描述）
defect_description = 用户原文
defect_id          = "未提供"
defect_source      = "manual"
defect_url         = "未提供"
输出："📋 缺陷描述：{前100字}..."
```

##### 拼装格式（分支 B / C-4 共用）

详情拉取成功后，统一拼成下面结构化文本作为 `defect_description`，让阶段 2 的关键词提取能拿到自然语言又能识别字段：

```
【来源】伙伴 / Dima
【ID】H1234 / WI-9876
【标题】修复支付页面加载白屏
【状态】待处理
【优先级】P1
【严重程度】严重
【平台】iOS
【模块】支付
【客户端版本】10.5.0    ← 仅 huoban 有，dima 写“未知”
【处理人】zhangsan
【创建时间】2026-05-19 14:30:25
【链接】{defect_url}    ← 有则填，否则“未知”

【描述】
{原始描述全文}
```

> 字段缺失统一用“未知”占位，与两个脚本现有降级行为保持一致。

##### 关键词提取（所有分支统一执行）

从最终 `defect_description` 中提取用于代码搜索的关键词：

- 提取类名、方法名（大写开头的驼峰词、小写开头的驼峰词后跟括号）
- 提取模块名/功能名（含 `【模块】` / `【平台】` 字段值）
- 提取错误信息中的关键片段
- 去除停用词和通用词

将关键词记录到 `defect_keywords`。

### Step 2：接收日志路径与触发时间（可选）

**日志路径** - 用户的本地崩溃栈/运行日志，阶段 2 用于补充根因证据：

```
if log_path 已通过 args 传入:
  expand ~ → 路径展开
  test -e <expanded> 校验存在性
  存在 → log_path = realpath(expanded)
        输出："✅ 日志路径：{log_path}（参数传入）"
  不存在 → log_path = "路径无效"
        输出警告："⚠️ 日志路径无效（不阻塞流程）：{原值}"
elif checking-skip 为 true:
  log_path = "未提供"
  跳过询问
else:
  输出日志路径询问文案（场景 3.5）
  接收输入：路径 / 回车跳过 / skip 跳过
  跳过 → log_path = "未提供"
  填写 → 走 args 传入相同的 expand + test -e 流程
```

> **不阻塞原则**：日志路径无效或未提供均不阻塞，仅在阶段 2 跳过日志相关分析。

**触发时间** - 任意格式文本，阶段 2 用于裁剪日志时间窗口（不参与 git log 约束）：

```
if trigger_time 已通过 args 传入:
  原样使用（不做格式校验）
  输出："🕒 触发时间：{trigger_time}（参数传入）"
elif checking-skip 为 true:
  trigger_time = "未提供"
  跳过询问
else:
  输出触发时间询问文案（场景 3.6）
  接收输入：时间点 / 时间段 / 回车跳过 / skip 跳过
  跳过 → trigger_time = "未提供"
  填写 → 原样使用（不做格式校验，由阶段 2 Step 0.5 处理）
```

> **不校验格式**：阶段 1 不解析时间，统一交由阶段 2 Step 0.5 做类型识别（point/range/unknown）+ 精度分级 + 容错扩窗。

### Step 3：创建分支

```
if branch_name 已通过 args 传入:
  直接使用，执行 git checkout -b <branch_name>
  分支已存在时执行 git checkout <branch_name>
  输出："🌿 分支：{branch_name}（参数传入）"
elif checking-skip 为 true 且 branch_name 未传入:
  从缺陷描述关键词自动生成分支名（kebab-case），前缀 bot/fix/
  执行 git checkout -b <auto_branch_name>
  输出："🌿 分支：{auto_branch_name}（自动生成）"
else:
  输出分支询问文案（含命名建议，前缀 bot/fix/）
  接收输入：分支名 / auto
  分支已存在时提示处理
  执行 git checkout -b
  输出成功文案
```

### Step 4：创建状态目录并配置 `.gitignore`

执行以下操作：

```bash
# 创建状态目录
mkdir -p <仓库路径>/.acs-bug-fix

# 将状态目录加入 .gitignore
echo ".acs-bug-fix/" >> <仓库路径>/.gitignore
```

### Step 5：写入缺陷上下文

写入 `<仓库路径>/.acs-bug-fix/defect_context.md`：

```markdown
# 缺陷描述

{用户提供的纯文本缺陷描述，原样写入}
```

### Step 6：写入 state.md

写入 `<仓库路径>/.acs-bug-fix/state.md`：

```markdown
# ACS Bug Fix 状态

版本：1.0

## 基本信息
| 项目 | 值 |
|------|----|
| 当前阶段 | 2 |
| 分支名 | {branch_name} |
| 仓库路径 | {repo_path} |
| 启动时间 | {time} |
| 更新时间 | {time} |
| 无人驾驶 | {checking-skip，默认 false} |
| 日志路径 | {log_path 或 "未提供" 或 "路径无效"} |
| 触发时间 | {trigger_time 或 "未提供"} |

## 已完成阶段
### 阶段1：缺陷输入与初始化
状态：✅ 完成
完成时间：{time}
执行模式：{mode}
执行耗时：{duration}秒
缺陷描述：{defect_description 前100字}
缺陷ID：{defect_id 或 "未提供"}
缺陷来源：{defect_source: huoban / dima / manual}
缺陷链接：{defect_url 或 "未提供"}
缺陷上下文：.acs-bug-fix/defect_context.md
缺陷关键词：{defect_keywords}
分支：{branch_name}
日志路径：{log_path 或 "未提供" 或 "路径无效"}
触发时间：{trigger_time 或 "未提供"}

.gitignore：已配置

问题记录：[]

## 待执行
下一阶段：2
```

---

## 完成前验证

> 步骤清单全部 ✅ 后，逐项执行以下验证，全部通过才可输出返回摘要。

| # | 验证项 | 检查方式 | 不通过时修复动作 |
|---|--------|----------|------------------|
| 1 | `.acs-bug-fix/` 目录存在 | `test -d <repo>/.acs-bug-fix` | 执行 `mkdir -p` |
| 2 | `.gitignore` 包含 `.acs-bug-fix/` | `grep ".acs-bug-fix" <repo>/.gitignore` | 追加到 `.gitignore` |
| 3 | `defect_context.md` 已写入 | `test -f <repo>/.acs-bug-fix/defect_context.md` | 立即写入 |
| 4 | `state.md` 已写入且包含「阶段1」 | `grep "阶段1" <repo>/.acs-bug-fix/state.md` | 立即写入 state.md |
| 5 | `log_path` 不为空时已校验路径存在（无效按“路径无效”记录） | 检查 Step 2 是否对 log_path 调用了 `test -e` | 若未校验，补做一次校验并更新 state |
| 6 | `state.md` 包含「日志路径」「触发时间」字段 | `grep "日志路径\\|触发时间" <repo>/.acs-bug-fix/state.md` | 立即补写 state.md |
| 7 | `state.md` 包含「缺陷ID」「缺陷来源」字段 | `grep "缺陷ID\\|缺陷来源" <repo>/.acs-bug-fix/state.md` | 立即补写 state.md（传入、选择、manual 时也必须存在） |

---

## 返回摘要

```
✅ 阶段 1 完成

📋 缺陷信息
描述：{defect_description 前80字}...
关键词：{defect_keywords}
分支：{branch_name}

📦 环境状态
仓库：{repo_path}
上下文：.acs-bug-fix/defect_context.md

🧾 辅助证据
日志路径：{log_path 或 "未提供" 或 "路径无效"}
触发时间：{trigger_time 或 "未提供"}



[NEXT: stage=2]
```

---

## 错误处理

| 错误 | 处理 |
|------|------|
| 分支创建失败 | 提示冲突处理 |
| 用户跳过必填输入 | 记录状态继续 |

---

## 重要约束

- **参数优先**：调用方已传入的参数直接使用，不再重复询问
- **交互降级**：未传入的必填参数通过用户对话收集
- **无人驾驶兼容**：`checking-skip=true` 时，可选参数未传入则自动处理，不阻塞流程
- **缺陷查询步骤强制**：Step 1 的缺陷查询不受 `checking-skip` 影响。仅当 args 显式传入 `defect_description` 或 `defect_id`+`defect_source` 时才能跳过；其他情况（含无人驾驶）一律按查询并选择缺陷的流程
- **查询失败不阻塞**：huoban / dima 任一源失败 → 警告 + 继续展示；双源都失败或都为空 → 自动降级为「缺陷描述粘贴」的手动输入流程，绝不因查询失败中止整个工作流
- **缺陷描述完整性**：缺陷描述是后续分析的核心输入，必须原样保留，不做截断或改写

---

## 调度器指令

> **本阶段执行完毕。输出上方返回摘要后，立即执行 `[NEXT: stage=2]`，进入阶段执行循环的下一轮。禁止停留等待用户输入。**
