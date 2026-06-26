---
name: acs-bug-fix:analysis
description: 阶段2-根因分析。结合缺陷描述与仓库最近提交，迭代分析根因，与用户确认。
---

# 阶段2：根因分析（迭代循环）

**核心阶段**：这是整个 Skill 最关键的阶段。bug 通常是最近改出来的，commit 历史是最关键的线索。

---

## 输入 Schema

| 字段 | 来源 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| repo_path | state.基本信息.仓库路径 | string | ✅ | 仓库绝对路径 |
| defect_context | state.阶段1.缺陷上下文 | string | ✅ | 缺陷上下文文件路径 |
| defect_keywords | state.阶段1.缺陷关键词 | string | ✅ | 搜索关键词 |
| log_path | state.阶段1.日志路径 | string | ❌ | 本地日志文件/文件夹绝对路径，Step 0.5 / Step 3.5 消费 |
| trigger_time | state.阶段1.触发时间 | string | ❌ | bug 触发时间原文，**仅** Step 0.5 用于裁剪日志窗口，不参与 git log 约束 |
| 无人驾驶 | state.基本信息.无人驾驶 | boolean | ❌ | 是否跳过确认环节，默认 false |

---

## 输出 Schema

| 字段 | 写入位置 | 类型 | 说明 |
|------|----------|------|------|
| 根因 | state.阶段2.根因 | string | 确认的根因描述 |
| 证据链 | state.阶段2.证据链 | string | commit → 代码变更 → bug 的逻辑链 |
| 涉及代码 | state.阶段2.涉及代码 | string | 相关代码文件和行号 |
| 修复方向 | state.阶段2.修复方向 | string | 初步修复策略 |
| 分析轮次 | state.阶段2.分析轮次 | number | 经历的分析循环轮次 |
| Brainstorm | state.阶段2.Brainstorm | string | 已执行 / 已跳过 |

---

## 步骤清单

> 开始执行前实例化，每步完成后标记 ✅，输出 `[NEXT: stage=3]` 前逐项确认。

- [ ] Step 0.5：日志时间窗口裁剪与关键词提取（log_path 有效时执行）
- [ ] Step 1：代码搜索
- [ ] Step 2：最近 Commit 分析
- [ ] Step 3：代码阅读
- [ ] Step 3.5：日志 ∩ Commit 交叉分析（log_path 有效时执行）
- [ ] Step 4：形成根因假设
- [ ] Step 5：用户确认（迭代循环入口）
- [ ] Step 6：写入 state.md

---

## 执行步骤

### Step 0.5：日志时间窗口裁剪与关键词提取（新增）

**触发条件**：`log_path` 有效（非“未提供” / 路径无效）。无效则跳过本步，`defect_keywords` 仅来自缺陷描述，Step 3.5 一并跳过。

**核心定位**：`trigger_time` 的**唯一作用**是裁剪日志，把潜在几 MB ~ 几十 MB 的日志裁成可读窗口。它**不影响** git log（Step 2 永远默认 `-30`）。

**执行逻辑**：

#### 1）路径展开 + 类型判断

- 展开 `~` → `test -e`
- 文件 → 单文件流读
- 文件夹 → 列目录，过滤 `.log` / `.txt` / `.crash`，各自走单文件流程后合并 excerpt

#### 2）小文件直通判断

```
wc -l + ls -l 取行数 / 字节数
if 行数 ≤ 1500 或 字节数 ≤ 200KB:
    跳过裁剪，整体 Read 日志
    跳到 step 7「关键词提取」
```

#### 3）trigger_time 类型识别 + 精度解析

先判断 trigger_time 的输入类型（优先级顺序）：

| 类型 | 识别规则 | 示例 | 处理 |
|------|----------|------|------|
| range（时间段） | 包含 `~` / `-`（在两个时间值之间）/ `到` / `至` / `to`，且两端能解析成时间 | `2026-05-19 14:30 ~ 15:00` / `14:30-15:00` / `14:30 至 15:00` | 取窗口 `[A, B]`，正常窗口，不使用精度推断 |
| point（时间点） | 单一时间值（任一格式） | `2026-05-19 14:30:25` / `14:30` / `昨天 15:10` | 根据精度裁剪默认窗口 |
| unknown | 自然语言且无明确时间 | `上周三晚上` / `刚才` / `未提供` | 跳过裁剪，整体 Read（走 limit 截尾），跳到 step 7 |

时间点的精度分级（确定默认窗口）：

| 精度 | 示例 | 默认窗口 |
|------|------|----------|
| second | `2026-05-19 14:30:25` / `2026-05-19T14:30:25` | trigger_time ±10 分钟 |
| minute | `2026-05-19 14:30` / `14:30`（补当天） | ±15 分钟 |
| hour | `2026-05-19 14` / `14:00` | ±1 小时 |
| day | `2026-05-19` / `05/19` / `昨天` / `今天` | 当天 00:00 ~ 23:59 |

#### 4）日志时间戳格式探测

Read 日志前 100 行，正则尝试匹配：
- ISO：`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}`
- 常见：`\d{4}-\d{2}-\d{2}[ /]\d{2}:\d{2}:\d{2}`
- 短时（无日期）：`\d{2}:\d{2}:\d{2}` - 假定 trigger_time 当天
- 毫秒戳：`\b\d{13}\b`
- 秒戳：`\b\d{10}\b`

命中率 < 30% → 视为无可识别时间戳，**降级为整体 Read**（走 limit 截尾），跳到 step 7。

#### 5）窗口裁剪 + 容错扩窗

```
# 初始窗口
if range: window = [A, B]
elif point: window = base_window(精度)   # second±10min, minute±15min, hour±1h, day当天

# 扩窗循环（最多 4 次）
loop:
    excerpt = grep 时间戳 in window from log
    if excerpt 行数 ≥ 50 且 命中错误关键词(ERROR|CRASH|FATAL|Exception|Error):
        break
    window = expand_next(window)
    # 时间点扩窗序列: ±10min → ±30min → ±2h → 当天 → 全文
    # 时间段扩窗序列: [A, B] → [A-30min, B+30min] → [A-2h, B+2h] → 当天 → 全文

if 最终仍未命中错误关键词:
    记录: "⚠️ trigger_time 附近未发现错误日志，可能时间不准确，已扩到全文"
```

#### 6）错误密度引导（扩窗后）

- 计算「用户给的中心点」：
  - point → trigger_time 本身
  - range → (A+B)/2
- 若 excerpt 中错误关键词位置距用户中心 > 30 分钟：
  - 以错误聚集段中心重新定 ±10 分钟窗口
  - 输出附：`📌 错误聚集段中心: {actual_center}（用户给的 trigger_time: {orig}）`

#### 7）关键词提取

从最终 excerpt 中提取：
- 堆栈中的类名/方法名（优先 Java/OC/Swift/ArkTS 类名规则）
- 错误信息关键片段
- 显式出现的 `文件名:行号` → 记入「日志命中点集合 L」（供 Step 3.5）

合并到 `defect_keywords`，作为 Step 1 代码搜索的**最高优先级**词。

**输出**（追加到 `defect_context.md`）：

```markdown
## 日志预处理
- 日志路径：{log_path}
- 文件大小：{N} 行 / {M} KB
- trigger_time：{原文}（类型：{point/range/unknown}；精度：{minute/hour/day/-}）
- 时间戳格式：{ISO/short/毫秒戳/...}
- 实际窗口：{start} ~ {end}（扩窗 {N} 次）
- 错误关键词命中：ERROR×{n}，Exception×{m}，...

### 日志命中点集合 L
- {file}:{line} - {堆栈片段}
- {ClassName}.{method} - {错误信息}

### 提取关键词
{keyword1}, {keyword2}, ...
```

---

### Step 1：代码搜索

基于缺陷描述和关键词搜索代码库，定位相关代码文件。

**搜索策略（按优先级执行）**：

```
0. 【最高优先级，log_path 有效时执行】
   优先使用 Step 0.5 提取的「日志命中点集合 L」与关键词作为搜索词
   这些是基于堆栈/错误信息的最强线索，直接 Read 命中点对应的文件
1. 从 defect_keywords 提取搜索词
2. 用 Grep 搜索类名/方法名
   - 优先搜索精确匹配（驼峰类名、方法名+括号）
   - 再搜索模糊匹配（功能关键词）
3. 用 Glob 搜索目录结构
   - 根据模块名定位模块目录
   - 根据平台信息限定搜索范围（iOS/Android/HarmonyOS 目录）
4. 搜索缺陷描述中出现的错误信息字符串
   - Grep 搜索日志/错误信息中的关键片段
5. 检查知识索引（如果存在）
   - 读取 knowledge/knowledge-index.json
   - 匹配与缺陷相关的知识文档
```

**输出**：候选代码文件列表（3-8 个），记录文件路径和匹配原因。

追加到 `defect_context.md`：

```markdown
## 代码搜索结果
- `path/to/FileA.java` - 匹配原因：包含方法 captureFrame()
- `path/to/FileB.java` - 匹配原因：包含类 LiveScreenshotManager
- `path/to/FileC.java` - 匹配原因：包含错误信息 "Surface already released"
```

---

### Step 2：最近 Commit 分析

**核心逻辑：bug 通常是最近改出来的，commit 历史是最关键的线索。**

> **trigger_time 与 commit 完全解耦**：本步 `git log` 永远默认 `-30`，**不接受**任何 trigger_time 时间窗口的约束，trigger_time 仅在 Step 0.5 用于裁剪日志窗口。
> 若 trigger_time 非空（非“未提供”），在分析输出顶部附一行原文记录，仅作上下文参考：`⚪ 用户提供的 trigger_time: <原值>（已用于日志窗口裁剪，见 Step 0.5）`。

```
1. git log --oneline -30
   → 获取最近 30 条 commit（窗口固定，不受 trigger_time 影响）

2. 筛选相关 commit
   → git log --oneline -30 -- <Step 1 定位的文件路径>
   → 也可根据 commit message 中的关键词筛选（与缺陷关键词匹配）

3. 查看可疑 commit 的 diff
   → 对最相关的 2-5 个 commit 执行 git show <hash>
   → 重点分析：
     - 异步/并发相关变更（async, await, callback, handler, thread, dispatch）
     - 空值/null 检查的移除或遗漏
     - API 签名变更（参数增减、返回值变更）
     - 重构引入的间接调用
     - 条件判断逻辑变更（if/else/switch 修改）
     - 资源生命周期变更（open/close, acquire/release, init/destroy）

4. 识别可疑 commit
   → 标记可能引入 bug 的 commit
   → 构建证据链：commit → 代码变更 → bug 表现

5. 【供 Step 3.5 使用】对每个候选 commit 执行 git show --name-only / 或解析 diff
   → 提取改动的（文件，行号范围，commit hash）
   → 记入「commit 变更点集合 C」
```

追加到 `defect_context.md`：

```markdown
## Commit 分析
### 相关 Commit
- abc1234 重构截图异步逻辑 - 涉及 LiveScreenshotManager.java
  变更：将 captureFrame() 从同步改为异步回调
  可疑度：⭐⭐⭐ 直接相关

- def5678 修复截图内存泄漏 - 涉及 LiveScreenshotManager.java
  变更：添加 Surface 释放逻辑
  可疑度：⭐⭐ 可能关联

### 可能引入 bug 的变更
commit abc1234：将 captureFrame() 改为异步后，回调中未检查 Surface 有效性
```

---

### Step 3：代码阅读

读取 Step 1/2 定位到的关键文件，分析代码逻辑。

**阅读策略**：

```
1. 优先读可疑 commit 涉及的文件和方法
   → git show <hash> -- <file> 查看具体变更的行
   → 读取变更前后上下文（变更行 ± 30 行）

2. 读缺陷模块的入口类/核心类
   → 从 Step 1 搜索结果中选取最核心的 2-3 个文件

3. 关注以下模式：
   - 异步/并发场景：回调、Future、Handler、dispatch_async
   - 空值/null 处理：判空、guard、optional
   - 边界条件：数组越界、除零、空集合
   - 生命周期管理：init/destroy、onCreate/onDestroy、viewWillAppear/viewDidDisappear
   - 状态管理：状态变量、标志位、锁

4. 【log_path 有效时】对照 Step 0.5 提取的「日志命中点集合 L」
   → 若集合中含 文件名:行号 → 精确读取该位置 ±30 行
   → 若集合中含 类名.方法名 → 定位方法所在文件，读取方法体上下文
```

追加到 `defect_context.md`：

```markdown
## 代码分析
### 关键代码
- LiveScreenshotManager.java:142-168 - captureFrame() 异步回调，回调中直接调用 surface.getCanvas() 未检查有效性
- SurfaceHelper.java:45-52 - release() 方法释放 Surface 但未通知回调方
```

---

### Step 3.5：日志 ∩ Commit 交叉分析（新增）

**触发条件**：`log_path` 有效 且 Step 2 产出非空 commit 集合。否则跳过，直接进入 Step 4。

**核心思想**：
- 日志（空间维度）告诉你「哪里炸了」- 锁定可疑代码位置
- commit（时间维度）告诉你「什么时候被改坏的」- 锁定可疑变更
- **两者交集 = 最高嫌疑根因**

**输入**：
- L: Step 0.5 提取的「日志命中点集合」（文件名:行号 / 类名.方法名）
- C: Step 2 提取的「commit 变更点集合」（文件，行号范围，commit hash）

**执行逻辑**：

```
1. 精确交集 L ∩ C:
   for (file, line) in L:
      for (file_c, range_c, hash) in C:
         if file == file_c 且 line ∈ [range_c.start - 5, range_c.end + 5]:
            加入「精确命中」

2. 精确为空 → 退化到文件级交集:
   for (file, line) in L:
      for (file_c, range_c, hash) in C:
         if file == file_c:
            加入「文件级命中」

3. 仍为空 → 输出 "⚠️ 日志与 commit 无交集，根因可能不在最近变更中，转为常规分析"
```

**输出**（追加到 `defect_context.md`）：

```markdown
## 日志 ∩ Commit 交叉分析

### 精确命中（最高嫌疑）
- {file}:{line}
  日志：{堆栈片段}
  commit:{hash} - {message}
  变更：{git show 摘要}

### 文件级命中
- {file}
  日志报错点：{file}:{line}
  commit:{hash} - 改动了同文件其他行({range})
```

---

### Step 4：形成根因假设

综合缺陷描述 + 代码搜索 + commit 分析 + 代码阅读 + （log_path 有效时）日志预处理与交叉分析，形成根因假设。

**根因生成优先级**（log_path 有效时）：

```
1. Step 3.5「精确命中」→ 证据最强，直接以交叉点为根因
2. Step 3.5「文件级命中」→ 证据较强，需结合代码逻辑推理
3. Step 3.5 都为空 / log_path 无效 → 退回原有的「commit 可疑度评分」逻辑
```

**输出格式**：

```
📌 疑似根因
{一句话描述根因}

🧾 证据链
commit {hash} → {变更内容} → {引入的问题} → {bug 表现}

📍 涉及代码
• {文件1}:{行号范围} - {说明}
• {文件2}:{行号范围} - {说明}

🧾 日志线索（仅 log_path 有效时输出）
• {日志文件名}:{关键行号} - {堆栈/错误片段摘要}
• 实际读取窗口：{start} ~ {end}

🔁 交叉命中（仅 Step 3.5 有命中时输出）
• {file}:{line} ← commit {hash} 在此处改动 ← 日志在此处报错

🔧 初步修复方向
{修复策略概述}

⚠️ 回归风险
{风险评估}
```

追加到 `defect_context.md`：

```markdown
## 根因分析

📌 疑似根因
LiveScreenshotManager.captureFrame() 在异步回调中访问了已释放的 Surface 对象

🧾 证据链
commit abc1234（重构截图异步逻辑） → 将 captureFrame() 从同步改为异步回调
→ 回调中未检查 Surface 有效性 → 快速滑动时 Surface 已释放 → crash

📍 涉及代码
• LiveScreenshotManager.java:142-168 - captureFrame() 异步回调
• SurfaceHelper.java:45-52 - Surface 释放逻辑

🔧 初步修复方向
在异步回调中增加 Surface 有效性检查

⚠️ 回归风险
低，修改范围局限在回调入口处
```

---

### Step 5：用户确认（迭代循环）

**无人驾驶模式判断**：读取 `state.基本信息.无人驾驶`，若为 `true`，展示分析结果后直接进入阶段 3，不询问用户。

**正常模式**：展示分析结果，等待用户确认。

**展示分析结果**：

```
🔍 根因分析结果


📌 疑似根因
{根因描述}

🧾 证据链
{commit → 变更 → 问题 → bug 表现}

📍 涉及代码
• {文件1}:{行号} - {说明}
• {文件2}:{行号} - {说明}

🔧 初步修复方向
{修复策略}

⚠️ 回归风险
{风险评估}
```




**AskUserQuestion**：

按 `prompts/analysis-prompts.md` 模板调用 AskUserQuestion：

| 选项 | 含义 | 后续动作 |
|------|------|----------|
| 根因分析正确，继续生成修复方案 | 用户认可根因和修复方向 | 退出循环，进入 Step 6 |
| 分析方向有偏差，我补充信息 | 用户认为分析方向有误 | 按场景 2.1 输出提示语，等待用户下一条消息 → 写入 `defect_context.md` `## 用户补充（第 N 轮）` → 回到 Step 1 |
| 根因不对，需要重新分析 | 用户认为根因完全错误 | 按场景 2.1 输出提示语 → 等待用户下一条消息 → 写入 `defect_context.md` → 回到 Step 1 |

**用户补充信息后**：

1. 按 `prompts/analysis-prompts.md` 场景 2.1 输出提示语（列出可提及的线索方向，但不强制格式），等待用户下一条消息
2. 收到用户回复后，按场景 2.1 的「写入格式」将原文 + 提炼要点追加到 `defect_context.md` 的 `## 用户补充（第 N 轮）` 章节（N = 当前分析轮次）
3. 基于补充信息，递增分析轮次计数器，重新执行 Step 1-4
4. 新一轮分析会利用补充信息优化搜索和分析

**迭代保护**：

- 维护分析轮次计数器（从 1 开始）
- 最多 5 轮分析循环
- 超过 5 轮后提示："已分析多轮，建议基于当前最佳分析继续，或手动提供更多信息"
- 提供选项：【基于当前分析继续】/【继续补充信息】/【终止分析】
- 选「继续补充信息」 → 复用场景 2.1 提示语，等待下一条用户消息后写入

**分析不出来怎么办**：

如果多轮分析后仍无法定位根因：
- 展示当前分析进展（已搜索的文件、已分析的 commit、当前假设）
- 提示："已分析 {N} 轮，未能明确根因，可能的原因：{列举可能性}"
- 提供选项：【基于当前最可能的原因继续】/【补充更多信息】/【终止分析】

---

### Step 6：写入 state.md

**用户确认根因后追加**：

```markdown
### 阶段2：根因分析
状态：✅ 完成
完成时间：<ISO时间>
执行模式：inline
执行耗时：<秒数>秒
根因：<确认的根因描述>
证据链：<commit hash → 变更 → 问题 → bug 表现>
涉及代码：<文件列表和行号>
修复方向：<初步修复策略>
分析轮次：<N>
日志窗口：<log_path 有效时填，如 "2026-05-19 14:15 ~ 14:45（扩窗 1 次，错误命中 ERROR×3）"；否则 "未启用">
日志命中点：<log_path 有效时填集合 L 摘要；否则 "未启用">
交叉命中：<Step 3.5 输出摘要，精确命中/文件级命中/无；log_path 无效则 "未启用">
问题记录：[]

## 待执行
下一阶段：3
```

**更新基本信息**：
- 当前阶段：2 → 3
- 更新时间：<ISO时间>

---

## 完成前验证

| # | 验证项 | 检查方式 | 不通过时修复动作 |
|---|--------|----------|------------------|
| 1 | `defect_context.md` 包含代码搜索结果 | `grep "代码搜索结果" <repo>/.acs-bug-fix/defect_context.md` | 重新执行 Step 1 |
| 2 | `defect_context.md` 包含 Commit 分析 | `grep "Commit 分析" <repo>/.acs-bug-fix/defect_context.md` | 重新执行 Step 2 |
| 3 | `defect_context.md` 包含根因分析 | `grep "根因分析" <repo>/.acs-bug-fix/defect_context.md` | 重新执行 Step 4 |
| 4 | `state.md` 包含阶段2 | `grep "阶段2" <repo>/.acs-bug-fix/state.md` | 重新写入 state.md |
| 5 | 根因被用户确认（无人驾驶跳过例外） | 检查交互记录 | 回到 Step 5 |
| 6 | log_path 有效时，`defect_context.md` 包含「日志预处理」与「日志 ∩ Commit 交叉分析」 | `grep "日志预处理\\|日志 ∩ Commit" <repo>/.acs-bug-fix/defect_context.md` | 重新执行 Step 0.5 / Step 3.5 |

---

## 返回摘要

```

✅ 阶段 2 完成（根因已确认）

🔍 根因
{根因描述}

🧾 证据链
{证据链摘要}

📍 涉及代码
{文件列表}

🔧 修复方向
{修复策略}

🔁 分析轮次：{N}

[NEXT: stage=3]
```


---

## 错误处理

| 错误 | 处理 |
|------|------|
| 仓库无 git 历史 | 警告，跳过 commit 分析，仅基于代码分析 |
| 代码搜索无结果 | 扩大搜索范围，使用更通用的关键词 |
| commit 分析无相关结果 | 警告，基于当前代码分析继续 |
| 多轮分析仍无根因 | 提示用户补充信息或基于最佳假设继续 |

---

## 重要约束

- **迭代是核心**：分析不是一次性的，用户可以反复补充信息重新分析
- **commit 是关键线索**：Step 2 不可跳过，bug 通常是最近改出来的
- **禁止跳过用户确认**：根因分析结果必须经用户确认才能进入阶段 3（`checking-skip: true` 无人驾驶模式除外）
- **证据链必须完整**：根因假设必须有 commit 证据或代码证据支撑，禁止凭空猜测
- **defect_context.md 持续更新**：每个 Step 的分析结果都追加到上下文文件，确保信息不丢失

---

## 调度器指令

> **本阶段执行完毕。输出上方返回摘要后，立即执行 `[NEXT: stage=3]`，进入阶段执行循环的下一轮。禁止停留等待用户输入。**
