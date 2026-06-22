# 修复循环模板

当审查结论为“不通过”时，Alex（Lead）按此模板执行修复循环。

## 参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `{reviewer}` | 审查者名称 | Sean（Auditor） / Vera（Gatekeeper） / Tess（QA） |
| `{review_type}` | 审查类型 | 规格合规审查 / 代码审查 / 自动化测试 |
| `{fixer}` | 修复者 | James（Worker）（固定） |
| `{fail_state}` | 不通过标记 | ❌ 发现问题 / CHANGES_REQUESTED / ❌ 存在失败 |
| `{pass_state}` | 通过标记 | ✅ 规格合规 / APPROVED / ✅ 全部通过 |
| `{max_rounds}` | 最大轮次 | 3 |
| `{commit_mode}` | 修复提交模式 | `pre-commit` / `post-commit` |
| `{issue_summary}` | 问题摘要（从审查报告提取） | ... |
| `{impact_assessment}` | 影响评估结论文本 | ... |
| `{fix_message_body}` | 修复消息体（阶段填充，见 `config/stage-gates.md` 各阶段的「修复消息补充字段」） | ... |

## 修复提交模式

| 模式 | 适用场景 | James 修复后的行为 |
|------|----------|----------------------|
| `pre-commit` | Sean/Tess fix-loop（代码尚未首次提交） | 修改文件但**不提交**，直接标记修复完成 |
| `post-commit` | Vera fix-loop（代码已提交） | 修改文件后**必须提交**（新 commit） |

## 循环流程

### Step 1：影响判断与决策

```text
Alex（Lead）：{reviewer} {review_type}抓到 {N} 个问题：
- {issue_summary}
影响评估：{impact_assessment}
决策：让 {fixer} 在本轮修复（未超限）
```

### Step 2：通过 Agent 工具派发修复任务给 {fixer}

**执行方式**：必须调用 Agent 工具，`run_in_background: true`，prompt 包含以下内容：

```text
📤 Alex（Lead）：正在发送消息给 {fixer}
场景：你正在基于 {reviewer} 的 {review_type} 反馈修复问题
提交模式：{commit_mode}
{fix_message_body}
分支范围：变更基于 {base_branch}...{branch_name}
```

> `{base_branch}` 与 `{branch_name}` 必须替换为 state.md 中 `base_branch` / `branch_name` 字段的实际值（例：`master...feat_coding_test`），**不得保留字面量**。

**提交模式指令**：
- `pre-commit`：修复后**不提交**，仅确保编译通过即可
- `post-commit`：修复后**必须提交**代码（`git add -A && git commit`）

`{fix_message_body}` 由 `config/stage-gates.md` 中各阶段的「修复消息补充字段」定义，包含问题列表格式、约束条件、验证标准等阶段特有内容。

**禁止 Alex 在此处直接编辑代码文件。** 派发后 Alex 当前 turn 结束，等待 notification。

### Step 3：{fixer} 修复完成后，发送重新审查消息给 {reviewer}

```text
📤 Alex（Lead）：正在发送消息给 {reviewer}
场景：{fixer} 已修复你提出的问题，请重新审查
分支范围：{base_branch}...{branch_name}（包含最新修复）
原问题：{上一轮发现的问题列表，供对照}
要求：逐项确认修复是否到位，不得跳过
```

> 同上，`{base_branch}` 与 `{branch_name}` 替换为实际值。

### Step 4：循环判断

- `{reviewer}` 结论 = `{fail_state}` → 回到 Step 1
- `{reviewer}` 结论 = `{pass_state}` → 跳出循环

### Step 5：超限升级（>{max_rounds} 轮）

```text
Alex（Lead）：{reviewer} 第 {max_rounds} 轮审查仍未通过。
问题根因分析：{escalation_analysis}
决策：本轮超限，升级给协作人处理
说明：请人工介入判断处理方式
```

## 强制规则

- **Alex（Lead）禁止自行修复代码**：无论问题多简单（哪怕只是改一个变量名），Alex 都禁止使用 Edit/Write/Bash 工具修改仓库源代码。所有修复必须通过 Agent 工具派发给 `{fixer}` 执行。Alex 发现自己即将编辑源代码文件时，必须立即停止并改为派发 Agent。
- **修复必须通过 Agent 工具派发**：Step 2 中“发送修复消息给 `{fixer}`”的唯一合法方式是调用 Agent 工具（`run_in_background: true`），将修复指令作为 prompt 传入。禁止 Alex 在当前 session 中 inline 执行修复。
- **修复后重新审查不可跳过**：`{reviewer}` 必须确认修复确实解决了问题。
- 不得因“上一轮已经审过，修的是小问题”就跳过。
- 每次修复后都重新发送消息给 `{reviewer}`。
