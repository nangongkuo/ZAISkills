---
name: cr-init
execution_mode: inline
action: 审查需求收集
---

# 审查需求收集（CR 模式输入）

由 `stages/intent-router.md` 在用户选择「代码审查」后派发。本文件负责收集审查目标（MR URL 或本地分支）、审查参数并初始化 state.md。

> 不直接做意图识别 -- 分流由 `intent-router.md` 完成。task_type 在 state.md 写入时显式设为 `cr`。

---

## 输入参数

| 参数 | 必填 | 说明 |
|------|------|------|
| mr_url | ❌ | AntCode MR 链接，提供则自动解析 repo/base/head |
| repo_path | ❌ | 仓库绝对路径（本地模式必须） |
| branch_name | ❌ | 待审查分支名（本地模式必须） |
| base_branch | ❌ | 基准分支，默认 master/main |
| cr_focus | ❌ | 审查重点：全面/安全/性能/架构，默认"全面" |
| auto_publish | ❌ | 是否自动发 MR 评论，默认 true（仅 mr_url 存在时有效） |
| autopilot | ❌ | 无人驾驶模式，默认 false |

**快捷命令**：`.` 当前目录、`skip` 跳过可选项

---

## 步骤清单

> 开始执行前实例化，每步完成后标记 ✅，回到 PIPELINE_LOOP 前逐项确认。

- [ ] Step 1: 输入模式选择与信息收集
- [ ] Step 2: 收集/确认仓库路径
- [ ] Step 3: 收集/确认分支信息
- [ ] Step 4: 收集可选参数（cr_focus、auto_publish、autopilot、base_branch）
- [ ] Step 5: 创建状态目录 + .gitignore
- [ ] Step 6: 写入审查上下文文件
- [ ] Step 7: 写入 state.md
- [ ] Step 8: Superpowers 安装检查

---

## 执行步骤

### Step 1: 输入模式选择与信息收集

#### 1a. 判断输入模式

```
if mr_url 已通过 args 传入:
  -> 走 MR URL 模式（1b）
elif repo_path 和 branch_name 已通过 args 传入:
  -> 走本地分支模式（1c）
elif autopilot 为 true:
  -> 报错: autopilot 模式下 mr_url 或 (repo_path + branch_name) 必须提供
else:
  输出询问（结束本轮回复，等待用户下一条消息）：
  ---
  请选择审查方式：

  1. 贴 MR 链接（自动解析仓库和分支）
  2. 指定本地分支（手动提供仓库路径和分支名）

  -> 输入 1 或 2，也可以直接粘贴 MR URL:
  ---
```

用户输入判定:

| 用户输入 | 处理 |
|----------|------|
| `1`、或包含 `code.alipay.com` / `code.ant` 的 URL | MR URL 模式（1b） |
| `2` | 本地分支模式（1c） |
| 其他 URL 格式 | 尝试作为 MR URL 解析，失败则提示重新输入 |

#### 1b. MR URL 模式

```bash
node <SKILL_ROOT>/lib/parse-mr-url.js parse "<mr_url>"
```

输出 JSON: `{ ok, host, group, repo, pr_id, project, ssh_url, pr_ref, base_branch, ref_exists }`

从返回结果提取:
```
mr_url         = 用户输入的原始 URL
mr_description = ""（MR 元信息由 Rex 在 stage 1 通过 fetch-diff 获取）
repo_path      = 需要在 Step 2 确认（本地存放报告的目录）
base_branch    = 返回的 base_branch（通常为 master）
branch_name    = pr_ref（如 refs/pull/1609/merge）
```

**解析失败处理**:
- `ref_exists: false` -> 提示"MR 不存在或已关闭"
- SSH 不通 -> 提示配置 SSH key（`ssh -T git@code.alipay.com`）
- URL 格式不认识 -> 降级到本地分支模式，提示用户

#### 1c. 本地分支模式

直接进入 Step 2 和 Step 3 收集 repo_path、branch_name、base_branch。
```
mr_url          = ""
mr_description  = ""
antcode_project = ""
antcode_pr_ref  = ""
```

---

### Step 2: 收集/确认仓库路径

```
if MR URL 模式且 repo_path 需要确认:
  # MR 模式下 repo_path 用于本地报告存放（如果用户本地有 clone）
  # 但 Rex 可以不需要本地仓库（远端直取 diff）
  输出: "📁 本地仓库路径（用于存放报告，输入 . 使用当前目录，输入 skip 使用当前目录）："
  接收输入 -> 验证
elif repo_path 已通过 args 传入:
  验证路径有效（test -d <path>/.git）
  有效 -> 使用
  无效 -> 报错并交互询问
else:
  输出: "📁 请输入目标仓库路径（或输入 . 使用当前目录）："
  接收用户输入 -> 验证 -> 使用
```

---

### Step 3: 收集/确认分支信息

```
if MR URL 模式:
  # base_branch 和 branch_name 已从 MR 元信息解析
  输出确认: "✅ 审查范围：{{base_branch}} -> {{branch_name}}"
elif branch_name 已通过 args 传入:
  使用传入值
else:
  输出: "🌿 请输入待审查的分支名："
  接收输入
```

base_branch 收集（仅本地模式且未通过 args 传入时）:
```
输出: "🌿 基准分支（默认 master，回车使用默认）："
跳过 -> 检测 master/main
填写 -> 使用
```

---

### Step 4: 收集可选参数

依次收集（已通过 args 传入的直接使用，`autopilot=true` 时使用默认值跳过交互）：

**审查重点（cr_focus）**:
```
if cr_focus 已传入:
  使用（验证值在【全面，安全，性能，架构，可维护性】中）
elif autopilot:
  cr_focus = "全面"
else:
  输出: "🔍 审查重点（默认全面，可选：安全/性能/架构/可维护性，回车使用默认）："
  跳过 -> "全面"
  填写 -> 使用
```

**自动发布（auto_publish）**:
```
if mr_url 为空:
  auto_publish = false（无 MR 无法发布）
elif auto_publish 已传入:
  使用
elif autopilot:
  auto_publish = true
else:
  输出: "📤 审查完成后自动发布评论到 MR？（默认 yes，输入 no 仅保存本地报告）："
  跳过/yes -> true
  no -> false
```

**其它参数**（autopilot、base_branch）：同 feature-init.md 逻辑收集。

---

### Step 5: 创建状态目录 + .gitignore

```bash
mkdir -p <repo_path>/.acs-junior-engineer
echo ".acs-junior-engineer/" >> <repo_path>/.gitignore
echo "openspec/" >> <repo_path>/.gitignore
```

---

### Step 6: 写入审查上下文文件

写入 `<repo_path>/.acs-junior-engineer/cr_context.md`：

```markdown
# 审查需求

## 审查目标

- MR URL: {{mr_url 或 "本地分支"}}
- 审查范围: {{base_branch}} -> {{branch_name}}
- MR 标题: {{mr_description 第一行，或 "无"}}

## 审查重点

{{cr_focus}}

## MR 描述

{{mr_description 全文，或 "无（本地分支模式）"}}

## 发布策略

- auto_publish: {{auto_publish}}
- antcode_project: {{antcode_project 或 "N/A"}}
- antcode_pr_ref: {{antcode_pr_ref 或 "N/A"}}
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
task_type: cr
cr_context: .acs-junior-engineer/cr_context.md
repo_path: <repo_path>
branch_name: <branch_name>
base_branch: <base_branch>
mr_url: <mr_url 或空>
mr_description: <mr_description 第一行 或空>
cr_focus: <cr_focus>
auto_publish: <auto_publish>
yuque_url:
test_yuque_url:
dmore_url:
autopilot: <autopilot>
superpowers_status: <superpowers_status>
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

**关键字段说明**:
- `task_type: cr` -- tick 据此把 stage 1 的 agent 从 Will 路由到 Rex
- `cr_context` -- 审查上下文文件路径，stage 1 的 Rex 读取
- `mr_url` -- 有值时 Rex 走远端 diff 模式 + 发评论；空值时走本地 diff 模式
- `yuque_url` / `test_yuque_url` / `dmore_url` -- 留空（task_type=cr 不需要）

---

### Step 8: Superpowers 安装检查

同 feature-init.md 的 Superpowers 安装检查逻辑。

---

## 完成前验证

| # | 验证项 | 检查方式 | 不通过时修复动作 |
|---|--------|----------|------------------|
| 1 | 仓库路径有效 | `test -d <repo_path>/.git` | 重新询问 |
| 2 | cr_context.md 已写入 | `test -f <repo>/.acs-junior-engineer/cr_context.md` | 重新写入 |
| 3 | state.md 已写入 | `test -f <repo>/.acs-junior-engineer/state.md` | 重新写入 |
| 4 | state.md frontmatter 合法 | `acs-junior validate <repo> --stage 0` | 补写缺失字段 |
| 5 | .gitignore 已配置 | `grep -q ".acs-junior-engineer/" <repo>/.gitignore` | 追加写入 |

---

## 调度器指令

> **本环节执行完毕后，state.md 已创建（current_stage=1, task_type=cr），进入 PIPELINE_LOOP S1。**
> Stage 1 由 tick 自动 dispatch Rex（Reviewer），Rex 一站式完成深度审查、报告生成、MR 评论发布。Stage 1 完成后 pipeline 自动 skip stage 2-8 并标记 status=completed。
