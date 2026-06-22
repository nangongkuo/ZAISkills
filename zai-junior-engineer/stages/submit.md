# Submit 阶段 (inline)

所有审查通过后，推送代码到远端、创建 PR、关联迭代并触发打包。

## 前置条件

- `stage_6_status = done`（代码已本地提交）
- `stage_7_status = done` 或 `skipped`（Vera 通过或跳过）

## 步骤清单

> 开始执行前实例化，每步完成后标记 ✅，输出 `[COMPLETE]` 前逐项确认。

- [ ] Step 0: 入口确认（autopilot=false 时询问用户）
- [ ] Step 1: Push 代码到远端
- [ ] Step 2: 创建 PR（询问用户）
- [ ] Step 3: 迭代关联与打包
- [ ] Step 4: 记录输出
- [ ] Step 5: 服务打分（autopilot=false 时询问用户）

---

## 执行步骤

### Step 0: 入口确认

**目的**：流水线前面阶段确认不询问用户，submit 是唯一面向远端副作用（push + PR + 打包）的阶段，进入前做一次最终确认。

**autopilot 模式**（`autopilot: true`）：跳过本步骤，直接进入 Step 1。

**正常模式**（`autopilot: false`）：使用 `AskUserQuestion` 询问：

- 标题：`即将进入 Alex（Lead）- 提交发布，是否继续？`
- 选项：
  - **继续提交发布** -> 进入 Step 1
  - **暂停，稍后处理** -> 输出"已暂停，可重新触发 skill 继续"，标记 `stage_8_status: blocked` + `stage_8_skip_reason: 用户暂停`，停止执行（不更新 status，下次断点恢复时从 stage 8 继续）

> 询问内容应包含本次将执行的动作摘要（push 到 `{branch_name}`、创建 PR、关联迭代并触发测试包），让用户做最后审视。

---

### Step 1: Push 代码到远端

```bash
cd {{repo_path}}
git push origin {{branch_name}}
```

**失败处理**:
- 网络错误 -> 重试 3 次，间隔 5 秒
- 权限错误 -> 报错终止（BLOCKED）
- 远端已有相同内容 -> 视为成功

---

### Step 2: 创建 PR（询问用户）

**无人驾驶模式**（autopilot: true）：跳过询问，尝试 `gh pr create`；若 `gh` 不可用或创建失败，必须构造手动创建链接并记录为：
```
stage_8_pr_url: "手动创建: https://<仓库域名>/<仓库路径>/pull_requests/new?source_branch=<branch_name>"
```
禁止只写 `手动创建` 而不带链接。

**正常模式**：调用 `AskUserQuestion` 询问用户：

- **选项 A**：「创建 PR」-> 执行 PR 创建
- **选项 B**：「稍后手动创建」-> 记录 `stage_8_pr_url: 手动创建`，进入 Step 3
- **选项 C (Other)**：自由输入 -> 用户输入作为 PR 标题

**PR 创建**:

```bash
cd {{repo_path}}
# 获取 commit 范围
COMMITS=$(git log {{base_branch}}..HEAD --oneline)
```

```bash
gh pr create --title "<标题>" --body "<描述>"
```

**PR 标题**：默认使用 `stage_2_core_change`，用户自定义时使用用户输入。

**PR 描述包含**:
- 系分文档链接（`stage_1_doc_url`）
- 分支名（`branch_name`）
- Commit 范围（`git log base_branch..HEAD --oneline`）
- 审查结论（仅 `stage_7_status: done` 时附加 Vera 审查结果）

**PR 创建失败处理**:
- 输出手动创建命令供用户参考
- 记录 `stage_8_pr_url: 创建失败`
- 不阻断后续步骤

---

### Step 3: 迭代关联与打包

> **必须尝试执行**。所有 huoban 推断和调用通过 `acs-junior submit iteration` 完成，本步骤的散文是 LLM 与 CLI 的交互流程。
> 最终必须为 `stage_8_sprint_id` 和 `stage_8_build_result` 赋值（哪怕是"跳过"/"未触发"）。

#### 3a: 探测

```bash
acs-junior submit iteration probe {{repo_path}}
```

返回 JSON 包含：`huoban_available` / `platform` / `module_id` / `module_id_attempts`（4 层自动尝试结果：本地配置 / `module get` / `bundle list` / `metadata search`）/ `existing_sprints` / `next_step`。

**根据 JSON 分流**:

| 条件 | 处理 |
|------|------|
| `huoban_available: false` 或 `platform: null` | **跳过本步骤**，调用 `apply --decision skip`（见下方 3c），将 outputs 写 advance |
| `module_id: null`（含 `skip_reason` 字段） | **跳过本步骤**，调用 `apply --decision skip`（module_id 全自动推断失败，**不询问用户**） |
| `module_id` 非空 | 进入 3b（用户决策） |

#### 3b: 用户决策

AskUserQuestion 询问用户：

| 选项 | 处理 | 何时展示 |
|------|------|----------|
| 关联已有迭代 | 从 `existing_sprints` 列表选择，得到 `sprint_id` -> `apply --decision associate --sprint-id <id>` | **仅当** `existing_sprints` 非空时展示 |
| 创建新迭代并发测试包 | AskUserQuestion 让用户输入 `version`（默认 1.0.0）-> `apply --decision create --version <v>` | 始终展示 |
| 跳过，不关联迭代 | `apply --decision skip` | 始终展示 |

> 当 `existing_sprints` 为空（如 ios-my4live 当前情形）时，AskUserQuestion 只展示「创建新迭代」与「跳过」两个选项，避免引导用户走入空列表。

#### 3c: 执行

```bash
# 跳过路径
acs-junior submit iteration apply {{repo_path}} --decision skip

# 关联已有
acs-junior submit iteration apply {{repo_path}} --branch {{branch_name}} \
  --decision associate \
  --sprint-id <用户选择的> --module-id <module_id> --platform <platform>

# 创建新迭代
acs-junior submit iteration apply {{repo_path}} --branch {{branch_name}} \
  --decision create \
  --version <用户输入的> --module-id <module_id> --platform <platform>
```

apply 内部按链式尝试执行：sprint create（如果）-> sprint module add -> package build（带 `--if-not-exists` 等幂等）。每步失败被收敛为 JSON 的 `*_warning` 字段，不中断。

返回 JSON 含 `outputs_for_advance` 字段，是给 Step 4 advance --outputs 直接用的字典。

---

#### Step 4: 记录输出到 state.md

将以下字段写入 state.md frontmatter:

```yaml
stage_8_status: done
stage_8_duration: <执行耗时秒数>
stage_8_push_status: <success / failed>
stage_8_pr_url: <PR URL / 手动创建 / 创建失败 / 跳过>
stage_8_sprint_id: <迭代ID / 跳过 / 未触发>
stage_8_build_result: <打包请求ID / 失败 / 未触发>
stage_8_build_url: <构建链接 / N/A>
```

---

### Step 5: 服务打分

**目的**：流水线跑完后收集用户对本次 Junior 服务的评价，结果通过 acs-trace 接入本次 trace 的 `business.rating`，由 SessionStart drain 统一上报，作为 NPS / 改进归因的数据源。

**autopilot 模式**（`autopilot: true`）：跳过本步骤，直接进入完成前验证。

**正常模式**（`autopilot: false`）:

#### 5a: 评分

调用 `AskUserQuestion`:

| 选项 | 映射 score |
|------|------------|
| 🌟🌟🌟🌟🌟 非常满意 | 5 |
| 🌟🌟🌟🌟 满意 | 4 |
| 🌟🌟🌟 一般 | 3 |
| 🌟🌟 不满意 | 2 |
| Other（用户输入任意文本，包括"跳过"/"不评分"） | 跳过本步骤，**不写任何 rating 字段** |

> AskUserQuestion options 上限 4 个，所以最低档合并为「不满意 = 2 星」；用户想表达"很差"或"完全跳过"都走 Other 路径。

写入:

```bash
acs-trace business rating score=<N>
```

> **注意**：必须用 `business rating` 通道（ability 名固定为 `rating`），后端会聚合到 `extra.business.rating.score`。失败静默忽略，不阻塞主链路。

#### 5b: 低分追问（仅 score <= 3 时执行）

通过 `AskUserQuestion` 询问主要问题来源：

| 选项 | 映射 feedback_type |
|------|--------------------|
| 系分准确度 | spec |
| 代码质量 | code |
| 流程 / 患者质量 | qa |
| Other（自由输入） | other（同时记 feedback 文本） |

写入:

```bash
acs-trace business rating feedback_type=<type>
# 如果用户走了 Other 自由输入路径，额外记一条
acs-trace business rating feedback="<用户输入文本>"
```

#### 5c: 高分 / 跳过路径

- score >= 4: 不执行 5b，直接进入完成前验证
- 用户在 5a 选 Other 跳过：不执行 5b，且不写任何 rating 字段，直接进入完成前验证

---

## 输出字段

| 字段 | 写入 state.md key | 类型 |
|------|-------------------|------|
| Push 状态 | `stage_8_push_status` | string |
| PR 链接 | `stage_8_pr_url` | string |
| 迭代 ID | `stage_8_sprint_id` | string |
| 打包结果 | `stage_8_build_result` | string |
| 构建链接 | `stage_8_build_url` | string |

---

## 完成前验证

| # | 验证项 | 检查方式 | 不通过时修复动作 |
|---|--------|----------|------------------|
| 1 | Push 已执行 | `stage_8_push_status` 字段非空 | 执行 Step 1 |
| 2 | 迭代关联已记录 | `stage_8_sprint_id` 字段非空（含"跳过"/"未触发"） | 执行 Step 3 |
| 3 | state.md 包含 stage_8 输出 | `grep "stage_8_push_status" state.md` | 立即写入 |
| 4 | push 失败也可被记录 | `stage_8_push_status = success` 或 push 失败已记录 | 无（允许 push 失败但已记录的状态） |

---

## 返回摘要

> **格式约束**：本面板展示给用户看到输出，角色和动作查 `config/user-facing-names.md` 表 A，字段名查表 B，**禁止**输出任何阶段 N 编号或 `stage_N_xxx` 字段名，下方 `{...}` 占位符须用实际值替换（业务复合义见表 B）。

```

✅ ACS 流程结束


📄 提交信息
commit: {Commit SHA}
PR:     {PR 链接}

🛡️ 代码推送
分支: {分支}
push: {Push 状态}

🔧 迭代关联
迭代: {关联迭代}
打包: {打包请求}

────────────────────────
🎉 全部环节完成!

✅ Alex - 需求收集
✅ Will - 系分增强
✅ Alex - Spec 锁定
✅ James - 编码实现
✅ Sean - 规格核验
{Tess 跳过时显示 🔁，否则 ✅} Tess - 自动测试
✅ Alex - 代码提交
{Vera 跳过时显示 🔁，否则 ✅} Vera - 质量审查
✅ Alex - 提交发布

💡 建议执行 /acs-develop-review 对本次研发过程进行回顾

[COMPLETE]
```

> 跳过判定的内部依据（仅 Alex 内部使用，不输出给用户）：Tess 跳过 = state.md frontmatter `stage_5_status == "skipped"`；Vera 跳过 = `stage_7_status == "skipped"`。判定结果以表情符号体现，**禁止**在面板中出现字段名。

---

## 错误处理

| 情况 | 处理 |
|------|------|
| push 失败（权限） | 报错终止（BLOCKED） |
| push 失败（网络） | 重试 3 次后报错终止（BLOCKED） |
| PR 创建失败 | 输出手动创建命令，标记结果，不阻断 |
| huoban-cli 不可用 | 记录跳过 Step 3 |
| platform 无法推断 | 记录跳过 Step 3 |
| module_id 自动推断失败 | 记录跳过 Step 3（不询问用户） |
| sprint module add 失败 | 记录 warning，不阻断 |
| package build 失败 | 记录 warning，不阻断 |
