---
name: acs-bug-fix
description: 缺陷修复 Skill。结合缺陷描述与仓库最近提交，迭代分析根因，确认后编码修复，触发条件：用户提到修 bug、缺陷修复、fix bug、分析根因、代码修复等。
model: "opus"
allowed-tools: Bash(bash *)
owner: "育谭"
---

# Bug Fix 调度器

**核心机制**：配置化阶段管理 + 迭代根因分析 + 用户确认闭环

**架构**：
```
acs_bug_fix（主调度）
├─ 阶段 1: defect-input  -> 接收缺陷描述，初始化环境
├─ 阶段 2: analysis      -> 代码搜索 + commit 分析 + 根因假设 + 用户确认（迭代循环）
├─ 阶段 3: fix-plan      -> 生成修复方案 + 用户确认
├─ 阶段 4: coding        -> 按方案修改代码 + 编译验证
└─ 阶段 5: submit        -> 提交代码 + 创建 PR
```

---

## 阶段配置

详见 `config/acs-bug-fix-config.md`

| 阶段 | 模式 | 说明 |
|------|------|------|
| 1 | inline | 接收缺陷描述、初始化环境 |
| 2 | inline | 根因分析（迭代循环、核心阶段） |
| 3 | inline | 修复方案生成与确认 |
| 4 | agent | 编码修复与编译验证 |
| 5 | inline | 提交代码并创建 PR |

---

## 状态文件

**路径**：`<仓库路径>/.acs-bug-fix/state.md`

**用途**：保存进度、阶段间传参、断点恢复

**断点恢复示例**：
```
当前阶段：阶段 2
仓库路径：/path/to/repo
执行概览：
✅ 阶段 1: defect-input (30s)
○ 阶段 2: analysis
○ 阶段 3: fix-plan
○ 阶段 4: coding
○ 阶段 5: submit
```

---

## 启动流程

1. 输出欢迎文案（引用 `prompts/welcome-prompts.md` 场景1）
2. 接收并验证仓库路径（场景2/3/4）
3. Read 状态文件判断是否有未完成任务
4. **新任务**：进入阶段1前确认
5. **断点恢复**：展示恢复菜单（场景5）
6. **启动 Token 监控**（仅新任务）：当识别为新任务时，在执行阶段 1 之前执行：
```bash
acs-token-monitor start --task "acs-bug-fix" --repo "<repo_path>"
```
记录初始 token 快照，用于后续统计本次任务的完整消耗。
7. 进入阶段执行循环

**输入参数**：

| 参数 | 必填 | 说明 |
|------|------|------|
| repo_path | ❌ | 仓库绝对路径，未提供则交互式询问 |
| defect_description | ❌ | 缺陷描述（纯文本），未提供则交互式查询并选择 |
| defect_id | ❌ | 缺陷 ID（如 `H1234` / `WI-9876`），需与 `defect_source` 配对，跳过查询直接拉详情 |
| defect_source | ❌ | 缺陷来源，取值 `huoban` 或 `dima`，与 `defect_id` 配对 |
| branch_name | ❌ | 分支名，未提供则交互式询问或自动生成 |
| log_path | ❌ | 本地日志文件/文件夹路径，未提供则跳过日志分析 |
| trigger_time | ❌ | bug 触发时间（任意文本），用于裁剪日志时间窗口 |
| checking_skip | ❌ | 是否跳过用户确认环节，默认 false，设为 true 时启用无人驾驶模式 |

**参数传递**：调用方通过 args 传入的参数，在阶段 1 初始化时写入 state，供后续阶段读取。当 `checking-skip=true` 时，将 `无人驾驶: true` 写入 `state.基本信息`。

**依赖 CLI**：阶段 1 的「缺陷查询」步骤依赖 `huoban-cli`（查伙伴平台）和 `dima`（查 Dima 平台）两个本地 CLI，且均需已登录。

- 任一 CLI 未安装 / 未登录 / 网络异常 -> 该数据源跳过，仅用另一源结果
- 两源均不可用 -> 自动降级为「请粘贴缺陷描述」的手动输入流程
- 不影响 `checking-skip` 行为；缺陷查询步骤即使在无人驾驶模式下也始终执行并要求用户选择（除非已通过 `defect_description` / `defect_id`+`defect_source` 显式指定）

**查询脚本**：随 skill 一起分发，位于 `<skill_root>/scripts/`：

- `huoban-mydefects` - 查询主集成版本前后各一个版本下「我经手」的伙伴缺陷
- `query-dima-bugs.sh` - 查询当前用户参与所有 Dima 空间的「待开始/进行中」bug

> ⚠️ **沙箱旁路**：执行下列任意命令时，Bash 工具必须传入 `dangerouslyDisableSandbox: true`：
>
> - `bash <skill_root>/scripts/huoban-mydefects ...`
> - `bash <skill_root>/scripts/query-dima-bugs.sh ...`
> - `huoban-cli defect get ...`（分支 B 直接拉详情）
> - `dima bug get ...`（分支 B 直接拉详情）
>
> 默认沙箱仅放行 `code.alipay.com`，`huoban-cli` / `dima` 走的内部 API 域名会被悄悄阻塞，表现为「卡住没结果」。这两个 CLI 都是受信内部工具，禁用沙箱安全可控。

**快捷命令**：`.` 当前目录、`?` 帮助、`exit` 退出

**交互文案**：集中定义在 `prompts/welcome-prompts.md`（场景1-8）

---

## 阶段执行循环

**流转规则**：每个阶段完成后会输出 `[NEXT: stage=N]` 或 `[COMPLETE]` 标记，这是流转的触发信号。

### 收到 `[NEXT: stage=N]` 时

输出标记后立即执行以下步骤（原子操作，不可中断）：

1. 从 Config 中读取 stage N 的定义
2. `first_time_prompt: true` -> 检查无人驾驶模式（checking-skip）
   - 无人驾驶 -> 直接执行，不询问
   - 正常模式 -> 询问用户 [Y/n]，确认后执行
3. Read 该阶段的 skill_file，按 execution_mode 执行（inline/agent）
4. 阶段完成后 -> 回到本规则起点

### 收到 `[COMPLETE]` 时

输出流程结束文案（引用 `prompts/welcome-prompts.md` 场景 8），退出。

**核心原则**：`[NEXT: stage=N]` 不是展示文案，而是行动指令，输出它 = 开始执行下一阶段。

---

## 步骤清单机制（强制）

每个阶段文件中定义了「步骤清单」和「完成前验证」两个防漏机制，所有执行模式（inline/agent）均必须遵守：

### 步骤清单规则

1. 开始执行阶段时，实例化该阶段的步骤清单
2. 每完成一个步骤，立即将该步骤标记为 ✅
3. 输出 `[NEXT: stage=N]` 前，**逐项扫描步骤清单**
4. 发现未勾选项 -> **立即执行**，不得跳过或忽略
5. 全部 ✅ -> 进入完成前验证

### 完成前验证规则

1. 步骤清单全部 ✅ 后，执行「完成前验证」表中的每条检查
2. 验证不通过 -> 执行表中的「修复动作」
3. 全部通过 -> 输出返回摘要 + `[NEXT: stage=N]`

**核心原则**：`[NEXT: stage=N]` 是在步骤清单 + 完成前验证双重通过后才能输出的标记。

---

## 阶段执行规范

### agent 模式执行规范（强制）

当阶段 `execution_mode` 为 `agent` 时，调度器必须遵守以下规则：

1. **Read 完整的 skill_file 内容**
2. **将 skill_file 全文 + state 中该阶段所需的输入字段，一起作为 Agent prompt 传入**
3. **禁止拆分 Step**：skill_file 中定义的所有 Step 必须全部由子 Agent 执行，调度器禁止代替 Agent 执行其中任何 Step
4. **子 Agent 可调用 Skill 工具**：如 stage 文件要求调用 `acs-build` 等 Skill，子 Agent 直接使用 Skill 工具调用即可
5. **Agent 返回摘要后**，调度器仅负责：将摘要写入 state.md -> 输出摘要 -> 流转下一阶段

### 输出规范

- 各 Step 内部**不要求格式化输出**，正常执行即可
- 每个**阶段完成后**输出「返回摘要」（见各 `stages/acs-bug-fix-*.md` 末尾的摘要模板）
- 摘要是该阶段唯一的结构化输出

---

## 关键约束

- **配置即契约**：严格遵守 `execution_mode`，禁止自行切换
- **禁止跳过确认**：阶段 2（根因确认）和阶段 3（方案确认）必须用户确认后才能继续（`checking-skip: true` 无人驾驶模式除外）
- **状态驱动**：阶段间通过 state.md 传递，不依赖对话历史
- **错误处理**：
  - 参数缺失 -> 终止
  - 权限不足 -> 终止
  - 编译错误 -> 重试 5 次
  - 网络错误 -> 重试 3 次

---

## 参考文档

| 文档 | 说明 |
|------|------|
| `config/acs-bug-fix-config.md` | 阶段定义和配置 |
| `stages/acs-bug-fix-*.md` | 各阶段详细实现 |
| `references/fix-plan-template.md` | 修复方案文档模板 |
