---
name: bugfix-init
execution_mode: inline
action: 缺陷收集与分析
---

# 缺陷收集与分析（Bugfix 模式输入）

由 `stages/intent-router.md` 在用户选择「缺陷修复」后派发。本文件负责缺陷查询、收集仓库参数并初始化 state.md。

> 不直接做意图识别 -- 分流由 `intent-router.md` 完成。task_type 在 state.md 写入时显式设为 `bugfix`。

---

## 输入参数

| 参数 | 必填 | 说明 |
|------|------|------|
| repo_path | ❌ | 仓库绝对路径，未提供则交互询问 |
| branch_name | ❌ | 分支名，未提供则自动生成（前缀 `bot/fix/`） |
| log_path | ❌ | 本地日志文件/文件夹路径 |
| trigger_time | ❌ | bug 触发时间（任意格式文本） |
| test_yuque_url | ❌ | 测试用例文档地址 |
| autopilot | ❌ | 无人驾驶模式，默认 false |
| base_branch | ❌ | 代码审查基准分支，默认 master/main |

**快捷命令**：`.` 当前目录、`skip` 跳过可选项

---

## 步骤清单

> 开始执行前实例化，每步完成后标记 ✅，回到 PIPELINE_LOOP 前逐项确认。

- [ ] Step 1: 缺陷查询与选择
- [ ] Step 2: 收集仓库路径
- [ ] Step 3: 收集分支名
- [ ] Step 4: 收集可选参数（日志路径、触发时间、test_yuque_url、autopilot、base_branch）
- [ ] Step 5: 创建状态目录 + .gitignore
- [ ] Step 6: 写入缺陷上下文文件
- [ ] Step 7: 写入 state.md
- [ ] Step 8: Superpowers 安装检查

> **注意**：本阶段不再派发 Dave。Dave 已升级为 stage 1 的主 agent，由 tick 在 task_type=bugfix 时自动 dispatch（替代 Will）。stage 0 仅做缺陷信息收集，与 feature 模式的输入收集对称。

---

## 执行步骤

### Step 1: 缺陷查询与选择

#### 1a. 探测双源可用性

```bash
node <SKILL_ROOT>/lib/query-defects.js probe
```

输出 JSON `{ huoban: { available, reason }, dima: { available, reason } }`。

#### 1b. 查询缺陷列表

```bash
node <SKILL_ROOT>/lib/query-defects.js query --product wallet --page-size 20
```

输出统一 JSON 列表。

**单源失败处理**：
- huoban 失败 -> 警告，huoban 结果置空
- dima 失败 -> 警告，dima 结果置空
- 双源都失败或都为空 -> 跳到 1d（手动粘贴）

#### 1c. 文本列表展示 + 等待用户回复

将查询结果格式化为编号列表展示给用户：

```
查询到以下缺陷：

[伙伴]
1. H1234 - 支付页面加载白屏（P1/严重/待处理）
2. H1235 - 首页闪退问题（P2/一般/进行中）

[Dima]
3. WI-5678 - 登录超时异常（高/待处理）
4. WI-5679 - 列表滑动卡顿（中/进行中）

→ 输入编号选择缺陷，输入 m 手动粘贴，或直接粘贴缺陷描述；
```

输出后**结束本轮回复**，等待用户下一条消息：

| 用户输入 | 处理 |
|----------|------|
| 纯数字 N（1 ≤ N ≤ 列表长度） | 取对应缺陷 -> 调 `query-defects get <id> --source <source>` 拉详情 |
| 纯数字但越界 / 无意义消息 | 提示"输入无效"，重新等待 |
| `m` / `手动` / `粘贴` | 跳到 1d |
| 多行长文本 | 视为直接粘贴缺陷描述，按 1d 处理 |

**用户选编号后拉详情**：

```bash
node <SKILL_ROOT>/lib/query-defects.js get <id> --source <source>
```

从返回 JSON 拼装 `defect_description`（拼装格式见下方）。

#### 1d. 兜底降级 -- 手动粘贴

```
请粘贴缺陷描述（支持纯文本、错误日志、截图描述等任意格式）；
```

等待用户下一条消息：
```
defect_description = 用户原文
defect_id          = "未提供"
defect_source      = "manual"
defect_url         = "未提供"
```

#### 拼装格式（选编号后共用）

```
[来源] 伙伴 / Dima
[ID]   H1234 / WI-9876
[标题] 修复支付页面加载白屏
[状态] 待处理
[优先级] P1
[严重程度] 严重
[平台] iOS
[模块] 支付
[客户端版本] 10.5.0
[处理人] zhangsan
[创建时间] 2026-05-19 14:30:25
[链接] {defect_url}

[描述]
{原始描述全文}
```

字段缺失统一用 "未知" 占位。

#### 关键词提取（所有路径统一执行）

从最终 `defect_description` 提取搜索关键词：
- 类名/方法名（驼峰词）
- 模块名/功能名
- 错误信息关键片段
- 去除停用词

记录到 `defect_keywords`。

---

### Step 2: 收集仓库路径

```
if repo_path 已通过 args 传入：
  验证路径有效（test -d <path>/.git）
  有效 -> 使用
  无效 -> 报错并交互询问
else:
  输出: "📁 请输入目标仓库路径（或输入 . 使用当前目录）："
  接收用户输入 -> 验证 -> 使用
```

---

### Step 3: 收集分支名

```
if branch_name 已通过 args 传入：
  git checkout -b <branch_name> 或 git checkout <branch_name>
elif autopilot 为 true:
  从缺陷关键词自动生成（kebab-case，前缀 bot/fix/）
  git checkout -b <auto_branch>
else:
  输出: "🌿 请输入分支名（建议前缀 bot/fix/，输入 auto 自动生成）："
  接收输入 -> 创建分支
```

---

### Step 4: 收集可选参数

依次收集（已通过 args 传入的直接使用，`autopilot=true` 时跳过交互）：

**日志路径**：
```
if log_path 已传入:
  expand ~ -> test -e -> 有效则 realpath，无效则 "路径无效"
elif autopilot:
  log_path = "未提供"
else:
  输出: "📁 本地日志文件/文件夹路径（可选，回车跳过）："
  跳过 -> "未提供"
  填写 -> expand + test -e
```

**触发时间**：
```
if trigger_time 已传入:
  原样使用
elif autopilot:
  trigger_time = "未提供"
else:
  输出: "⏱ Bug 触发时间（可选，如 2026-05-19 14:30，回车跳过）："
  跳过 -> "未提供"
  填写 -> 原样使用
```

**其它参数**（test_yuque_url, autopilot, base_branch）：同 feature-init.md 逻辑收集。

---

### Step 5: 创建状态目录 + .gitignore

```bash
mkdir -p <repo_path>/.acs-junior-engineer
echo ".acs-junior-engineer/" >> <repo_path>/.gitignore
echo "openspec/" >> <repo_path>/.gitignore
```

---

### Step 6: 写入缺陷上下文文件

写入 `<repo_path>/.acs-junior-engineer/defect_context.md`：

```markdown
# 缺陷描述

{defect_description 原文}
```

---


### Step 7: 写入 state.md

**写入 state.md**（通过 `acs-junior state <repo> init`）：

```yaml
---
version: "1.0.0"
current_stage: 1
started_at: <ISO时间>
status: running
task_type: bugfix
defect_context: .acs-junior-engineer/defect_context.md
repo_path: <repo_path>
branch_name: <branch_name>
yuque_url:
test_yuque_url: <test_yuque_url 或空>
dmore_url:
base_branch: <base_branch>
autopilot: <autopilot>
superpowers_status: <superpowers_status>
defect_id: <defect_id>
defect_source: <defect_source>
defect_url: <defect_url>
defect_keywords: <defect_keywords>
log_path: <log_path>
trigger_time: <trigger_time>
stage_0_status: done
stage_0_duration: <秒数>
stage_1_status: pending
stage_2_status: pending
stage_3_status: pending
stage_4_status: pending
stage_5_status: pending
stage_6_status: pending
stage_7_status: pending
stage_8_status: pending
---
```

**关键字段说明**：
- `task_type: bugfix` -- 任务类型；tick 据此把 stage 1 的 agent 从 Will 路由到 Dave
- `defect_context` -- 缺陷上下文文件路径，stage 1 的 Dave 读取
- `yuque_url` -- 留空（task_type=bugfix 不需要语雀 URL）

> **stage 0 不写根因相关字段**：根因由 Dave 在 stage 1 产出，并整合到 enhanced-spec.md（含 complexity frontmatter）。stage 0 完成时这些产物还不存在。

---

### Step 8: Superpowers 安装检查

同 feature-init.md 的 Superpowers 安装检查逻辑。

---

## 完成前验证

| # | 验证项 | 检查方式 | 不通过时修复动作 |
|---|--------|----------|------------------|
| 1 | 仓库路径有效 | `test -d <repo_path>/.git` | 重新询问 |
| 2 | defect_context.md 已写入 | `test -f <repo>/.acs-junior-engineer/defect_context.md` | 重新写入 |
| 3 | state.md 已写入 | `test -f <repo>/.acs-junior-engineer/state.md` | 重新写入 |
| 4 | state.md frontmatter 合法 | `acs-junior validate <repo> --stage 0` | 补写缺失字段 |
| 5 | .gitignore 已配置 | `grep -q ".acs-junior-engineer/" <repo>/.gitignore` | 追加写入 |

---

## 调度器指令

> **本环节执行完毕后，state.md 已创建（current_stage=1, task_type=bugfix）。进入 PIPELINE_LOOP S1。**
> Stage 1 由 tick 自动 dispatch Dave（Detective）（替代 Will），Dave 完成根因分析并产出 enhanced-spec.md；其中含根因、证据链、影响代码、复杂度等系分内容，Stage 1 完成后 Alex 展示概要请用户确认根因；后续 Spec 锁定阶段（Alex）基于 enhanced-spec.md 生成 OpenSpec design.md 作为修复方案的最终设计载体。
