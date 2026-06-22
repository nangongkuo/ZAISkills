# Pipeline 阶段配置

| 阶段 | 名称 | execution.mode | skill_file | conditional | next_stage | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | intent-router | inline | `stages/intent-router.md` | false | 1 | 意图分流入口，列 ability，AskUserQuestion 后派发到 ability init 文件 |
| 1 | spec-enhance | agent | ability 路由 | false | 2 | 系分增强 / 缺陷根因 / CR 审查 / 转码 |
| 2 | spec-confirm | inline | `stages/spec-confirm.md` | false | 3 | Spec/Brainstorm + 用户确认 |
| 3 | build | agent | `agents/james.md` | false | 4 | 编码编译（不提交，提交在阶段 6） |
| 4 | spec-review | agent | `agents/sean.md` | false | 5 | Spec 合规审查 |
| 5 | test | agent | `agents/tess.md` | `test_yuque_url` 非空 | 6 | 自动化测试 |
| 6 | commit | inline | `stages/commit.md` | false | 7 | 提交代码（Sean/Tess 通过后） |
| 7 | code-review | agent | `agents/vera.md` | false | 8 | 代码审查（审查已提交代码） |
| 8 | submit | inline | `stages/submit.md` | false | COMPLETE | Push、PR、关联迭代 |

## skill_file 与 model 说明

每个 agent 文件 frontmatter 声明：

- `model`：目标模型
- `inputs`：所需输入字段

读取 frontmatter 获取 model 和 inputs，调用 Agent 工具时传入 model 参数。若因模型不可用报错（如“模型不存在”），则省略 `model` 参数重试一次，Agent 将继承当前 session 的模型。

### stage 0 ability 派发

stage 0 表格里的 `stages/intent-router.md` 是固定入口，**不按 task_type 路由**。路由发生在 intent-router 内部：

- intent-router 调 `node lib/abilities.js list` 列出全部 ability。
- AskUserQuestion 让用户选择意图。
- 调 `node lib/abilities.js resolve-init <id>` 拿到对应 init 文件路径。
- Read 该 init 文件 inline 执行，由 init 文件负责写 state.md（含 `task_type=<id>` 和 ability 专属字段）。

### stage 1 ability 路由

- `tick.js` 在 dispatch 前调 `abilities.resolveSpecEnhanceAgent(task_type)` 覆盖 `stage.skill_file`。
- `junior-core.js renderAgentPrompt` 同步路由，保证渲染目标与 dispatch 一致。
- 实际 agent 的 `model` / `inputs` 以 agent 文件 frontmatter 为准（feature -> `will.md` sonnet；bugfix -> `dave.md` opus）。

# 条件执行说明

### 阶段 5（test）条件

条件字段：state.md frontmatter 的 `test_yuque_url`。

- 条件满足（非空）：执行 automation testing。
- 条件不满足（空）：tick 返回 `action: skip-conditional`，调 advance 跳过：

```bash
acs-junior advance <repo> --stage 5 --skip --skip-reason "未提供测试用例文档URL"
```

### ability 级 skip_stages

各 ability 可在 `abilities/<id>.md` 的 frontmatter 中声明 `skip_stages: [N,N,...]`。tick 会在进入这些 stage 时返回 `action: skip-conditional`，调度器调 `advance --skip` 推进。

适用场景：ability 的 stage 1 已完成全部工作（如 trans 在 stage 1 通过 `add-native-template` 内部已完成代码生成、commit、按场景 push），无需后续 Spec 锁定/编码/审查门禁。

当前使用此机制的 ability：

| ability | skip_stages | 说明 |
| --- | --- | --- |
| trans | 2,3,4,5,6,7 | Echo 在 stage 1 内完成转码、提交和可选 push |
| cr | 2,3,4,5,6,7,8 | Rex 在 stage 1 内完成代码审查 |

**关键：流水不再询问用户 [Y/n]**。一条流水从 intent-router 完成后会自动启动 Will/Dave -> Spec 锁定 -> James -> Sean -> Tess -> Alex 提交 -> Vera -> submit，中途异常由 fix-loop / BLOCKED 兜底。

用户确认仅保留在阶段内部的关键节点：

- **spec 锁定（stage 2）**：两次用户确认（提案意图、Design & Tasks）+ Brainstorm 深化追问。
- **submit（stage 8）**：进入阶段时一次入口确认 + Step 2 PR 创建询问。

`autopilot: true` 仅影响阶段内部的确认环节（跳过 spec-confirm 的两次确认和 brainstorm 追问、submit 入口确认）；阶段流转不受 autopilot 控制。

## 输入字段（从 state.md frontmatter 读取）

| 名称 | frontmatter key | 类型 |
| --- | --- | --- |
| 仓库路径 | `repo_path` | string |
| 分支名 | `branch_name` | string |
| 系分文档地址 | `yuque_url` | string |
| 增强系分内容 | `stage_1_enhanced_spec` | string |
| 测试用例文档 URL | `test_yuque_url` | string |
| 无人驾驶 | `autopilot` | boolean |
| Superpower 状态 | `superpowers_status` | string |

## 输出字段（写入 state.md frontmatter）

| 阶段 | 字段 | 类型 |
| --- | --- | --- |
| 2 | `stage_2_proposal_id` | string |
| 2 | `stage_2_key_docs_proposal` | string |
| 2 | `stage_2_key_docs_spec` | string |
| 2 | `stage_2_key_docs_design` | string |
| 2 | `stage_2_key_docs_tasks` | string |
| 2 | `stage_2_knowledge_paths` | string |
| 2 | `stage_2_core_change` | string |
| 2 | `stage_2_has_test_cases` | boolean |
| 2 | `stage_2_brainstorm` | string |

## 阶段 3/4/5/7 输入字段

阶段 3（James）、4（Sean）、5（Tess）、7（Vera）的输入字段以各自 agent 文件 frontmatter `inputs` 为准。Alex 按 agent 执行规则从 frontmatter 提取变量名，从 state.md 读取对应值。阶段 8（submit）为 inline state.md frontmatter 读取所需字段。












## 断点恢复优先级

阶段断点恢复时，按以下优先级检查前置条件：

| 断点阶段 | 前置条件检查 |
| --- | --- |
| 1 | `repo_path` 有效 |
| 2 | `stage_1_enhanced_spec` 非空（本地文件存在） |
| 3 | `stage_2_status: done`，关键文档存在 |
| 4 | `stage_3_status: done` 且 `stage_3_compile_passed: true` |
| 5 | `stage_4_status: done`，spec-review 通过 |
| 6 | `stage_5_status: done` 或 skipped |
| 7 | `stage_6_status: done`，代码已提交 |
