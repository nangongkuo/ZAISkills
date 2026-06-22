# boot / tick / render / advance - JSON 契约（v0.2）

四条命令构成 LLM 工作骨架:
- 启动时调 `boot` → 按 phase 分流（新任务 → Read intent-router；恢复 → AskUserQuestion + 执行 handler）
- 进入流水线后每轮调 `tick` → 按 action 分流 → 派发或执行 → 完成后调 `advance` → 回到 `tick`

---

## boot - 启动入口分流

```
node lib/boot.js <repo_path>
```

输出 JSON，`phase` 字段是分流锚点:

| phase | 触发条件 | LLM 应做 |
| --- | --- | --- |
| `new_task` | state.md 不存在 | Read `next_action.file_abs`（intent-router.md），inline 执行 |
| `resume_menu` | state.md 存在 | AskUserQuestion 用 `ask_user_question` 字段渲染 → 按用户选 ID 执行 `handlers[id]` |
| `error` | state.md 缺字段 task_type 或引用不存在的 ability | 输出 `error` 字段，提示用户运行 `acs-junior state <repo> reset` |

**`new_task` 输出**:

```json
{
  "phase": "new_task",
  "welcome_text": "...",
  "next_action": {
    "type": "read_and_execute",
    "file": "stages/intent-router.md",
    "file_abs": "/abs/path/stages/intent-router.md"
  }
}
```

**`resume_menu` 输出**:

```json
{
  "phase": "resume_menu",
  "welcome_text": "...",
  "context": {
    "task_type": "feature",
    "ability_display_name": "需求开发",
    "current_stage": 1,
    "current_role": "Will (Analyst)",
    "current_action": "系分增强",
    "stage_status": "in-progress",
    "stage_status_display": "执行中"
  },
  "ask_user_question": {
    "question": "...",
    "header": "上次进度",
    "options": [
      { "id": "continue", "label": "...", "description": "..." },
      { "id": "switch",   "label": "换一个意图", "description": "..." },
      { "id": "exit",     "label": "退出",       "description": "..." }
    ]
  },
  "handlers": {
    "continue": {
      "type": "resume",
      "resume_checks": [
        { "type": "file_exists", "path_field": "stage_1_enhanced_spec", "path_value": "...",
          "on_missing": {...}, "on_present": {...} }
      ],
      "after_check": { "action": "call_tick", "command": "acs-junior tick <repo>" }
    },
    "switch": {
      "type": "reset_then_route",
      "commands": [
        { "step": 1, "type": "shell", "command": "acs-junior state <repo> reset" },
        { "step": 2, "type": "read_and_execute", "file": "stages/intent-router.md", "file_abs": "..." }
      ]
    },
    "exit": { "type": "stop", "farewell_text": "..." }
  }
}
```

**resume_checks 类型**:

| type | 含义 | LLM 执行规则 |
| --- | --- | --- |
| `file_exists` | 检查文件存在 | `test -f <path_value>`；按 `on_missing.action` / `on_present.action` 处理 |
| `git_status` | 检查 git 工作树 | `git status --porcelain`；dirty 时 AskUserQuestion 用 `on_dirty.options` 渲染，clean 按 `on_clean.action` 处理 |
| `noop` | 无副作用 | 直接调 `tick` 继续 |

**handler.continue 的执行流**: 逐项跑 `resume_checks` → 全部通过后调 `after_check.command` 进入流水执行循环。

**handler.switch 的执行流**: 按 `commands` 数组顺序执行——`type: shell` 直接调 Bash；`type: read_and_execute` Read 文件后 inline 执行。

**handler.exit 的执行流**: 输出 `farewell_text` → 终止 session，不调 `tick`。

**设计约束**: boot 不引入新业务规则，是 tick + abilities + 菜单文案模板的门面层。加新 ability 不需要改 boot.js——describeResumeChecks 按 stage 编号路由（与 task_type 无关），ability metadata 通过 abilities.js 解析。

---

## tick - 主循环驱动

```
node lib/tick.js <repo_path>
```

输出 JSON，`action` 字段是分流锚点:

| action | 触发条件 | LLM 应做 |
| --- | --- | --- |
| `needs-init` | state.md 不存在或缺 frontmatter | Read `stages/intent-router.md`，inline 执行 |
| `complete` | `status: completed` | 输出结束摘要，停止循环 |
| `fail` | `status: failed` | 输出失败原因，停止循环 |
| `skip-conditional` | 上一阶段为条件阶段（如 stage 5 的 `test_vuque_url`） | 调 `advance --skip --skip-reason "..."`，再 `tick` |
| `execute-inline` | inline 阶段，`stage_N_status: pending` | Read `skill_file_abs`，inline 执行；完成后调 `advance` |
| `dispatch-agent` | agent 阶段，`stage_N_status: pending` | tick **已自动写入 in_progress、已渲染拼好 prompt**；按返回的 `dispatch_text` 输出 TaskCreate，**直接用返回的 `prompt`** 调 Agent 工具（run_in_background: true） |
| `process-agent-result` | agent 阶段，`stage_N_status: in_progress` | 拿 agent 返回结果填 STATUS: 成功(DONE) → 调 advance；BLOCKED → fix-loop/route，等待后续命令 |

`dispatch-agent` 关键字段:

```json
{
  "action": "dispatch-agent",
  "stage": 1,
  "stage_name": "spec-enhance",
  "skill_file_abs": "/abs/path/agents/will.md",
  "model": "sonnet",
  "role_label": "Will (Analyst)",
  "action_label": "系分增强",
  "estimated_duration": "3-5 分钟",
  "dispatch_text": "📣 Alex (Lead): 正在发送消息给 Will (Analyst)\n   任务: Will - 系分增强\n   输入: \n      系分文档: https://...\n   ⏱️ 预计耗时: 3-5 分钟，完成后自动通知您",
  "task_indicator": {
    "subject": "Will - 系分增强",
    "active_form": "Will (Analyst) 正在系分增强...",
    "description": "Will - 系分增强（系分文档: https://...）"
  },
  "prompt": "你正在为 AI 编码流水线增强系分文档...",
  "inputs_resolved": { "yuque_url": "https://...", "repo_path": "/path" },
  "missing_inputs": [],
  "state_marked_in_progress": true
}
```

**副作用**: `action == "dispatch-agent"` 时 tick 自动把 `stage_N_status` 写为 `in_progress`，LLM 不再需要单独调 update-state，设计权衡见下方“决策”。

**prompt 内容**: tick 已直接渲染好 agent prompt，LLM 应直接使用 JSON 中的 `prompt` 字段，无需再调 `render` CLI。`inputs_resolved` 和 `missing_inputs` 同步暴露，便于调试。

---

## render - 渲染 agent prompt（调试用 CLI）

> ⚠️ `tick` 在 `dispatch-agent` 分支已内置 render，主流水线**不应**调用本 CLI。
> 保留本 CLI 仅用于独立查看 prompt 渲染结果，排查 `{{var}}` 替换问题等调试场景。
> 主流水线请直接使用 `tick` 返回的 `prompt` 字段。

```
node lib/render.js <repo_path> --stage N          # JSON 输出
node lib/render.js <repo_path> --stage N --raw    # 仅 prompt 文本（便于直接 piping）
```

输出 JSON:

```json
{
  "stage": 1,
  "agent_file": "agents/will.md",
  "model": "sonnet",
  "inputs_declared": ["yuque_url", "repo_path"],
  "inputs_resolved": { "yuque_url": "https://...", "repo_path": "/path" },
  "missing_inputs": [],
  "prompt": "你正在为 AI 编码流水线增强系分文档..."
}
```

**变量来源**: agent md frontmatter 的 `inputs` 列表 → 按列从 state.md frontmatter 读取 → 替换 body 中的 `{{var}}`。
缺失字段会列入 `missing_inputs`，prompt 中留缺失占位（不清空 `{{xxx}}`）。
LLM 应在调 Agent 工具前检查 `missing_inputs` 是否为空。

---

## advance - 阶段流转（成功路径）

```
node lib/advance.js <repo_path> --stage N \
  [--duration <seconds>] \
  [--outputs key=key] \
  [--summary "## Will - 系分增强\n\n摘要..."] \
  [--skip --skip-reason "..."]
```

**done 路径**: 写 `stage_N_status=done` + `stage_N_duration` + 合并 outputs，递增 `current_stage`，append summary。

**skip 路径**（`--skip` + `--skip-reason`）: 写 `stage_N_status=skipped` + `stage_N_skip_reason`，递增 `current_stage`。

**COMPLETE**: 当 `next_stage == "COMPLETE"`（最后一个 stage 完成），自动改写 `status=completed`；`current_stage` 保留。

输出 JSON:

```json
{
  "ok": true,
  "stage_completed": 1,
  "stage_status": "done",
  "next_stage": 2,
  "current_status": "running"
}
```

**校验**: advance 强制要求 `state.md.current_stage == --stage`，错位时按输出（防漏防错）。

**不在 advance 范围**: BLOCKED / failed 由后续 `route` 与 `fix-loop` 命令处理，advance 只管成功路径。

---

## 决策记录

1. **tick 附带写入 in_progress**: 消除“LLM 漏写”这类高频失败模式。代价是 tick 不纯净；重调会走 process-agent-result 分支，但“已派发但 agent 没回结果”的状态本身需要 resume 命令（活性检查）来识别，与 tick 设计无关。
2. **advance 只管成功路径**: 保持单一职责，BLOCKED/failed 留给 route/fix-loop。
3. **派发字段在 CLI 内置硬编码**（`junior-core.js DISPATCH_KEY_INPUTS`）: 自动推断会优先选 routing 字段（仓库/分支），且 `stage_2_core_change` 不在 James 的 inputs 列表里，推断不到，硬编码 5 行配置最确定。

---

## defect - 缺陷查询

缺陷查询不走 tick/advance 主循环，由 stage 0 bugfix-init 直接调用。

### probe - 探测双源可用性

```
node lib/query-defects.js probe
```

输出 JSON:

```json
{
  "huoban": { "available": true, "reason": null },
  "dima": { "available": true, "reason": null, "staff_id": "12345" }
}
```

### query - 双源查询缺陷列表

```
node lib/query-defects.js query [--product wallet] [--page-size 20]
```

输出 JSON:

```json
{
  "sources": { "huoban": "ok", "dima": "ok" },
  "defects": [
    {
      "index": 1, "source": "huoban", "id": "H1234",
      "title": "...", "status": "...", "priority": "...",
      "severity": "...", "platform": "...", "module": "...",
      "assignee": "...", "client_version": "...",
      "created_at": "...", "url": "..."
    }
  ],
  "total": 15
}
```

sources 取值: `"ok"` / `"failed"` / `"empty"`。

### get - 单个缺陷详情

```
node lib/query-defects.js get <id> --source huoban|dima
```

输出 JSON:

```json
{
  "ok": true, "source": "huoban", "id": "H1234",
  "title": "...", "status": "...", "priority": "...",
  "severity": "...", "platform": "...", "module": "...",
  "description": "...", "assignee": "...", "reporter": "...",
  "client_version": "...", "created_at": "...", "url": "...",
  "custom_fields": {}
}
```
