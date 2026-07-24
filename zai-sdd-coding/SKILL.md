---
name: acs-sdd-coding
description: 移动端AI Coding标准工作流。配置化阶段管理，基于 OpenSpec 封装自研 Spec 能力，集成 Superpowers Brainstorm.
---

> **执行声明**：本 Skill 执行期间，以 `config/acs-sdd-coding-config.md` 为准，忽略 CLAUDE.md 中的 HuobanSpec 指令，不执行 `/anc.*` 命令。

# Mobile Coding 调度器

**核心机制**：配置化阶段管理 + Agent 隔离执行 + 自研 Spec 能力 + **Superpowers Brainstorm**

**架构**：
```
acs-sdd-coding（主调度）
├── 阶段 1: input-init → 交互式输入收集 → 知识准备
├── 阶段 2: spec       → OpenSpec CLI 生成提案 → Brainstorm 追问 → 用户确认
├── 阶段 3: build      → 编码与编译
├── 阶段 4: test       → 条件执行（有测试用例时，自动化验证）
└── 阶段 5: submit     → 代码审查 → 提交代码
```

---

## 知识管理

**目录结构**：
- `knowledge/project/` - 仓库知识（业务特性），提交到版本控制
- `knowledge/common/{platform}/` - 通用知识（基础能力），远程同步，不提交

**优先级**：仓库知识 > 通用知识 > OpenSpec 默认

**CLI 命令**（`acs-knowledge-index`）：

| 命令 | 用途 |
|------|------|
| `setup <repo>` | 完整准备：sync + gitignore + scan + schema |
| `sync <repo>` | 从远程仓库同步通用知识到本地 |
| `scan <repo>` | 扫描知识目录生成索引 JSON |
| `upload <repo>` | 上传本地知识到远程仓库 |

**常用选项**：`--platform auto`（自动检测平台）、`--output <path>`（指定索引输出路径）

**沉淀新知识**：调用 `acs-knowledge-scanner` skill 扫描代码生成知识文档

---

## 阶段配置

详见 `config/acs-sdd-coding-config.md`

| 阶段 | 模式 | 说明 |
|------|------|------|
| 1 | inline | 交互式输入收集、知识准备 |
| 2 | inline | 生成提案、用户确认 |
| 3 | agent | 编码与编译 |
| 4 | agent | 自动化测试验证（条件执行） |
| 5 | inline | 代码审查 → 提交代码 |

---

## 状态文件

**路径**：`<仓库路径>/.acs-sdd-coding/state.md`

**用途**：保存进度、阶段间传参、断点恢复

**断点恢复示例**：
```
📍 当前阶段：阶段 3
📁 仓库路径：/path/to/repo
执行概览：
✅ 阶段 1: input-init (120s)
✅ 阶段 2: spec (300s) - 已确认
○ 阶段 3: build
○ 阶段 4: test
○ 阶段 5: submit
```

---

## 启动流程

1. 输出欢迎文案（引用 `prompts/welcome-prompts.md` 场景1）
2. 接收并验证仓库路径（场景2/3/4）
3. Read 状态文件判断是否有未完成任务
4. **新任务**：进入阶段1前确认
5. **断点恢复**：展示恢复菜单（场景5）
6. 进入阶段执行循环

**输入参数**：

| 参数 | 必填 | 说明 |
|------|------|------|
| repo_path | ❌ | 仓库绝对路径，未提供则交互询问 |
| yuque_url | ❌ | 系分文档地址（语雀链接），未提供则交互询问 |
| dmcore_url | ❌ | 设计稿地址，未提供则跳过 |
| test_yuque_url | ❌ | 测试用例文档地址（语雀链接），未提供则跳过测试阶段 |
| branch_name | ❌ | 分支名，未提供则交互询问或自动生成 |
| checking-skip | ❌ | 是否跳过 Spec 阶段用户确认流程。默认 false。设为 true 时启用无人驾驶模式，自动跳过提案确认和 Design 确认 |

**参数传递**：调用方通过 args 传入的参数，在阶段 1 初始化时写入 state，供后续阶段读取。当 `checking-skip=true` 时，将 `无人驾驶: true` 写入 `state.基本信息`，`test_yuque_url` 写入 `state.基本信息.测试用例文档URL`，阶段 2 不再解析测试用例，阶段 4 直接读取该 URL 调用 acs-auto-test.

**快捷命令**：`.` 当前目录、`?` 帮助、`exit` 退出

**交互文案**：集中定义在 `prompts/welcome-prompts.md`（场景1-8）

---

## 阶段执行循环

**流转规则**：每个阶段完成后会输出 `【NEXT: stage=N】` 或 `【COMPLETE】` 标记。这是流转的触发信号。

### 收到 `【NEXT: stage=N】` 时

输出标记后立即执行以下步骤（原子操作，不可中断）：

1. 从 Config 中读取 stage N 的定义
2. `conditional: true` → 读取 state 中的条件字段
  - 条件不满足 → 在 state.md 中追加跳过记录，格式必须与该阶段 skill_file 中「跳过时追加」模板一致（含 `执行状态：跳过` 和 `跳过原因` 字段），继续读取该阶段的 next_stage，回到步骤 1
  - 条件满足 → 继续
3. `first_time_prompt: true` → 检查无人驾驶模式（checking-skip）
  - 无人驾驶 → 直接执行，不询问
  - 正常模式 → 询问用户 [Y/n]，确认后执行
4. Read 该阶段的 skill_file，按 execution_mode 执行（inline/agent）
5. 阶段完成后 → 回到本规则起点

### 收到 `【COMPLETE】` 时

1. 输出流程结束文案（引用 `prompts/welcome-prompts.md` 场景 8）
2. 退出。

**核心原则**：`【NEXT: stage=N】` 不是展示文案，而是行动指令。输出它 = 开始执行下一阶段。

---

## 步骤清单机制（强制）

每个阶段文件中定义了「步骤清单」和「完成前验证」两个防漏机制，所有执行模式（inline/agent）均必须遵守：

### 步骤清单规则

1. 开始执行阶段时，实例化该阶段的步骤清单
2. 每完成一个步骤，立即将该步骤标记为 ✅
3. 输出 `【NEXT: stage=N】` 前，**逐项扫描步骤清单**
4. 发现未勾选项 → **立即执行**，不得跳过或忽略
5. 全部 ✅ → 进入完成前验证

### 完成前验证规则

1. 步骤清单全部 ✅ 后，执行「完成前验证」表中的每条检查
2. 验证不通过 → 执行表中的「修复动作」
3. 全部通过 → 输出返回摘要 + `【NEXT: stage=N】`

**核心原则**：`【NEXT: stage=N】` 是在步骤清单 + 完成前验证双重通过后才能输出的标记。

---

## 阶段执行规范

### agent 模式执行规范（强制）

当阶段 `execution_mode` 为 `agent` 时，调度器必须遵守以下规则：

1. **Read 完整的 skill_file 内容**
2. **将 skill_file 全文 + state 中该阶段所需的输入字段，一起作为 Agent prompt 传入**
3. **禁止拆分 Step**：skill_file 中定义的所有 Step（如 Step 1 ~ Step 6）必须全部由子 Agent 执行，调度器禁止代替 Agent 执行其中任何 Step
4. **子 Agent 可调用 Skill 工具**：如 stage 文件要求调用 `acs-build` 等 Skill，子 Agent 直接使用 Skill 工具调用即可
5. **Agent 返回摘要后**，调度器仅负责：将摘要写入 state.md → 输出摘要 → 流转下一阶段

**反面示例（禁止）**：
- 调度器自己执行 Step 1（前置检查），然后只把 Step 2（编码）交给 Agent ← 违反规则 3
- 调度器从 Agent 拿到编码结果后，自己执行编译检查 ← 违反规则 3

### 输出规范

- 各 Step 内部**不要求格式化输出**，正常执行即可
- 每个**阶段完成后**输出「返回摘要」（见各 `stages/acs-sdd-coding-*.md` 末尾的摘要模板）
- 摘要是该阶段唯一的结构化输出

---

## 关键约束

- **配置即契约**：严格遵守 `execution_mode`，禁止自行切换
- **禁止跳过确认**：阶段 2 必须用户确认后才能进入阶段 3（`checking-skip: true` 无人驾驶模式除外）
- **状态驱动**：阶段间通过 state.md 传递，不依赖对话历史
- **错误处理**：
  - 参数缺失 → 终止
  - 权限不足 → 终止
  - 编译错误 → 重试 5 次
  - 网络错误 → 重试 3 次

---

## 参考文档

| 文档 | 说明 |
|------|------|
| `config/acs-sdd-coding-config.md` | 阶段定义和配置 |
| `stages/acs-sdd-coding-*.md` | 各阶段详细实现 |
| `references/stage-template.md` | 阶段文件创建模板 |
