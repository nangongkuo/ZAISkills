---
name: trans-init
execution_mode: inline
action: 转码参数收集
---

# 转码参数收集（Trans 模式输入）

由 `stages/intent-router.md` 在用户选择「代码转录」后派发。本文档负责收集 trans 模式专属参数并初始化 state.md。

> 不直接做意图识别--分流由 `intent-router.md` 完成。task_type 在 state.md 写入时显式设为 `trans`。

---

## 输入参数

| 参数 | 必填 | 说明 |
|------|------|------|
| platform | ✅ | 目标平台：`ios` / `android` / `harmony` |
| repo_path | ✅ | 目标工程绝对路径（iOS=HomeCard / Android=homefeeds / Harmony=hometab） |
| template_name | ✅ | 新 native 模板名 |
| cube_source | ✅ | Cube 模板源码路径或 Git URL |
| template_id | ❌ | 模板 ID，缺省时与 template_name 一致 |
| base_branch | ❌ | 代码库基准分支，默认 master |
| autopilot | ❌ | 无人驾驶模式，默认 false |

**快捷命令**：`.` 当前目录、`skip` 跳过可选项

---

## 步骤清单

> 开始执行前实例化，每步完成后标记 ✅，回到 PIPELINE_LOOP 前逐项确认。

- [ ] Step 1: 选择目标平台（AskUserQuestion 单选）
- [ ] Step 2: 收集目标工程路径
- [ ] Step 3: 收集新模板名
- [ ] Step 4: 收集 Cube 模板源
- [ ] Step 5: 收集可选参数（template_id / base_branch / autopilot）
- [ ] Step 6: 自动生成 branch_name（不执行 git checkout）
- [ ] Step 7: 创建状态目录 + .gitignore
- [ ] Step 8: 写入 state.md
- [ ] Step 9: Superpowers 安装检查

---

## 执行步骤

### Step 1: 选择目标平台

```
AskUserQuestion:
  question: "目标平台是哪一个？"
  header: "平台"
  options:
    - label: "iOS (HomeCard)"
      description: "iOS 客户端，目标工程通常为 HomeCard"
    - label: "Android (homefeeds)"
      description: "Android 客户端，目标工程通常为 homefeeds"
    - label: "HarmonyOS (hometab)"
      description: "HarmonyOS 客户端，目标工程通常为 hometab"
```

用户选定 -> 映射为 `platform` 值：`ios` / `android` / `harmony`。

### Step 2: 收集目标工程路径

```
if repo_path 已通过 args 传入:
  验证路径有效 (test -d <path>/.git)
  有效 -> 使用
  无效 -> 报错并交互询问
else:
  输出: "📁 请输入目标工程绝对路径："
  接收 -> test -d <path>/.git -> 有效则使用
```

### Step 3: 收集新模板名

```
if template_name 已传入:
  直接使用
else:
  输出: "🧩 新 native 模板叫什么名字？"
  接收 -> template_name
```

### Step 4: 收集 Cube 模板源

```
if cube_source 已传入:
  直接使用
else:
  输出: "📦 Cube 模板源码路径或 Git URL："
  接收 -> cube_source（可能是本地路径或 git@/https:// 开头的 Git URL，由 add-native-template 内部识别处理）
```

### Step 5: 收集可选参数

依次收集（已通过 args 传入的直接使用，`autopilot=true` 时跳过交互）：

**template_id**:
```
if template_id 已传入:
  原样使用
elif autopilot:
  template_id = template_name
else:
  输出: "🆔 模板 ID（可选，回车默认与模板名一致）："
  跳过 -> template_id = template_name
  填写 -> 使用填写值
```

**base_branch**:
```
if base_branch 已传入: 使用
elif autopilot: base_branch = "master"
else:
  输出: "🌿 基准分支（可选，回车默认 master）："
  跳过 -> "master"
```

**autopilot**: 已通过 args 传入则使用，否则默认 false。

### Step 6: 自动生成 branch_name

直接拼接 `bot/transcode/<platform>/<template_name>` 作为 `branch_name` 占位写入 state.md。

> **重要**：**不**在本阶段执行 `git checkout -b`。实际分支创建由 add-native-template 在 stage 1 内部完成（其 SKILL.md 已固化此命名约定）。

### Step 7: 创建状态目录 + .gitignore

```bash
mkdir -p <repo_path>/.acs-junior-engineer
echo ".acs-junior-engineer/" >> <repo_path>/.gitignore
```

### Step 8: 写入 state.md

通过 `acs-junior state <repo_path> init`，从 stdin 写入完整 frontmatter:

```yaml
---
version: "1.0.0"
current_stage: 1
started_at: <ISO时间>
status: running
task_type: trans
repo_path: <repo_path>
branch_name: bot/transcode/<platform>/<template_name>
base_branch: <base_branch>
autopilot: <autopilot>
superpowers_status: <Step 9 写入>
platform: <ios|android|harmony>
cube_source: <path or git url>
template_name: <name>
template_id: <id 或 与 template_name 一致>
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
- `task_type: trans` - 任务类型；tick 据此把 stage 1 路由到 `agents/echo.md`，并在 stage 2-8 触发 `skip-conditional`
- `branch_name` - 占位值，实际分支由 add-native-template 在 stage 1 内部创建
- `platform / cube_source / template_name` - Echo agent 在 stage 1 通过 `{{var}}` 注入到 prompt

### Step 9: Superpowers 安装检查

同 feature-init.md 的 Superpowers 安装检查逻辑，trans 流程不直接使用 Brainstorm（`spec_confirm_brainstorm_when: never`），所以即使 Superpowers 失败也不影响主流程。

---

## 完成前验证

| # | 验证项 | 检查方式 | 不通过时修复动作 |
|---|--------|----------|------------------|
| 1 | 仓库路径有效 | `test -d <repo_path>/.git` | 重新询问用户 |
| 2 | state.md 已写入 | `test -f <repo_path>/.acs-junior-engineer/state.md` | 重新执行 Step 8 |
| 3 | state.md frontmatter 合法 | `acs-junior validate <repo_path> --stage 0` exit 0 | 补写缺失字段 |
| 4 | .gitignore 已配置 | `grep -q ".acs-junior-engineer/" <repo_path>/.gitignore` | 追加写入 |
| 5 | task_type 字段为 trans | `grep "task_type: trans" state.md` | 修正 state.md |
| 6 | platform / cube_source / template_name 均非空 | `grep` 各字段 | 重新收集 |

---

## 调度器指令

> **本环节执行完毕后，state.md 已创建（`current_stage=1, task_type=trans`），回到 intent-router 完成前验证，然后进入 PIPELINE_LOOP S1。**
> Stage 1 由 tick 自动 dispatch Echo (Mirror)，Echo 通过 Skill 工具调用 `add-native-template` 完成转码全流程（含分支创建、代码生成、注册接入、commit、按场景 push）。Stage 1 完成后，tick 在 stage 2-8 各阶段返回，`skip-conditional`，Alex 调 `advance --skip` 推进直到 `status=completed`。
