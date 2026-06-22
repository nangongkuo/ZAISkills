---
name: feature-init
execution_mode: inline
action: 需求收集
---

# 需求收集（Feature 模式输入）

由 `stages/intent-router.md` 在用户选择「需求开发」后派发，本文件负责收集 feature 模式专属参数并初始化 state.md。

> 不直接做意图识别 -- 分流由 `intent-router.md` 完成。task_type 在 state.md 写入时显式设为 `feature`。

---

## 输入参数

| 参数 | 必填 | 说明 |
|------|------|------|
| repo_path | ❌ | 仓库绝对路径，未提供则交互询问 |
| yuque_url | ❌ | 系分文档地址（请优先提供），未提供则交互询问 |
| branch_name | ❌ | 分支名，未提供则交互询问或自动生成 |
| test_yuque_url | ❌ | 测试用例文档地址，未提供则跳过自动测试 |
| dmore_url | ❌ | 设计稿地址，未提供则跳过 |
| autopilot | ❌ | 无人驾驶模式，默认 false。设为 true 时跳过所有用户确认 |
| base_branch | ❌ | 代码审查基准分支，默认 master/main |
| spec_enhance | ❌ | 是否需要系分增强（Will 注入仓库上下文），默认 false，设为 true 时走 Will agent |

**快捷命令**：`.` 当前目录、`?` 帮助、`exit` 退出

---

## 步骤清单

> 开始执行前实例化。每步完成后标记 ✅。

- [ ] Step 1: 参数收集（repo_path / yuque_url / branch_name / test_yuque_url / dmore_url / autopilot / base_branch / spec_enhance）
- [ ] Step 2: 直接获取系分文档（仅 spec_enhance=false 时执行）
- [ ] Step 3: 验证仓库路径存在且为 git 仓库
- [ ] Step 4: 创建状态目录并配置 .gitignore
- [ ] Step 5: 写入 state.md（YAML frontmatter 含全部字段，body 为空）
- [ ] Step 6: Superpowers 安装检查与状态记录

---

## 执行步骤

### Step 1: 参数收集

依次收集：

- **仓库路径**: `if repo_path 已传入: 验证 test -d <path>/.git; else: 询问用户`
- **语雀系分 URL**: `if yuque_url 已传入: yuque resolve "<url>" --json 验证; else: 询问用户`
- **分支名**: `if branch_name 已传入: git checkout -b <name>; elif autopilot: 自动生成 feat/coding-pipeline-{timestamp}; else: 询问用户`
- **可选参数**: 测试用例 URL / 设计稿地址 / autopilot / base_branch，按 args 传入或交互收集（`autopilot=true` 时跳过交互）
- **系分增强选项**: `if spec_enhance 已传入: 使用传入值; elif autopilot: spec_enhance=false; else: AskUserQuestion 询问用户`

**系分增强交互**（非 autopilot 模式下，spec_enhance 未传入时）：

使用 AskUserQuestion，选项：
- **跳过，直接进入方案设计（推荐）** -- 直接使用系分文档原文，省去 3-5 分钟增强耗时
- **开启系分增强（Will 注入仓库上下文）** -- Will 会阅读仓库代码，将代码上下文注入到系分文档中

默认选项为"跳过"。

---

### Step 2: 直接获取系分文档（仅 spec_enhance=false 时执行）

> 当用户选择跳过系分增强时，feature-init 自行完成最小必要工作：获取语雀文档内容，写 enhanced-spec.md，预填 stage_1_* 字段。这样 Stage 2 无需感知 Will 是否执行过。

**spec_enhance=true 时**：跳过本步骤，由 Will（stage 1 agent）完成。

**执行逻辑**：

```bash
# 1. 获取文档元信息
yuque resolve "<yuque_url>" --json
# 解析 title 字段 -> DOC_TITLE

# 2. 获取文档正文
yuque cat "<yuque_url>"
# 输出写入 <repo_path>/.acs-junior-engineer/enhanced-spec.md
```

**产出记录**（供 Step 5 写入 state.md）：
- `DOC_URL` = `<yuque_url>`
- `DOC_TITLE` = yuque resolve 返回的 title
- `DOC_SUMMARY` = enhanced-spec.md 前 200 字（截取首段或摘要段落）
- `ENHANCED_SPEC_PATH` = `.acs-junior-engineer/enhanced-spec.md`

**错误处理**：
- `yuque resolve` 失败 -> 回到 Step 1 重新询问 yuque_url
- `yuque cat` 失败 -> 重试一次；仍失败则报错终止

### Step 3: 仓库路径验证

```bash
test -d "<repo_path>/.git" || (echo "ERROR: not a git repo"; exit 1)
```

不通过 -> 回到 Step 1 重新询问。

### Step 4: 创建状态目录 + .gitignore

```bash
mkdir -p <repo_path>/.acs-junior-engineer
echo ".acs-junior-engineer/" >> <repo_path>/.gitignore
echo "openspec/" >> <repo_path>/.gitignore
```

### Step 5: 写入 state.md

通过 `acs-junior state <repo_path> init`，从 stdin 写入完整 frontmatter。

**根据 spec_enhance 分支**：

#### spec_enhance=false（默认）-- 跳过 Will，直接进入 Stage 2

```yaml
---
version: "1.0.0"
current_stage: 2
started_at: <ISO 时间>
status: running
task_type: feature
repo_path: <repo_path>
branch_name: <branch_name>
yuque_url: <yuque_url>
test_yuque_url: <test_yuque_url 或空>
dmore_url: <dmore_url 或空>
base_branch: <base_branch>
autopilot: <autopilot>
spec_enhance: false
superpowers_status: <Step 8 写入>
stage_0_status: done
stage_0_duration: <秒数>
stage_1_status: skipped
stage_1_skip_reason: "用户选择跳过系分增强"
stage_1_doc_url: <DOC_URL>
stage_1_doc_title: <DOC_TITLE>
stage_1_doc_summary: <DOC_SUMMARY>
stage_1_enhanced_spec: <ENHANCED_SPEC_PATH>
stage_2_status: pending
stage_3_status: pending
stage_4_status: pending
stage_5_status: pending
stage_6_status: pending
stage_7_status: pending
stage_8_status: pending
---
```

> 关键差异：`current_stage: 2`，`stage_1_status: skipped`，stage_1_* 输出字段已预填，tick 读到 `current_stage: 2` 时直接处理 Stage 2，无感知 Stage 1 跳过。

#### spec_enhance=true -- 走 Will agent

```yaml
---
version: "1.0.0"
current_stage: 1
started_at: <ISO 时间>
status: running
task_type: feature
repo_path: <repo_path>
branch_name: <branch_name>
yuque_url: <yuque_url>
test_yuque_url: <test_yuque_url 或空>
dmore_url: <dmore_url 或空>
base_branch: <base_branch>
autopilot: <autopilot>
spec_enhance: true
superpowers_status: <Step 8 写入>
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
- `task_type: feature` -- 任务类型；`spec_enhance=true` 时 tick 据此把 stage 1 路由到 `agents/will.md`（由 `abilities/feature.md` 声明）
- `spec_enhance: false`（默认）-- Stage 1 被跳过，`current_stage` 直接为 2，stage_1_* 输出由 Step 2 预填
- `spec_enhance: true` -- Stage 1 正常执行，`current_stage` 为 1，等待 tick 派发 Will

### Step 6: Superpowers 安装检查与状态记录

```
尝试调用 Skill(skill: "superpowers:brainstorming")
  ├─ 可用 -> SUPERPOWERS_STATUS = "already_installed"
  └─ 不可用 -> 执行安装:
      /plugin install superpowers@claude-plugins-official
      安装成功 -> SUPERPOWERS_STATUS = "installed"
      安装失败 -> SUPERPOWERS_STATUS = "failed"，警告但不终止
```

**安装失败处理**：警告，继续执行（Spec 锁定中 Brainstorm 步骤将跳过）

---

## 验证规则

- `repo_path` 存在且包含 `.git` -> 否则报错并重新询问
- `yuque_url` 可解析（`yuque resolve "<yuque_url>" --json` exit 0） -> 否则报错并重新询问
- `branch_name` 可用 -> 否则自动生成 `feat/coding-pipeline-{timestamp}`

---

## 完成前验证

> 步骤清单全部 ✅ 后，逐项执行以下验证，全部通过才可进入 PIPELINE_LOOP。

| # | 验证项 | 检查方式 | 不通过时修复动作 |
|---|--------|----------|------------------|
| 1 | 仓库路径有效 | `test -d <repo_path>/.git` | 重新询问 |
| 2 | state.md 已写入 | `test -f <repo_path>/.acs-junior-engineer/state.md` | 重新执行 Step 5 |
| 3 | state.md frontmatter 合法 | `acs-junior validate <repo_path> --stage 0` exit 0 | 补写缺失字段 |
| 4 | .gitignore 已配置 | `grep -q ".acs-junior-engineer/" <repo_path>/.gitignore` | 追加写入 |
| 5 | task_type 字段为 feature | `grep -q "task_type: feature" state.md` | 修正 state.md |
| 6 | Superpowers 状态已记录 | frontmatter 中 `superpowers_status` 非空 | 补写为 `not_checked` |
| 7 | spec_enhance=false 时 enhanced-spec.md 存在 | `spec_enhance=false && test -f <repo_path>/.acs-junior-engineer/enhanced-spec.md` | 重新执行 Step 2 |
| 8 | spec_enhance=false 时 stage_1_* 已预填 | frontmatter 中 `stage_1_doc_url` / `stage_1_enhanced_spec` 非空 | 重新执行 Step 2 + Step 5 |

---

## 调度器指令

> **本环节执行完毕后，state.md 已创建，spec_enhance=false 时 `current_stage=2, stage_1_status=skipped`（直接进入 Spec 锁定）；spec_enhance=true 时 `current_stage=1, task_type=feature`（等待 Will 派发），回到 intent-router 完成前验证，然后进入 PIPELINE_LOOP S1。**
