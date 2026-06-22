# State Schema（state.md）

**路径**：`<repo_path>/.acs-junior-engineer/state.md`

本文档定义 state.md 的完整结构。state.md 分为两部分：

- **YAML frontmatter**（`---` 之间）：结构化元数据，供程序化校验和阶段路由。
- **Markdown body**（`---` 之后）：人类可读的执行日志，LLM append 写入。

# 完整示例

```markdown
---
version: "1.0.0"
current_stage: 3
started_at: "2026-05-14T10:00:00Z"
status: running
task_type: feature
defect_context:
repo_path: /path/to/repo
branch_name: feat-demo
yuque_url: https://yuque.antfin.com/xxx/xxx/xxx
test_yuque_url:
dmore_url:
base_branch: master
autopilot: false
superpowers_status: installed
stage_0_status: done
stage_0_duration: 60
stage_1_status: done
stage_1_duration: 180
stage_1_doc_url: https://yuque.antfin.com/xxx/xxx/xxx
stage_1_doc_title: "【系分】礼物托盘 SPM 埋点"
stage_1_doc_summary: "新增 SPM 埋点上报能力"
stage_1_enhanced_spec: .acs-junior-engineer/enhanced-spec.md
stage_2_status: done
stage_2_duration: 120
stage_2_proposal_id: gift-tray-spm-tracking
stage_2_proposal_path: openspec/changes/gift-tray-spm-tracking/proposal.md
stage_2_key_docs_proposal: openspec/changes/gift-tray-spm-tracking/proposal.md
stage_2_key_docs_spec: openspec/changes/gift-tray-spm-tracking/spec.md
stage_2_key_docs_design: openspec/changes/gift-tray-spm-tracking/design.md
stage_2_key_docs_tasks: openspec/changes/gift-tray-spm-tracking/tasks.md
stage_2_knowledge_paths: .acs-junior-engineer/knowledge-paths.json
stage_2_core_change: "礼物托盘新增 SPM 埋点"
stage_2_affected_files: "新增3个，修改2个"
stage_2_has_test_cases: true
stage_2_test_yuque_url: https://yuque.antfin.com/xxx/xxx/test
stage_2_brainstorm: executed
stage_3_status: in-progress
stage_3_task_summary: "完成5/5个任务"
stage_3_compile_passed: true
stage_3_changed_files: "新增 Model.swift, View.swift, ViewModel.swift；修改 Router.swift, Config.swift"
stage_4_status: pending
stage_4_conclusion:
stage_5_status: pending
stage_5_conclusion:
stage_6_status: pending
stage_7_status: pending
stage_7_conclusion:
stage_8_status: pending
---

## 阶段 1 - 系分增强

增强章节数：8，关联知识文档：3，引用代码文件：12
增强系分已保存：.acs-junior-engineer/enhanced-spec.md

## 阶段 2 - Spec 锁定

提案 ID：gift-tray-spm-tracking
核心变更：礼物托盘新增 SPM 埋点
涉及文件：新增3个，修改2个
关键文档：
proposal: openspec/changes/gift-tray-spm-tracking/proposal.md
spec: openspec/changes/gift-tray-spm-tracking/spec.md
design: openspec/changes/gift-tray-spm-tracking/design.md
tasks: openspec/changes/gift-tray-spm-tracking/tasks.md
Brainstorm：已执行
```

# frontmatter 字段定义

### 顶层字段

| Key | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `version` | string | yes | 固定 `"1.0.0"` |
| `current_stage` | number | yes | 当前阶段编号（0-8） |
| `started_at` | string | yes | 启动时间 |
| `status` | string | yes | `running` / `completed` / `blocked` |

## 基本信息

| Key | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `repo_path` | string | yes | 仓库路径 |
| `branch_name` | string | yes | 目标分支名 |
| `task_type` | string | yes | 任务类型：feature / bugfix |
| `defect_context` | string | bugfix 时 | 缺陷上下文路径（`.acs-junior-engineer/defect_context.md`） |
| `yuque_url` | string | feature 时 | 系分文档语雀 URL |
| `test_yuque_url` | string | no | 测试用例文档 URL，空表示未提供 |
| `dmore_url` | string | no | 设计稿 |
| `base_branch` | string | yes | 基准分支 |
| `autopilot` | boolean | yes | 无人驾驶模式，默认 false |
| `superpowers_status` | string | yes | `installed` / `already_installed` / `failed` / `not_checked` |
| `defect_id` | string | no | 缺陷 ID（bugfix 时填写） |
| `defect_source` | string | no | `dima` / `manual`（bugfix 时填写） |
| `defect_url` | string | no | 缺陷平台链接 |
| `defect_keywords` | string | no | 缺陷关键词 |
| `log_path` | string | no | 日志文件路径 |
| `trigger_time` | string | no | 问题触发时间 |

### 阶段通用字段

每个阶段 N（0-8）均有：

| Key 模式 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `stage_N_status` | string | yes | `pending` / `in-progress` / `done` / `skipped` / `blocked` |
| `stage_N_duration` | number | done 时 | 执行耗时（秒） |
| `stage_N_skip_reason` | string | skipped 时 | 跳过原因 |
| `stage_N_task_id` | string | no | Agent task id |
| `stage_N_watchdog_job` | string | no | 看门狗 job id |
| `stage_N_redispatch_count` | number | no | 看门狗探测到真死后的重派次数，默认 0，达上限 2 升级人工 |

### 阶段 1 输出字段（spec-enhance）

> feature 模式下 stage 1 默认跳过：`spec-enhance=false`（默认）时，`feature-init.md` 在 stage 0 中直接获取语雀文档并预填 stage_1 字段，`current_stage` 从 0 直接跳到 2，`stage_1_status: skipped`。仅 `spec-enhance=true` 时才由 Will agent 执行 stage 1。bugfix 模式的 Dave 不受影响，始终执行。

| Key | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `stage_1_doc_url` | string | yes | 系分文档 URL（bugfix 时为本地路径） |
| `stage_1_doc_title` | string | yes | 系分文档标题 |
| `stage_1_doc_summary` | string | yes | 系分文档摘要 |
| `stage_1_enhanced_spec` | string | yes | 增强系分本地路径 |
| `stage_1_complexity` | string | bugfix | `simple` / `medium` / `complex` |

### 阶段 2 输出字段（spec-confirm）

| Key | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `stage_2_proposal_id` | string | yes | 提案标识（change-name） |
| `stage_2_proposal_path` | string | yes | 提案文件路径 |
| `stage_2_key_docs_proposal` | string | yes | proposal.md 路径 |
| `stage_2_key_docs_spec` | string | yes | spec.md 路径 |
| `stage_2_key_docs_design` | string | yes | design.md 路径 |
| `stage_2_key_docs_tasks` | string | yes | tasks.md 路径 |
| `stage_2_knowledge_paths` | string | yes | knowledge-paths.json 路径 |
| `stage_2_core_change` | string | yes | 一句话核心变更摘要 |
| `stage_2_affected_files` | string | yes | 如“新增3个，修改2个” |
| `stage_2_has_test_cases` | boolean | yes | 是否有测试用例文档 |
| `stage_2_test_yuque_url` | string | no | 测试用例文档 URL |
| `stage_2_brainstorm` | string | yes | `executed` / `skipped` |

### 阶段 3 输出字段（build）

| Key | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `stage_3_task_summary` | string | yes | 任务完成摘要 |
| `stage_3_compile_passed` | boolean | yes | 编译是否通过 |
| `stage_3_changed_files` | string | yes | 变更文件清单（供 Sean 审查使用） |
| `stage_3_compile_status` | string | no | `passed` / `failed_unrelated` / `failed_loop` |
| `stage_3_compile_attempts` | number | no | 编译失败累计次数 |

### 阶段 4 输出字段（spec-review）

| Key | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `stage_4_conclusion` | string | yes | `pass` / `fail` |
| `stage_4_missing` | number | no | 遗漏数 |
| `stage_4_extra` | number | no | 多余数 |
| `stage_4_misunderstood` | number | no | 误解数 |

### 阶段 5 输出字段（test）

| Key | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `stage_5_conclusion` | string | yes | `pass` / `fail` |
| `stage_5_report_path` | string | yes | 测试报告路径 |
| `stage_5_total` | number | yes | 用例总数 |
| `stage_5_passed` | number | yes | 通过数 |
| `stage_5_failed` | number | yes | 失败数 |
| `stage_5_failed_cases` | string | no | 失败用例摘要 |

### 阶段 6 输出字段（commit）

| Key | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `stage_6_commit_sha` | string | yes | 提交的 commit SHA |

### 阶段 7 输出字段（code-review）

| Key | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `stage_7_conclusion` | string | yes | `approved` / `changes_requested` |
| `stage_7_report_path` | string | yes | CR 报告路径 |
| `stage_7_p0` | number | no | P0 风险数 |
| `stage_7_p1` | number | no | P1 风险数 |
| `stage_7_p2` | number | no | P2 风险数 |
| `stage_7_p3` | number | no | P3 风险数 |

### 阶段 8 输出字段（submit）

| Key | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `stage_8_push_status` | string | yes | `success` / `failed` |
| `stage_8_pr_url` | string | no | PR 链接 |
| `stage_8_sprint_id` | string | yes | 迭代 ID / 跳过 / 未触发 |

# 中英字段映射

| 用户面字段 | frontmatter key |
| --- | --- |
| state.基本信息.仓库路径 | `repo_path` |
| state.基本信息.分支名 | `branch_name` |
| state.基本信息.任务类型 | `task_type` |
| state.基本信息.缺陷上下文 | `defect_context` |
| state.基本信息.系分URL | `yuque_url` |
| state.基本信息.分支基准 | `base_branch` |
| state.基本信息.运行模式 | `autopilot` |
| state.基本信息.缺陷ID | `defect_id` |
| state.基本信息.缺陷来源 | `defect_source` |
| state.基本信息.缺陷关键词 | `defect_keywords` |
| state.基本信息.日志路径 | `log_path` |
| state.阶段.1系分文档地址 | `stage_1_doc_url` |
| state.阶段.1系分文档摘要 | `stage_1_doc_summary` |
| state.阶段.1增强系分内容 | `stage_1_enhanced_spec` |
| state.阶段.1复杂度 | `stage_1_complexity` |
| state.阶段.2关键文档.proposal | `stage_2_key_docs_proposal` |
| state.阶段.2关键文档.spec | `stage_2_key_docs_spec` |
| state.阶段.2关键文档.design | `stage_2_key_docs_design` |
| state.阶段.2关键文档.tasks | `stage_2_key_docs_tasks` |
| state.阶段.2知识路径 | `stage_2_knowledge_paths` |
| state.阶段.2核心变更 | `stage_2_core_change` |
| state.阶段.2涉及文件 | `stage_2_affected_files` |
| state.阶段.2测试用例文档URL | `stage_2_test_yuque_url` |
| state.阶段.3任务摘要 | `stage_3_task_summary` |
| state.阶段.3变更文件 | `stage_3_changed_files` |

# 状态转换规则

允许转换：

```text
pending -> in-progress -> done
pending -> skipped
in-progress -> blocked
```

`skipped` 仅 conditional 阶段使用。不允许反向转换。

# 读写规范

## 读取

```text
Read <repo_path>/.acs-junior-engineer/state.md
```

LLM 从 frontmatter 中读取所需字段值，从 body 中读取阶段详情。

## 更新 frontmatter

**状态机字段**（`stage_N_status` / `current_stage` / `status`）由 `tick/advance` 自动管理，禁止 LLM 用 update-state 直接改。

**其他字段**（阶段输出、内部 flag、计数器等）使用 `lib/update-state.js`：

```bash
# 阶段输出字段
acs-junior state <repo_path> set stage_3_compile_status=passed stage_3_compile_attempts=2

# 多个字段可一次写入
acs-junior state <repo_path> set sync_status=running task_id=abc123
```

**阶段流转**（done / skipped）通过 advance：

```bash
# 完成阶段：写状态机字段 + 全部 outputs + 推进 current_stage + append 摘要
acs-junior advance <repo_path> --stage 3 --duration 300 \
  --outputs "stage_3_task_summary=5/5,stage_3_compile_passed=true,stage_3_changed_files=A.kt B.kt" \
  --summary "## James - 编码实现\n\n任务完成：5/5，编译通过"

# 条件跳过
acs-junior advance <repo_path> --stage 5 --skip --skip-reason "未提供测试用例文档URL"
```

支持的值类型（update-state 自动推断）：

- String：`key=hello` 或含空格/特殊字符时自动加引号 `key=hello world`
- number：`key=300`
- boolean：`key=true` / `key=false`
- null：`key=` 或 `key=null`

新字段自动插入到对应 `stage_N` 分组末尾。

### Append body

```bash
acs-junior state <repo_path> append "## 标题\n\n内容"
```

支持 `\n` 转义为换行。自动在现有内容后添加空行分隔。

### 初始化（阶段 0 完成时）

从 stdin 写入完整 state.md：

```bash
cat << 'EOF' | acs-junior state <repo_path> init
---
version: "1.0.0"
# 全部 frontmatter
---
EOF
```

初始化时 body 为空，各阶段完成后通过 `append` 追加阶段摘要。





















## 校验

```bash
acs-junior validate <repo_path> [--stage N]
```
