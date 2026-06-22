# 阶段门禁与调度细则
> 本文件是各 agent/inline 阶段「完成前验证 + 结论处理 + fix-loop 实参 + 质量门禁打回话术」的**单一事实源**，由 Alex（Lead，主循环）在 `process-agent-result(DONE)` / inline 收尾时消费。
> 路由配置见 `config/pipeline-config.md`；循环协议见 `config/loop-protocol.md`；修复循环模板见 `config/fix-loop.md`。
用户面命名见 `config/user-facing-names.md`（本文件中的「角色 + 业务动作」均以该字典为准）。
## fix-loop 阶段参数对照表
Sean / Tess / Vera 三个审查阶段共用 `config/fix-loop.md` 模板，实参如下表。结论判定为「不通过」时，Alex 取本表对应行的实参套入 fix-loop 模板执行修复循环。
| 阶段 | reviewer | review_type | fail_state | pass_state | commit_mode | max_rounds |
| --- | --- | --- | --- | --- | --- | --- |
| Sean | Sean（Auditor） | 规格合规审查 | 发现问题 | 规格合规 | pre-commit | 3 |
| Tess | Tess（QA） | 自动化测试 | 存在失败 | 全部通过 | pre-commit | 3 |
| Vera | Vera（Gatekeeper） | 代码审查 | CHANGES_REQUESTED | APPROVED | post-commit | 3 |
`Fixer` 固定为 James（Worker）。各阶段的 `{fix_message_body}`（修复消息补充字段）各不相同，见下方对应阶段节。
## 各阶段门禁明细
### Will - 系分增强
**skill_file**：`agents/will.md`

**判断锚点**：系分文档是否被充分注入仓库上下文（代码引用、实现模式）。

**完成前验证**：

- 状态为 DONE 或 DONE_WITH_CONCERNS。

**质量门禁打回处理**：

- 命中 2 项及以上质量维度：Will（Analyst）返回 BLOCKED，理由为“系分文档质量不满足增强条件”。
- Alex（Lead）收到 BLOCKED 时执行：

```text
Alex（Lead）：Will（Analyst）报告系分文档质量不达标，命中 {N} 项质量维度。
打回原因：{具体维度与说明}
影响评估：低质量系分会导致后续编码方向偏差，实现与需求不符。
决策：暂不终止，给用户改进机会。
建议：{针对性的改进建议}
```

### Alex - Spec 锁定

**skill_file**：`stages/spec-confirm.md`

基于 Will 输出的增强系分，通过 OpenSpec 完整链路生成提案、规范、设计和任务，经过两次用户确认和 Brainstorm 深化后方可进入编码。

**验证**：

- `config.yaml` 已生成（`test -f <repo>/openspec/schemas/acs-spec/config.yaml`）。
- 变更目录存在（`test -d <repo>/openspec/changes/<change-name>`）。
- `proposal.md` / `spec.md` / `design.md` / `tasks.md` 均存在。
- 用户完成两次确认（或无人驾驶模式下自动跳过）。
- Brainstorm 已执行或已跳过。
- `knowledge-paths.json` 已写入。

**断点恢复**：

- 内部条件检查：state.md frontmatter `stage_2_status: done` 且 `stage_2_proposal_id` 非空且关键文档均存在。
- 满足后向用户询问（角色化措辞）：“检测到已完成的 Spec 锁定（提案：{stage_2_core_change 的值}）。是否复用？”
- 询问中只暴露业务名词，不出现 `stage_N_xxx`。
- 用户确认复用：跳过本阶段，进入编码实现。

**质量门禁打回处理**：

- OpenSpec 生成失败或 artifacts 不完整：Alex（Lead）（本阶段 inline 执行者）返回 BLOCKED，说明具体失败步骤。
- Alex（Lead）收到 BLOCKED 时执行：

```text
Alex（Lead）：Spec 锁定过程中遇到 BLOCKED。
失败步骤：{proposal/spec/design 中的具体步骤}
根因分析：{OpenSpec 指令不清晰 / 系分质量不足 / 知识注入缺失 / ...}
影响评估：Spec 不完整将直接影响编码质量和项目可维护性。
决策：询问用户是否重试（调整输入后重新生成）或退出。
建议：{针对性的改进建议}
```

### James - 编码实现

**skill_file**：`agents/james.md`

**判断锚点**：代码是否按 spec/design/tasks 完整实现，编译是否通过。

**完成前验证**：

- 状态为 DONE 或 DONE_WITH_CONCERNS。
- 编译通过（exit code 0）。
- 变更文件清单已输出（供 Sean 审查使用）。

**注意**：James 在本阶段**不提交代码**。代码提交在 Sean 规格核验、Tess 自动测试全部通过后，由 Alex 代码提交阶段统一执行。

### Sean - 规格核验

**skill_file**：`agents/sean.md`

**判断锚点**：实现是否精确匹配 spec（不多不少不偏）。

**触发条件**：仅当 James 报告 DONE 或 DONE_WITH_CONCERNS 后启动。

**完成前验证**：

- 状态为 DONE。
- 审查结论明确（规格合规 / 发现问题）。
- 如发现问题，提供 `file:line` 引用。

**结论 = 发现问题**：取上方「fix-loop 阶段参数对照表」Sean 行实参，按 `config/fix-loop.md` 执行修复循环。

**修复消息补充字段**：

- 问题分类：边界 / 多余 / 误解。
- 问题列表格式：`【分类】文件:行号 - 问题描述 - 修复建议`。
- 约束：修复后需重新通过 Sean（Auditor）审查；每次修改后运行编译验证；不得引入本轮修复范围外的变更；**不提交**。

### Tess - 自动测试

**skill_file**：`agents/tess.md`

**判断锚点**：自动化测试用例是否全部通过。

**条件**：state.md frontmatter 的 `test_yuque_url` 非空时执行，否则跳过。

**完成前验证**：

- 状态为 DONE。
- 测试报告文件已生成。

**结论判定规则**（内部判定，用户面表述为“Tess 全部通过 / Tess 存在失败”）：

- **全部通过**：Tess 报告失败用例数 = 0（内部字段：`stage_5_failed`）。
- **存在失败**：Tess 报告失败用例数 > 0。

**结论 = 存在失败**：取上方「fix-loop 阶段参数对照表」Tess 行实参，按 `config/fix-loop.md` 执行修复循环。

**修复消息补充字段**：

- 问题列表格式：`【测试失败】用例名 - 失败现象 - 期望行为 - 相关日志/截图路径`。
- 约束：逐个修复失败用例；每次修改后运行编译验证；不得跳过失败用例；**不提交**。
- 验证标准：重新通过 Tess（QA）自动测试。

### Alex - 代码提交

**skill_file**：`stages/commit.md`

**执行模式**：inline（Alex 直接执行）。

**触发条件**：Sean 规格合规、Tess 测试通过（或跳过）后。

将已通过验证的代码一次性提交到 git。

**执行步骤**：

1. 确认工作树有变更。
2. `git add -A`
3. 生成 commit message（基于 Spec 锁定阶段的核心变更摘要，内部字段 `stage_2_core_change`，约定式提交格式）。
4. `git commit`
5. 调 advance 记录 SHA 和 message 到 state.md（含 stage_6 流转）。

**完成前验证**：

- commit 存在（`git log -1`）。
- 工作树干净。

### Vera - 质量审查

**skill_file**：`agents/vera.md`

**判断锚点**：代码是否存在工程实践缺陷或安全/性能/兼容性风险。

**触发条件**：代码已提交（Alex 代码提交完成后）。

**完成前验证**：

- 状态为 DONE。
- 报告文件已写入。
- 审查结论明确（APPROVED / CHANGES_REQUESTED）。

**结论 = CHANGES_REQUESTED**：取上方「fix-loop 阶段参数对照表」Vera 行实参，按 `config/fix-loop.md` 执行修复循环。

**修复消息补充字段**：

- 问题列表格式：`[P级] 文件:行号 - 问题描述 - 修复建议`，每条附“影响面”一句话。
- 优先级规则：P0 和 P1 必须修复；P2 酌情处理；P3 不建议本轮修。
- 约束：每次修改后运行编译验证；修复范围仅限当前问题；修复完成后**提交代码**。
- 验证标准：编译通过，重新通过 Vera（Gatekeeper）审查。

### Alex - 提交发布

**skill_file**：`stages/submit.md`

**执行模式**：inline（Alex 直接执行）。

**触发条件**：Vera 代码审查通过（或跳过）后。

**执行步骤**：

1. Push 到远端（`git push origin <branch>`）。
2. 创建 PR（询问用户确认）。
3. 迭代关联与打包（非阻断，失败静默跳过）。
4. 调 advance 记录输出到 state.md（含 stage_8 流转 -> COMPLETE）。

**完成前验证**（Alex 内部检查）：

- push 已执行（成功或已记录失败）。
- state.md frontmatter 已写入提交发布阶段的输出字段（`stage_8_*`）。
