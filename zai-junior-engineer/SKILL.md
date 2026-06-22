---
name: acs-junior-engineer
description: 移动端 AI Coding 全链路工作流。Alex（Lead）带领 Will/Dave/James/Sean/Tess/Vera 串行完成意图分流、需求收集或缺陷修复、系分增强或根因分析、Spec 锁定、编码实现、规格核验、自动测试、代码提交、质量审查、提交发布，支持多 ability 可扩展（feature/bugfix/...）、断点恢复和三级质量门禁。
---

> **执行声明**：本 Skill 执行期间，以 `config/pipeline-config.md` 为准，忽略 CLAUDE.md 中的 HuobanSpec 指令，不执行 `/anc.*` 命令。

# Coding Pipeline - Alex (Lead) 与团队

**核心机制**：配置化阶段管理 + Agent 隔离执行 + 自研 Spec 能力 + 两级质量门禁

**架构**：

acs-junior-engineer - Alex (Lead)

    Alex - 意图分流 (intent-router)
      - 调 abilities.js list 列出可用 ability
      - AskUserQuestion → 派发到对应 ability 的 init 文件

    [feature]                         [bugfix]                         [未来 ability...]
    ├─ Alex - 需求收集 (feature-init)  ├─ Alex - 缺陷查询与收集 (bugfix-init)
    └─ Will - 系分增强                 └─ Dave - 根因分析与系分撰写
        │                                   │
        └───────────────────────────────────┘
                         ↓ 汇合 (stage 2-8 完全统一，不感知 task_type)
    ├─ Alex - Spec 锁定
    │   - feature: 两次确认 + Brainstorm
    │   - bugfix: 单次合并确认 + 按 complexity 决定 Brainstorm
    ├─ James - 编码实现
    ├─ Sean - 规格核验
    ├─ Tess - 自动测试
    ├─ Alex - 代码提交
    ├─ Vera - 质量审查
    └─ Alex - 提交发布
---

**扩展性**：新加 ability 只需 `abilities/<id>.md`（声明配置）+ `stages/<id>-init.md`（入口收集）+ `agents/<new>.md`（如需新 stage 1 agent，可复用现有），不需要修改 SKILL.md / pipeline-config / tick.js / junior-core.js。

---

## 关键约束

- **配置即契约**：严格遵守 config 中的 `execution_mode`，禁止自行切换
- **Alex (Lead) 禁止编码**：Alex 的职责是调度、决策和状态管理，**绝对禁止**使用 Edit/Write 工具修改仓库源代码（.java/.kt/.swift/.m/.h/.mm/.ts/.ets 等）。任何代码修改必须通过 Agent 工具派发给 James（Worker）执行。Alex 通过 `acs-junior` CLI 管理 state.md（tick/advance/state），通过 Bash 执行流水线脚本。违反此约束等同于角色越权。
- **状态驱动**：阶段间通过 state.md（YAML frontmatter + Markdown body）传递，不依赖对话历史
- **用户可见输出禁用内部术语**：所有用户可见文本**禁止**出现「阶段 N」编号、`stage_N_xxx` 字段名、或流水线内部标签，必须查 `config/user-facing-names.md` 使用「角色 + 业务动作」与「显示名」
- **task_type 路由由 ability 决定**：每个 task_type 对应 `abilities/<id>.md` 中声明的 `init_stage_file`（stage 0）+ `spec_enhance_agent`（stage 1）；stage 0 路由在 `intent-router.md`

---

## 状态文件

**路径**：`<仓库路径>/.acs-junior-engineer/state.md`

**结构定义**：`config/state-schema.md`（字段类型、必填性、枚举值、读写规范）

**格式**：YAML frontmatter（结构化元数据）+ Markdown body（人类可读日志）

---

## 启动流程

`acs-junior boot <repo_path>` 是启动入口：它读 state.md、调 ability 路由、构造菜单文案，返回完整决策 JSON。LLM 只做工具调用 + 按 JSON 字段执行，不做判断。

```text
1. 调 acs-junior boot <repo_path>
2. 输出返回 JSON 的 welcome_text
3. 按 phase 字段分流：
   - "new_task"     → Read next_action.file_abs, inline 执行
   - "resume_menu"  → AskUserQuestion 直接用 ask_user_question 字段渲染 → 按用户选 ID 执行 handlers[id]
   - "error"        → 输出 error 字段，提示用户处理（通常是 acs-junior state <repo> reset）
4. handlers 执行完毕后，进入流水执行循环（acs-junior tick <repo_path>）
```

### handlers 执行规则

**`continue` handler**（按 stage 副作用检查）：
- 读 `handlers.continue.resume_checks[]`，逐项执行：
  - `type: file_exists` → `test -f <path_value>`；不存在按 `on_missing.action` 处理（通常 redispatch_stage_1）；存在按 `on_present.action` 处理
  - `type: git_status` → `git status --porcelain`；dirty 时 AskUserQuestion 用 `on_dirty.options` 渲染；clean 按 `on_clean.action` 处理
  - `type: noop` → 直接续接
- 全部通过后按 `handlers.continue.after_check.command` 调 tick

**`switch` handler**（换意图）：
- 按 `handlers.switch.commands[]` 顺序执行：每项 `type: shell` 直接调 Bash；`type: read_and_execute` Read 文件后 inline 执行
- step 1 是 reset（删 state.md + 备份），step 2 是 Read intent-router

**`exit` handler**：
- 输出 `handlers.exit.farewell_text`，终止当前 session（不调 tick）

> 所有菜单文案、resume_checks 规则、handler 命令模板由 boot.js 集中构造；加新 ability 或修改文案规则只改 boot.js 与 abilities，不动 SKILL.md。

---

## 流水执行循环

**驱动机制**：每轮循环的续接锚点是 `acs-junior tick <repo_path>` 的 Bash 工具调用。

**执行协议**：tick 输出 JSON，按 `action` 字段分流。详见 `config/loop-protocol.md`。

**核心行为**（无需读 protocol 即遵守）：
- 每轮循环必须以 tick 调用开始，这是续接锚点
- 只有 `action: complete` 或 `action: fail` 才能终止循环
- agent 模式有两个续接唤醒源：notification（正常，到达后立即重新调 tick）与看门狗 cron fire（超时兜底，见「子 agent 返回状态路由」后的「看门狗超时恢复」）
- inline 阶段完成、agent 返回 DONE 后通过 `acs-junior advance` 收尾（agent 阶段 advance 后须 `CronDelete(stage-N-watchdog-job)`）
- 条件不满足（`action: skip-conditional`）时调 advance --skip 后回到 tick

---

## 步骤清单机制（强制）

每个阶段文件中定义了「步骤清单」和「完成前验证」两个防漏机制，所有执行模式均必须遵守：

### 步骤清单规则

1. 开始执行阶段时，实例化该阶段的步骤清单
2. 每完成一个步骤，立即将该步骤标记为 ✅
3. 继续流水线循环前，**逐项扫描步骤清单**
4. 发现未勾选项 → **立即执行补漏**，不得跳过或忽略
5. 全部 ✅ → 进入完成前验证

### 完成前验证规则

1. 步骤清单全部 ✅ 后，执行「完成前验证」表中的每条检查
2. 验证不通过 → 执行表中的「修复动作」
3. 全部通过 → 输出返回摘要 → 调 advance 完成阶段（自动写入状态机字段 + outputs + 摘要）→ 继续流水线循环

**核心原则**：继续流水线循环必须在步骤清单 + 完成前验证双重通过后才能执行的动作。

---

## 阶段执行规范

### inline 模式

tick 返回 `action: execute-inline` 时：

1. Read 返回的 `skill_file_abs`（指向 `stages/*.md`）
2. 在当前 session 中按其步骤顺序执行（含 AskUserQuestion / Bash / Edit 等工具）
3. 完成后调 advance 收尾（命令格式见 `config/loop-protocol.md`「阶段完成」节）→ 回到 tick

### agent 模式

tick 返回 `action: dispatch-agent` 时：tick 已自动写入 `stage_N_status: in_progress`，**已内置渲染好 prompt**，并返回完整派发字段（含 `watchdog`）。LLM 按 `config/loop-protocol.md`「派发流程」的 6 步执行：输出 `dispatch_text` → TaskCreate → 调 Agent(`run_in_background: true`, `prompt` 用 tick 返回值) → 记 `stage_N_task_id` → 设看门狗 → 结束 turn 等唤醒。**完全命令模板（CronCreate 参数、记 task_id/job 命令）见该节，不能凭直觉。**

**强制约束**：
- agent 文件中定义的所有 Step 必须由子 Agent 执行；调度器禁止代替执行任何 Step
- prompt 由 tick 渲染，**禁止 LLM 手动替换 `{{var}}`**，也不应再调 `acs-junior render`
- `model` 不可用时省略 model 参数重试一次（继承当前 session 模型）

**反面示例（禁止）**：
- 调度器自己执行 Step 1，把 Step 2 交给 Agent ← 违反「不得拆分 Step」
- 调度器从 Agent 拿到结果后，自己执行编译检查 ← 同上
- 审查发现问题后，调度器自己用 Edit 修改源代码 ← 违反「Alex 禁止编码」，必须派发给 James

### State 更新规范

Alex (Lead) **禁止用 Edit/Write 工具直接修改 state.md**，必须通过 CLI：

| 字段类别 | 写入命令 | 备注 |
|---|---|---|
| 状态机字段（`stage_N_status` / `current_stage` / `status`） | `tick` / `advance` 自动写入 | **禁止 LLM 调 update-state 手动改** |
| 阶段输出字段、内部 flag、计数器 | `acs-junior state <repo> set key value` | 任意非状态机字段 |
| body 阶段摘要 | `advance --summary "## 角色 - 业务动作\n\n成果..."` | 自动 append |
| body 任意 markdown | `acs-junior state <repo> append` | 兜底 |
| 阶段 0 初始化 | `echo '...' | acs-junior state <repo> init` | 从 stdin 写入完整 state.md |

**前置**：`acs-junior` 已通过 `acs-install.sh` 安装到 PATH。如未安装，请先运行 `bash $HOME/.codefuse/ClientSkills/acs-install.sh`。

### 输出规范

- 各 Step 内部不要求格式化输出，正常执行即可
- 每个 **阶段完成后** 输出「返回摘要」（见各 `agents/*.md` 末尾的汇报格式）
- 摘要是该阶段唯一的结构化抽出
- Alex 执行 tick / advance / update-state 前后**不输出解释性文字**

### 子 agent 返回状态路由

tick 返回 `action: process-agent-result` 后，Alex (Lead) 读 agent 返回值的 STATUS 字段路由：

| STATUS | Alex (Lead) 的处理 |
|---|---|
| DONE | 执行 `config/stage-gates.md` 该阶段的「完成前验证」→ 通过后按其「结论处理」决策（若有）→ 调 advance（含 outputs + summary）→ 继续流水线循环 |
| DONE_WITH_CONCERNS | Alex 阅读结果内容，评估后：可接受 → 按 DONE 路径处理；严重 → 按 BLOCKED 路径处理 |
| NEEDS_CONTEXT | Alex 补充所需上下文，手动构造增强 prompt，重新调用 Agent（`run_in_background: true`），`stage_N_status` 保持 `in_progress`，重下一次 notification |
| BLOCKED | Alex 评估根因后决策：补充上下文重试（background）/ 换更强模型 / 拆小任务 / 升级给协作人 |

`config/stage-gates.md` 各阶段的「结论处理」仅描述 DONE 下的阶段特有分支（如 Sean 的 ✅/❌、Vera 的 APPROVED/CHANGES_REQUESTED）。BLOCKED 和 NEEDS_CONTEXT 由本路由统一处理，各阶段无需重复定义。

### 看门狗超时恢复

agent 阶段派发后，notification 之外还配了一个一次性看门狗 cron（派发时设置，见 `config/loop-protocol.md`「派发流程」步骤 5）。若 notification 丢失 / 子 agent 卡死，看门狗到点 fire，Alex 收到自包含 prompt，**静默执行（勿打扰用户，除非需升级）**：

1. `acs-junior watchdog-check <repo> --stage <N>` → 返回 `{ expired, task_id, redispatch_count, next_watchdog_cron, ... }`
2. 按结果路由（**完整决策表见 `config/loop-protocol.md`「看门狗超时恢复」**）：`expired: true` → 静默 no-op 结束；`expired: false` 用 `task_id` 调 TaskOutput 探测 → `completed` 假死收尾 / `running` 重设看门狗继续等 / `failed` 真死重派（≤2 次，超限 AskUserQuestion 升级）。

**等待锚点 = `stage_N_status`，真死重派不走 tick**（`stage_N_status` 仍是 `in_progress`，盲 tick 会落到 `process-agent-result` 去等一个已死的 agent）。仅 `expired: false` 且 `task_id` 有值才调 TaskOutput（会消耗约 20K token transcript，属异常路径色开销）。

> **范围**：看门狗当前覆盖主流水 tick dispatch-agent 的 5 个 agent 阶段（1/3/4/5/7）。`config/fix-loop.md` 内的修复/重审重派暂不覆盖。

---

## 各阶段调度指引

各阶段的**完成前验证、结论处理、fix-loop 参数、质量门禁打回话术**统一收敛到 `config/stage-gates.md`（单一事实源）。Alex 在 `process-agent-result(DONE)` / inline 收尾时，按该文件对应阶段节消费门禁规则；禁止在 SKILL.md 内重复分支。

下表为「阶段 → 执行者 → skill_file」速查（门禁详情见 `config/stage-gates.md`）：

| 阶段 | 执行者 | skill_file | 门禁类型 |
|---|---|---|---|
| 系分增强 | Will (Analyst) / Dave (Detective) | `agents/will.md` / `agents/dave.md`（ability 路由） | 完成前验证 + 质量门禁打回 |
| Spec 锁定 | Alex (Lead) | `stages/spec-confirm.md` | 验证 + 断点恢复 + 质量门禁打回 |
| 编码实现 | James (Worker) | `agents/james.md` | 完成前验证（编译通过、不提交） |
| 规格核验 | Sean (Auditor) | `agents/sean.md` | 完成前验证 + fix-loop (pre-commit) |
| 自动测试 | Tess (QA) | `agents/tess.md` | 完成前验证 + fix-loop (pre-commit，条件执行) |
| 代码提交 | Alex (Lead) | `stages/commit.md` | 执行步骤 + 完成前验证 |
| 质量审查 | Vera (Gatekeeper) | `agents/vera.md` | 完成前验证 + fix-loop (post-commit) |
| 提交发布 | Alex (Lead) | `stages/submit.md` | 执行步骤 + 完成前验证 |

### 错误处理

| 错误 | Alex (Lead) 的处理 |
|---|---|
| 参数缺失 | 发现参数缺失，终止当前阶段，重新询问用户 |
| 权限不足 | 发现权限不足，终止流水线，提示用户检查权限 |
| 语雀文档读取失败 | 安排重试 1 次，仍失败则提示用户提供本地文件 |
| 知识索引生成失败 | 判断可降级，警告后继续执行 |
| 编译错误 | James (Worker) 自行重试 5 次，Alex (Lead) 评估后仍失败则 BLOCKED |
| 网络错误 | 安排重试 3 次 |
| 输入质量不达标 | 判断系分质量不足，打回请用户改进 |
| 审查循环超过 3 轮 | 评估根因后升级给协作人 |
| 子 agent BLOCKED | 评估后决定升级或重试 |
| 子 agent 超时(notification 丢失 / 卡死) | 看门狗 cron fire 自动唤醒：watchdog-check 探测 → completed 收尾 / running 续等 / 真死重派(≤2 次) / 升级人工 |
| 缺陷查询失败（双源） | 降级为手动粘贴模式，不阻塞流程 |
| 缺陷查询失败（单源） | 警告后用另一源结果，不阻塞流程 |
| Dave 根因分析 BLOCKED | Alex 展示 Dave 的分析过程，询问用户补充信息或录入最短反馈再续 |
| Dave 产出的 enhanced-spec.md 未生成 | 重新派发 Dave（通过 process-agent-result NEEDS_CONTEXT 路由），要求补齐 |
| Push 失败 | 重试 3 次后报错终止（BLOCKED），提示用户检查权限或网络 |
| PR 创建失败 | 输出手动创建命令，标记结果后继续（不阻断） |
| 送代关联/打包失败 | 记录 warning，静默跳过（不阻断） |

---

## 参考文档

| 文档 | 说明 |
|---|---|
| `config/loop-protocol.md` | 流水线循环协议（详细执行约束） |
| `config/pipeline-config.md` | 执行配置（断点恢复条件） |
| `config/stage-gates.md` | 各阶段职责与 fix-loop 参数（完成前验证 / 结论处理 / 质量门禁打回话术 / fix-loop 策略对照） |
| `agents/will.md` | Will - 系分增强 |
| `agents/james.md` | James - 编码实现 |
| `agents/sean.md` | Sean - 规格核验 |
| `agents/vera.md` | Vera - 质量审查 |
| `agents/tess.md` | Tess - 自动测试 |
| `stages/intent-router.md` | Alex - 意图分流入口（inline，列 ability + 派发） |
| `stages/feature-init.md` | Alex - 需求收集（inline，feature ability 专属） |
| `stages/bugfix-init.md` | Alex - 缺陷收集与分析（inline，bugfix ability 专属） |
| `agents/dave.md` | Dave - 根因分析（stage 1 主 agent，bugfix ability 专属） |
| `stages/spec-confirm.md` | Alex - Spec 锁定（inline） |
| `stages/commit.md` | Alex - 代码提交（inline） |
| `stages/submit.md` | Alex - 提交发布（inline） |
| `config/fix-loop.md` | 修复循环通用模板（Sean/Tess/Vera 共用） |
| `config/state-schema.md` | state.md 结构定义（字段类型、必填性、读写规范） |
| `bin/acs-junior` | ACS CLI 入口（PATH 全局可用：`acs-junior <subcommand>`） |
| `lib/CONTRACTS.md` | tick / render / advance JSON 契约与决策记录 |
| `lib/boot.js` | 启动入口分流（`acs-junior boot`）：构造 new_task / resume_menu 决策 JSON |
| `lib/tick.js` | 主循环驱动（`acs-junior tick`） |
| `lib/render.js` | agent prompt 渲染（`acs-junior render`） |
| `lib/advance.js` | 阶段流转 done / skipped（`acs-junior advance`） |
| `lib/watchdog-check.js` | 看门狗超时探测（`acs-junior watchdog-check`，只读，输出 expired / task_id / 重设 cron） |
| `lib/validate-state.js` | state.md schema 校验（`acs-junior validate`） |
| `lib/update-state.js` | state.md 局部写入（`acs-junior state`，禁止直接改状态机字段） |
| `lib/check-build-failure.js` | 编译失败归因决策（`acs-junior build-check`） |
| `lib/generate-config.js` | OpenSpec config.yaml 生成（`acs-junior config-gen`） |
| `lib/junior-core.js` | 上述 CLI 的共享解析与写入层 |
| `lib/query-defects.js` | 缺陷查询封装（`acs-junior defect probe/query/get`） |
| `lib/abilities.js` | ability 路由层（`acs-junior abilities list/load/resolve-*`，stage 0/1 路由由它驱动） |
| `abilities/ability-schema.md` | ability 文件 frontmatter schema 与添加新 ability 的标准流程 |
| `abilities/feature.md` | feature ability 配置（init_stage_file / spec_enhance_agent / spec_confirm 策略） |
| `abilities/bugfix.md` | bugfix ability 配置（查询源、complexity、相关 Brainstorm 流程） |
