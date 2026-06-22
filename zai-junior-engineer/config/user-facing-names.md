# 用户面命名字典

本字典是 `acs-junior-engineer` **所有用户面输出**的命名单一事实源。

使用约束：

**用户面输出 7 类场景**必须查本字典：

1. 派发文案（“Alex（Lead）：正在发送消息给……”）
2. 用户确认询问（AskUserQuestion 调用，如 Spec 锁定的两次确认、Submit 入口确认、PR 创建询问）
3. 断点恢复消息（启动菜单、续接说明）
4. 阶段返回摘要（各阶段完成后给用户的总结）
5. TaskCreate 三个字段：`subject` / `activeForm` / `description`

**禁止**在以上场景出现：

- 内部状态字段名（如 `current_stage`、`status`）
- 保留 stage 概念的裸用词（`stage` 只允许出现在 state.md frontmatter 字段定义中）

# 表 A：阶段 + 角色 + 业务动作

用户面提到正在做的事时，统一使用「`{角色显示} - {业务动作}`」格式。

| 内部 stage | 角色显示 | 业务动作 |
| --- | --- | --- |
| 0 | Alex（Lead） | 意图分流（feature：需求收集；bugfix：缺陷收集） |
| 2 | Alex（Lead） | Spec 锁定 |
| 3 | James（Worker） | 编码实现 |
| 4 | Sean（Auditor） | 规格核验 |
| 5 | Tess（QA） | 自动测试 |
| 6 | Alex（Lead） | 代码提交 |
| 7 | Vera（Gatekeeper） | 质量审查 |
| 8 | Alex（Lead） | 提交发布 |

| task_type | role_label | action_label | spec_enhance_agent |
| --- | --- | --- | --- |
| feature | Will（Analyst） | 系分增强 | `agents/will.md` |
| bugfix | Dave（Detective） | 根因分析与系分撰写 | `agents/dave.md` |
| trans | Echo（Mirror） | Cube + Native 转码 | `agents/echo.md` |
| cr | Rex（Reviewer） | 代码深度审查 | `agents/rex.md` |

新加 ability 时在 `abilities/` 下增加 `<id>.md` 即可，本表不需要手工同步。以当前注册的 ability 为准，可用 `node lib/abilities.js list` 查看。下游 stage 2-8 完全统一，不感知 task_type。

**派发文案示例**：

```text
Alex（Lead）：正在发送消息给 Will（Analyst）
任务：Will - 系分增强
输入：系分文档：https://yuque.antfin.com/...
仓库：/path/to/repo
预计耗时：3-5分钟，完成后自动通知您
```

**用户确认示例**（AskUserQuestion 标题）：

```text
即将进入 Alex（Lead）- 提交发布，是否继续？
```

**TaskCreate 示例**：

```text
subject: "Will - 系分增强"
activeForm: "Will（Analyst）正在系分增强..."
description: "Will - 系分增强（系分文档：<url>）"
```

# 表 B：frontmatter key + 用户面显示名

| frontmatter key | 显示名 |
| --- | --- |
| `repo_path` | 仓库 |
| `branch_name` | 分支 |
| `base_branch` | 基准分支 |
| `yuque_url` | 系分文档 |
| `test_yuque_url` | 测试用例文档 |
| `dmore_url` | 设计稿 |
| `autopilot` | 无人驾驶模式 |
| `task_type` | 任务类型 |
| `defect_context` | 缺陷上下文 |
| `defect_id` | 缺陷 ID |
| `defect_source` | 缺陷来源 |
| `defect_url` | 缺陷链接 |
| `defect_keywords` | 缺陷关键词 |
| `log_path` | 日志路径 |
| `trigger_time` | 触发时间 |
| `stage_1_doc_url` | 系分文档 |
| `stage_1_doc_summary` | 需求摘要 |
| `stage_1_enhanced_spec` | 增强系分内容 |
| `stage_1_knowledge_index` | 知识索引 |
| `stage_1_complexity` | 修复复杂度 |
| `stage_2_proposal_path` | 提案路径 |
| `stage_2_core_change` | 核心变更 |
| `stage_2_affected_files` | 涉及文件 |
| `stage_2_key_docs_proposal` | proposal 文档 |
| `stage_2_key_docs_spec` | spec 文档 |
| `stage_2_key_docs_design` | design 文档 |
| `stage_2_key_docs_tasks` | tasks 文档 |
| `stage_2_brainstorm` | Brainstorm 状态 |
| `stage_3_compile_passed` | 编译状态 |
| `stage_3_changed_files` | 变更文件清单 |
| `stage_4_conclusion` | 规格核验结论 |
| `stage_5_conclusion` | 自动测试结论 |
| `stage_5_failed` | 测试失败用例数 |
| `stage_5_report_path` | 测试报告 |
| `stage_6_commit_sha` | commit SHA |
| `stage_7_conclusion` | 质量审查结论 |
| `stage_8_push_status` | Push 状态 |
| `stage_8_pr_url` | PR 链接 |
| `stage_8_sprint_id` | 关联迭代 |
| `platform` | 目标平台 |
| `template_name` | 模板名 |
| `cube_source` | Cube 源码 |

## 表 C：跳过状态判定（避免暴露 stage_N_status 字段）

用户面描述跳过状态时，用「`{角色}` 跳过 / 已完成 / 未通过」自然语言句式，**不**直接说 `stage_5_status: skipped`。

| 内部判定 | 用户面说法 |
| --- | --- |
| `stage_5_status == skipped` | Tess 已跳过（无测试用例） |
| `stage_5_status == done` | Tess 已通过自动测试 |
| `stage_7_status == done` | Vera 已通过质量审查 |
| `stage_N_status == blocked` | `{角色}` 报告 BLOCKED |


























# 角色标签校验

`config/user-facing-names.md` 表 A 中的「角色显示」格式为「`{名字}（{标签}）`」，与各 agent/ability 文件保持一致：

- Alex（Lead）
- stage 1 角色：由 `abilities/<task_type>.md` 的 `role_label` 字段决定。当前已注册：
  - Will（Analyst）- `abilities/feature.md`
  - Dave（Detective）- `abilities/bugfix.md`
  - Echo（Mirror）- `abilities/trans.md`
  - Rex（Reviewer）- `abilities/cr.md`
- James（Worker）
- Sean（Auditor）
- Tess（QA）
- Vera（Gatekeeper）

同场景下（如表格列、面板清单）可省略标签写为「Alex」「Will」等，但首次出现或派发文案中保留标签。
