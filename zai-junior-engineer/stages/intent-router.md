---
name: intent-router
execution_mode: inline
action: 意图分流
---

# 意图分流入口

stage 0 的入口文件。本文件本身**不收集任何参数、不写 state.md**，只做一件事：列出所有 ability、让用户选择，派发到对应的 init 文件。

state.md 写入由派发后的 ability init 文件（如 `stages/feature-init.md` / `stages/bugfix-init.md`）负责。

---

## 步骤清单

> 开始执行前实例化，每步完成后标记 ✅。

- [ ] Step 1: 列出可用 ability
- [ ] Step 2: AskUserQuestion 让用户选择意图
- [ ] Step 3: 解析选中 ability 的 init_stage_file
- [ ] Step 4: Read 该 init 文件 inline 执行
- [ ] Step 5: 完成前验证

---

## 执行步骤

### Step 1: 列出可用 ability

```bash
node <SKILL_ROOT>/lib/abilities.js list
```

输出 JSON 数组，每项含 `id` / `display_name` / `intent_description`，例如：

```json
[
  { "id": "feature", "display_name": "需求开发", "intent_description": "基于系分文档开发新功能或增强已有功能" },
  { "id": "bugfix", "display_name": "缺陷修复", "intent_description": "修复已有 bug，支持从伙伴/Dima 查询缺陷" }
]
```

**降级**：如果 `lib/abilities.js` 不可用或返回空列表，报错并提示用户检查 `abilities/` 目录。

### Step 2: AskUserQuestion 让用户选择意图

把 Step 1 的输出每项渲染为一个选项：

```
question: "您想做什么？"
header: "任务类型"
options:
  - label: <ability.display_name>
    description: <ability.intent_description>
```

用户选定 -> 记录 `selected_ability_id`（对应所选 ability 的 `id` 字段）。

### Step 3: 解析选中 ability 的 init_stage_file

```bash
node <SKILL_ROOT>/lib/abilities.js resolve-init <selected_ability_id>
```

stdout 输出 init 文件相对路径（如 `stages/feature-init.md`），记录为 `init_stage_file`。

### Step 4: Read 该 init 文件 inline 执行

Read `<SKILL_ROOT>/<init_stage_file>`，按其步骤清单 inline 执行。该文件负责：
- 收集 ability 专属参数
- 写入 state.md（含 `task_type: <selected_ability_id>` 和 ability 专属字段）
- 配置 `.gitignore` 与状态目录
- Superpowers 安装检查（如适用）
- 完成 stage 0 -> state.md 中 `current_stage: 1`

### Step 5: 完成前验证

> 子 init 文件执行完毕后，本入口的完成前验证：

| # | 验证项 | 检查方式 | 不通过 |
|---|--------|----------|--------|
| 1 | state.md 已写入 | `test -f <repo_path>/.acs-junior-engineer/state.md` | 重新回到 Step 1 选择 |
| 2 | task_type 与用户意图一致 | `grep "task_type: <selected_ability_id>" state.md` | 报错回到 Step 4 修正 |
| 3 | current_stage 合法 | `grep "current_stage:" state.md` 且结果 `1` | 重新 Read init 未完成 |
| 4 | state.md frontmatter 合法 | `acs-junior validate <repo_path> --stage 0` exit 0 | 按子 init 的修复动作处理 |

---

## 调度器指令

> **本入口执行完毕（含子 init 执行）后，state.md 已创建（`current_stage=1, task_type=<id>`），进入 PIPELINE_LOOP S1。**
> Stage 1 由 tick 调 `abilities.resolveSpecEnhanceAgent(task_type)` 路由到对应 agent（feature -> will；bugfix -> dave；未来新 ability -> 对应新 agent）。
