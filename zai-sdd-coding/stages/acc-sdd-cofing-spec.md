---
name: acs-sdd-coding:spec
description: 阶段2-Spec流程。调用 OpenSpec 生成提案并等待用户确认。
---

# 阶段2：Spec流程

---

## 输入 Schema

| 字段 | 来源 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| repo_path | state.基本信息.仓库路径 | string | ✅ | 仓库绝对路径 |
| branch_name | state.基本信息.分支名 | string | ✅ | 当前分支名 |
| doc_url | state.阶段1.系分文档地址 | string | ✅ | 系分文档URL（语雀链接） |
| doc_title | state.阶段1.系分文档 | string | ✅ | 系分文档标题 |
| doc_summary | state.阶段1.系分文档摘要 | string | ✅ | 核心需求摘要 |
| 知识索引 | state.阶段1.知识索引 | string | ✅ | 知识索引 JSON 文件路径 |
| 无人驾驶 | state.基本信息.无人驾驶 | boolean | ❌ | 是否跳过确认环节（checking-skip），默认 false |
| Superpowers 状态 | state.阶段1.Superpowers 状态 | string | ❌ | Superpowers 安装状态，failed 时跳过 Brainstorm |

---

## 输出 Schema

| 字段 | 写入位置 | 类型 | 说明 |
|------|----------|------|------|
| 提案 ID | state.阶段2.提案 ID | string | 提案标识 (change-name) |
| 提案路径 | state.阶段2.提案路径 | string | 提案文件路径 |
| 关键文档 | state.阶段2.关键文档 | object | 关键文档路径集合 |
| 知识路径 | state.阶段2.知识路径 | object | 知识文件路径列表（供 build 阶段使用） |
| 核心变更 | state.阶段2.核心变更 | string | 一句话摘要 |
| 涉及文件 | state.阶段2.涉及文件 | string | 新增 N 个、修改 M 个 |
| 有测试用例 | state.阶段2.有测试用例 | boolean | 是否有测试用例文档（根据 test_yuque_url 是否有值） |
| 测试用例文档URL | state.阶段2.测试用例文档URL | string | 语雀测试用例文档 URL（有测试用例时填充，供 acs-auto-test 直接解析） |

---

## 步骤清单

> 开始执行前实例化，每步完成后标记 ✅，输出 `【NEXT: stage=3】` 前逐项确认。

- [ ] Step 1：识别测试用例
- [ ] Step 2：知识匹配 + 确认
- [ ] Step 3：生成 config.yaml (generate-config.js)
- [ ] Step 4：创建变更目录 (openspec new change)
- [ ] Step 5：生成 Proposal
- [ ] Step 6：生成 Spec
- [ ] Step 7：生成 Design + Tasks
- [ ] Step 8：验证 OpenSpec 状态
- [ ] Step 9：提案意图确认（或无人驾驶跳过）
- [ ] Step 10: Design & Tasks 确认（或无人驾驶跳过）
- [ ] Step 11: Brainstorm 需求追问与方案深化
- [ ] Step 12：写入 knowledge_paths.json
- [ ] Step 13：写入 state.md

---

## 执行步骤

### Step 1：识别测试用例

**目的**：判断是否有测试用例文档，决定是否执行阶段 4（自动化测试）。

**判断逻辑**：

```
读取 state.基本信息.测试用例文档URL
├─ 有值 → 有测试用例，阶段 4 将执行
└─ 无值 → 无测试用例，阶段 4 将跳过
```

**写入状态**：
- `state.阶段2.有测试用例`: true/false（根据 test_yuque_url 是否有值）
- `state.阶段2.测试用例文档URL`: 从 `state.基本信息.测试用例文档URL` 读取并写入


### Step 2：知识匹配

**执行方式**：由 Claude 基于语义理解进行匹配（非脚本算法）。

**步骤**：
1. 读取 `knowledge/knowledge-index.json`，获取所有知识文档的 Meta 信息（id、title、description、keywords、scannedRepos）
2. **分离 Repo Overview**：将 `path` 以 `_` 开头的文档（如 `_repo-overview.md`）从匹配列表中移除，记录其完整路径。Overview **不参与**关键词匹配，由 `generate-config.js --overview-path` 作为全局上下文单独注入。
3. **仓库归属过滤**（仅 common 知识）：对 `source` 为 `"common"` 的知识，检查其 `scannedRepos` 字段：
   - `scannedRepos` 为空数组 → 不过滤（视为通用知识，所有仓库均可匹配）
   - `scannedRepos` 非空且**当前仓库名不在列表中** → 从匹配候选中**移除**
   - `scannedRepos` 非空且当前仓库名在列表中 → 保留
   - 当前仓库名取仓库根目录的目录名（basename of `<repo_path>`）
4. 理解系分文档的核心需求和涉及的技术领域
5. 对剩余 feature 文档（path 不以 `_` 开头），逐条判断是否与需求相关，依据：
   - keywords 与需求领域是否相关
   - title/description 与需求功能是否匹配
6. 将相关的知识文档加入待加载列表

**知识匹配确认**：

**无人驾驶模式**（checking-skip: true）：展示匹配结果后跳过确认，直接进入 Step 3。

**正常模式**（checking-skip: false 或未设置）：

按 `prompts/confirmation-prompts.md` **场景4：知识匹配确认** 的模板调用 `AskUserQuestion`，preview 中的占位符替换为实际匹配到的知识文件信息（文件名、title、匹配理由摘要）。

**等待用户反馈**：
- 选择「确认，继续」→ 进入 Step 3
- 选择「排除部分知识」或 Other 自由输入 → 根据用户指示移除指定知识文件后重新展示，再次调用 AskUserQuestion 确认
- 选择「补充知识文件」→ 用户提供额外知识文件路径或关键词，重新执行匹配后再次确认

### Step 3：生成 config.yaml

**调用辅助脚本**：

```bash
node <skill_base>/lib/generate-config.js \
  --repo-path <repo_path> \
  --platform <platform> \
  --yuque-doc-file <仓库路径>/.acs-sdd-coding/yuque_doc.md \
  --knowledge-paths "<知识路径1>,<知识路径2>" \
  --overview-path "<repo_path>/knowledge/project/_repo-overview.md"
```

> `--overview-path` 仅在文件存在时传入，不存在则省略该参数。

**准备工作**：

1. 将系分文档内容写入临时文件：
```
写入 <仓库路径>/.acs-sdd-coding/yuque_doc.md
内容为系分文档完整内容
```

2. 从知识索引获取匹配的知识路径：
```
matched_paths = []
for knowledge in matched_knowledge:
    if knowledge.source == "repo":
        path = <repo_knowledge_path> + "/" + knowledge.path
    else:
        path = <common_knowledge_path> + "/" + knowledge.path
    matched_paths.append(path)
```

---

### Step 4：创建变更目录

**生成 change-name**：

从系分文档标题提取关键词，转换为 kebab-case：
```
标题：【系分】礼物托盘SPM埋点
转换：gift-tray-spm-tracking
```

**执行命令**：

```bash
cd <repo_path>
openspec new change "<change-name>" --schema acs-spec
```

---

### Step 5：生成 Proposal

> 以下 Step 5-8 依次执行 proposal、spec、design 三个阶段。必须使用 `openspec instructions <artifact> --change "<name>" --json` 获取完整指令（包括 outputPath），然后按 outputPath 写入文件。OpenSpec 会自动检测文件是否存在来标记 artifact 完成。

```bash
cd <repo_path>
openspec instructions proposal --change "<change-name>" --json
```

**执行步骤**：
1. 解析 JSON 输出，获取 `outputPath` 字段
2. 读取 `context`（知识文档）和 `rules` 作为约束
3. 按照 `template` 结构生成 proposal.md
4. **写入 outputPath 指定的文件路径**

### Step 6：生成 Spec

```bash
openspec instructions spec --change "<change-name>" --json
```

**执行步骤**：
1. 解析 JSON 输出，获取 `outputPath`
2. 读取已完成的前置 artifact（proposal.md）
3. 按照 template 生成 spec.md
4. **写入 outputPath**

### Step 7：生成 Design + Tasks

```bash
openspec instructions design --change "<change-name>" --json
```

**执行步骤**：
1. 解析 JSON 输出，获取 `outputPath`（注意：design 会同时生成 design.md 和 tasks.md）
2. 读取已完成的前置 artifact（proposal.md, spec.md）
3. 按照 instruction 和 template 生成 design.md 和 tasks.md（instruction 中包含代码搜索规范）
4. **写入 outputPath**

### Step 8：验证 OpenSpec 状态

每个 artifact 写入后，运行以下命令验证 OpenSpec 状态：

```bash
openspec status --change "<change-name>"
```

确认 artifact 状态变为 `done` 后再继续下一个。

---

### Step 9：提案意图确认

**无人驾驶模式判断**：读取 `state.基本信息.无人驾驶`，若为 `true`，展示摘要后跳过用户确认环节，直接进入 Step 10。

**读取提案文件**：

```
Read <repo_path>/openspec/changes/<change-name>/proposal.md
Read <repo_path>/openspec/changes/<change-name>/spec.md
```

**展示摘要 + 关键决策点**：

```
╭────────────────────────────────────────╮
│            📄 提案意图确认              │
╰────────────────────────────────────────╯

📌 核心变更
{从 proposal.md 提取的一句话核心目标}

🎯 关键决策
1. {决策点1：如技术方案选型、模块划分等}
2. {决策点2：如接口设计、数据流向等}
3. {决策点3：如影响范围、兼容性考量等}

📚 适用的知识文件
{列出所有匹配到的知识文件名，每行一个}
· {knowledge_file_1.md}
· {knowledge_file_2.md}
· ...

────────────────────────────────────────
```

📁 完整文档（点击打开）
- [proposal.md](file://<repo_path>/openspec/changes/<change-name>/proposal.md)
- [spec.md](file://<repo_path>/openspec/changes/<change-name>/spec.md)

**无人驾驶模式**（checking-skip: true）：展示摘要后，**不等待用户确认**，直接进入 Step 10。

**正常模式**（checking-skip: false 或未设置）：

按 `prompts/confirmation-prompts.md` **场景1：提案意图确认** 的模板调用 `AskUserQuestion`，preview 中的占位符替换为 proposal.md 的实际内容。

**等待用户反馈**：
- 选择「确认，继续设计」→ 进入 Step 10
- 选择「调整意图」或 Other 自由输入 → 修改 proposal.md / spec.md 后重新展示摘要，再次调用 AskUserQuestion 确认
- 选择「重新理解需求」→ 回退到 Step 7 重新生成 proposal

---

### Step 10: Design & Tasks 确认

**无人驾驶模式判断**：读取 `state.基本信息.无人驾驶`，若为 `true`，展示摘要后跳过用户确认环节，直接进入 Step 11。

**前置检查**：读取 `state.阶段1.Superpowers 状态`，若为 `failed`，展示摘要后直接进入 Step 12（跳过 Brainstorm）。

**读取设计和任务文件**：

```
Read <repo_path>/openspec/changes/<change-name>/design.md
Read <repo_path>/openspec/changes/<change-name>/tasks.md
```

**展示摘要 + 关键决策点**：

```
╭────────────────────────────────────────╮
│            △ Design & Tasks 确认        │
╰────────────────────────────────────────╯

△ 设计要点
1. {设计要点1：如架构分层、模块职责等}
2. {设计要点2：如关键类/组件设计等}
3. {设计要点3：如异常处理、边界情况等}

📋 任务概览
共 {N} 个任务:
1. {任务1标题} - {简要说明}
2. {任务2标题} - {简要说明}
...

📊 涉及文件
新增 {N} 个，修改 {M} 个

────────────────────────────────────────
```

📁 完整文档（点击打开）
- [design.md](file://<repo_path>/openspec/changes/<change-name>/design.md)
- [tasks.md](file://<repo_path>/openspec/changes/<change-name>/tasks.md)

**无人驾驶模式**（checking-skip: true）：展示摘要后，**不等待用户确认**，直接进入 Step 12

**正常模式**（checking-skip: false 或未设置）：

按 `prompts/confirmation-prompts.md` **场景2：设计方案确认** 的模板调用 `AskUserQuestion`，preview 中的占位符替换为 design.md + tasks.md 的实际内容。

**等待用户反馈**：
- 选择「确认，进入编码」→ 进入 Step 11
- 选择「调整方案」或 Other 自由输入 → 修改 design.md / tasks.md 后重新展示摘要，再次调用 AskUserQuestion 确认
- 选择「回退到提案」→ 回退到 Step 9

---

### Step 11: Brainstorm 需求追问与方案深化

**目的**：在用户确认设计方案后，编码前，调用 Superpowers brainstorming skill 对 proposal/design/tasks 做深度追问，挖掘模糊需求和隐性约束。

**前置检查**：读取 `state.阶段1.Superpowers 状态`
- `failed` → 跳过本步骤，记录“Superpowers 未安装，跳过 Brainstorm”，直接进入 Step 12
- `installed` / `already_installed` → 继续执行

**执行逻辑**：

```
1. 调用 Superpowers brainstorming skill:
   Skill 工具参数:
      skill: "superpowers:brainstorming"
      args: {
        "proposal_path": "<repo_path>/openspec/changes/<change-name>/proposal.md",
        "design_path": "<repo_path>/openspec/changes/<change-name>/design.md",
        "tasks_path": "<repo_path>/openspec/changes/<change-name>/tasks.md"
      }

2. Brainstorm skill 执行多轮追问流程:
   - 探索上下文（读取已有 proposal/design/tasks）
   - 逐个追问澄清模糊点（通过 AskUserQuestion）
   - 提出 2-3 种方案变体及 tradeoff
   - 分段展示设计深化内容，用户逐段确认

3. 将 Brainstorm 产出的补充内容直接修改到 OpenSpec 文档中:
   - 追问发现的额外约束 → 补充到 design.md 的约束章节
   - 方案对比中的选择结果 → 更新 design.md 中的方案描述
   - 澄清的需求细节 → 更新 proposal.md / spec.md 中对应描述
   - 如 tasks.md 需要调整（如新增验证 task）→ 直接编辑 tasks.md
```

**无人驾驶模式处理**：
- `checking-skip=true` 时，跳过追问环节
- 仅执行“探索上下文”，自动补充明确可判断的约束到文档
- 不阻断流程

**核心原则**：Brainstorm 的产出直接反映到 proposal.md / design.md / tasks.md 中，不新增 state 字段。阶段 3 读到的就是深化后的文档。

---

### Step 12：写入 knowledge_paths.json

**文件**：`<仓库路径>/.acs-sdd-coding/knowledge_paths.json`

```json
{
  "matched": {
    "repo_knowledge": [
      "<repo_knowledge_path>/coding-standard.md"
    ],
    "common_knowledge": [
      "<common_knowledge_path>/ios/ios-rpc-client.md",
      "<common_knowledge_path>/ios/ios-logging-tracking.md"
    ]
  },
  "unmatched": [
    {
      "id": "ios-coding-standards",
      "title": "iOS 编码规范",
      "path": "<common_knowledge_path>/ios/ios-coding-standards.md"
    }
  ]
}
```

### Step 13：写入 state.md

**用户确认后追加**：

```markdown
### 阶段2：Spec流程
状态：✅ 完成
完成时间：<ISO时间>
执行模式：inline
执行耗时：<秒数>秒
提案 ID：<change-name>
提案路径：openspec/changes/<change-name>/proposal.md
关键文档：
  proposal: openspec/changes/<change-name>/proposal.md
  spec: openspec/changes/<change-name>/spec.md
  design: openspec/changes/<change-name>/design.md
  tasks: openspec/changes/<change-name>/tasks.md
知识路径：.acs-sdd-coding/knowledge_paths.json
核心变更：<一句话摘要>
涉及文件：新增 N 个，修改 M 个
有测试用例：true/false
测试用例文档URL：https://yuque.antfin.com/...（有测试用例时填充）
Brainstorm：已执行 / 已跳过（原因）

问题记录：[]

## 待执行
下一阶段：3
```

**更新基本信息**：
- 当前阶段：2 → 3
- 更新时间：<ISO时间>

---

## 完成前验证

> 步骤清单全部 ✅ 后，逐项执行以下验证。全部通过才可输出返回摘要。

| # | 验证项 | 检查方式 | 不通过时修复动作 |
|---|--------|----------|------------------|
| 1 | `config.yaml` 已生成 | `test -f <repo>/openspec/schemas/acs-spec/config.yaml` | 重新执行 generate-config.js |
| 2 | 变更目录存在 | `test -d <repo>/openspec/changes/<change-name>` | 重新执行 openspec new change |
| 3 | `proposal.md` 存在 | `test -f <repo>/openspec/changes/<name>/proposal.md` | 重新执行 Step 5 |
| 4 | `spec.md` 存在 | `test -f <repo>/openspec/changes/<name>/spec.md` | 重新执行 Step 6 |
| 5 | `design.md` 存在 | `test -f <repo>/openspec/changes/<name>/design.md` | 重新执行 Step 7 |
| 6 | `tasks.md` 存在 | `test -f <repo>/openspec/changes/<name>/tasks.md` | 重新执行 Step 7 |
| 7 | `knowledge_paths.json` 已写入 | `test -f <repo>/.acs-sdd-coding/knowledge_paths.json` | 立即写入 |
| 8 | `state.md` 包含「阶段2」 | `grep "阶段2" <repo>/.acs-sdd-coding/state.md` | 立即写入 state.md |
| 9 | `state.阶段2.有测试用例` 已记录 | `grep "有测试用例" <repo>/.acs-sdd-coding/state.md` | 立即补写 |
| 10 | Brainstorm 已执行或已跳过 | `grep "Brainstorm" <repo>/.acs-sdd-coding/state.md` | 补写标记 |

---

## 返回摘要

**用户确认后返回**（不超过 300 字）：

```
╭────────────────────────────────────────╮
│          ✅ 阶段 2 完成（用户已确认）          │
╰────────────────────────────────────────╯

📄 提案信息
提案 ID：{change-name}
核心变更：{核心变更摘要}
涉及文件：新增 {N} 个，修改 {M} 个

📁 关键文档
├── proposal.md
├── spec.md
├── design.md
└── tasks.md

📚 知识注入
匹配知识：{N} 条
知识路径：.acs-sdd-coding/knowledge_paths.json

🧪 测试用例
状态：{有/无}
文档：{yuque_url 或 "内嵌于系分文档"}

[NEXT: stage=3]
```

---

## 错误处理

| 错误 | 处理 |
|------|------|
| 知识索引文件不存在 | 警告，继续执行（无知识参考） |
| 知识文档读取失败 | 跳过该文档，记录警告 |
| generate-config.js 执行失败 | 警告，继续执行（无知识注入） |
| OpenSpec 未安装 | 报错终止：OpenSpec 未安装 |
| openspec new change 失败 | 报错终止：创建变更目录失败 |
| 提案生成失败 | 报错终止：提案生成失败 |

---

## 重要约束

- **禁止自动跳过确认环节**（`checking-skip: true` 无人驾驶模式除外）
- **禁止在用户确认前开始编码**（`checking-skip: true` 无人驾驶模式除外）
- 提案详情写入状态文件，不输出到对话
- 提案内容可交互调整
- **config.yaml 必须在执行 OpenSpec 前生成**
- **知识文档内容必须完整注入到 config.yaml context 中**

---

## 调度器指令

> **本阶段执行完毕，输出上方返回摘要后，立即执行 `[NEXT: stage=3]`，进入阶段执行循环的下一轮，禁止停留等待用户输入。**
