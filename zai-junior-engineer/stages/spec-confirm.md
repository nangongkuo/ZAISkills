---
name: spec-confirm
execution_mode: inline
action: Spec 锁定
---

# Spec 确认配置

> **P3 待办**：本文件 Step 9a / 9b / 10 / 11 的 `task_type=feature` / `task_type=bugfix` 硬分支应改为读 `abilities/<task_type>.md` 的 `spec_confirm_mode`（dual-confirm / merged-single）与 `spec_confirm_brainstorm_when`（always / never / complexity != simple）。当前保留是为了等加第 3 个 ability 验证 schema 完备性，避免按 feature/bugfix 两个样本设计 schema 漏字段。关联：`lib/validate-state.js` 的 `isBugfix` 硬编码同样在 P3 范围。

在执行 Alex（Spec 锁定，inline 模式）时使用此配置。

## 目的

基于 Will 输出的增强系分，通过 OpenSpec CLI 完整链路生成提案、规范、设计和任务，经过**两次用户确认**和 Brainstorm 深化后方可进入编码。

## 输入

| 字段 | frontmatter key | 类型 | 必填 | 说明 |
|------|------------------|------|------|------|
| 仓库路径 | `repo_path` | string | ✅ | 仓库绝对路径 |
| 分支名 | `branch_name` | string | ✅ | 当前分支名 |
| 任务类型 | `task_type` | string | ✅ | `feature` / `bugfix`，决定确认次数与 Brainstorm 策略 |
| 系分文档 URL | `stage_1_doc_url` | string | ✅ | 系分文档 URL（task_type=bugfix 时为 `local://<path>`） |
| 系分文档标题 | `stage_1_doc_title` | string | ✅ | 系分文档标题 |
| 系分文档摘要 | `stage_1_doc_summary` | string | ✅ | 核心需求摘要 |
| 增强系分内容 | `stage_1_enhanced_spec` | string | ✅ | 增强后的系分文档（本地文件路径或内容） |
| 知识索引 | - | string | 内部解析 | 固定路径 `<repo_path>/knowledge/knowledge-index.json`，不依赖上游透传；不存在时 Step 2.0 自动 scan 生成 |
| 复杂度 | `stage_1_complexity` | string | task_type=bugfix 时 | `simple` / `medium` / `complex`，bugfix 模式下决定是否执行 Brainstorm |
| 测试用例文档 URL | `test_yuque_url` | string | ❌ | 测试用例文档 URL |
| 无人驾驶 | `autopilot` | boolean | ❌ | 是否跳过确认，默认 false |
| 设计稿 | `dmore_url` | string | ❌ | 设计稿地址 |

## 输出

| 字段 | frontmatter key | 类型 | 说明 |
|------|------------------|------|------|
| 提案 ID | `stage_2_proposal_id` | string | 提案标识（change-name） |
| 提案路径 | `stage_2_proposal_path` | string | 提案文件路径 |
| 关键文档 proposal | `stage_2_key_docs_proposal` | string | proposal.md 路径 |
| 关键文档 spec | `stage_2_key_docs_spec` | string | spec.md 路径 |
| 关键文档 design | `stage_2_key_docs_design` | string | design.md 路径 |
| 关键文档 tasks | `stage_2_key_docs_tasks` | string | tasks.md 路径 |
| 知识路径 | `stage_2_knowledge_paths` | string | knowledge_paths.json 路径 |
| 核心变更 | `stage_2_core_change` | string | 一句话摘要 |
| 涉及文件 | `stage_2_affected_files` | string | 新增 N 个、修改 M 个 |
| 有测试用例 | `stage_2_has_test_cases` | boolean | 是否有测试用例文档 |
| 测试用例文档 URL | `stage_2_test_yuque_url` | string | 继承 test_yuque_url |
| Brainstorm | `stage_2_brainstorm` | string | `executed` / `skipped` |

---

## 步骤清单

> 开始执行前实例化，每步完成后标记 ✅，回到 PIPELINE_LOOP 前逐项确认。

- [ ] Step 1: 识别测试用例
- [ ] Step 2: 知识匹配 + 确认
- [ ] Step 3: 生成 config.yaml（generate-config.js）
- [ ] Step 4: 创建变更目录（openspec new change）
- [ ] Step 5: 生成 Proposal
- [ ] Step 6: 生成 Spec
- [ ] Step 7: 生成 Design + Tasks
- [ ] Step 8: 验证 OpenSpec 状态
- [ ] Step 9: 用户确认（feature: 提案意图确认 / bugfix: 修复方案最终确认 -- 单次合并）
- [ ] Step 10: Design & Tasks 确认（**仅 task_type=feature 执行**）
- [ ] Step 11: Brainstorm 需求追问与方案深化（**task_type=bugfix 且 complexity=simple 时跳过**）
- [ ] Step 12: 写入 knowledge_paths.json
- [ ] Step 13: 写入 state.md

---

## 执行步骤

### Step 1: 识别测试用例

**目的**：判断是否有测试用例文档，决定是否执行 Tess 的自动测试。

**判断逻辑**:
```
读取 state.md frontmatter 的 `test_yuque_url`
├─ 非空 -> 有测试用例，Tess 的自动测试将执行
└─ 空 -> 无测试用例，Tess 的自动测试将跳过
```

**写入 frontmatter**（Step 13 统一写入）：
- `stage_2_has_test_cases`: true/false
- `stage_2_test_yuque_url`: 从 `test_yuque_url` 读取并写入

---

### Step 2: 知识匹配 + 确认

> **知识体系单点消费**：stage 1（Will/Dave）不再生成知识索引或做知识匹配。索引的生成与匹配统一收敛到本步骤。

**执行方式**：由 Claude 基于语义理解进行匹配（非脚本算法）。

#### Step 2.0: 知识索引兜底（确保 index 存在）

知识索引固定路径：`<repo_path>/knowledge/knowledge-index.json`（`acs-cfuse` 启动时通常已生成）。

```bash
test -f <repo_path>/knowledge/knowledge-index.json
```

- **存在** -> 直接进入 Step 2 主流程。
- **不存在** -> 检查并兜底生成：
```bash
which acs-knowledge-index && \
  acs-knowledge-index scan <repo_path> --platform auto \
    --output <repo_path>/knowledge/knowledge-index.json
```
- 用 `scan`（仅生成索引）而非 `setup`（含 sync/gitignore，偏重不必要）。
- CLI 缺失或 scan 失败 -> 警告，降级（无知识注入，跳过 Step 2 匹配，继续后续流程）。

#### Step 2 主流程

**步骤**:
1. 读取 `<repo_path>/knowledge/knowledge-index.json`（Step 2.0 已保证存在），获取所有知识文档的 Meta 信息（id、title、description、keywords、scannedRepos）
2. **分离 Repo Overview**：将 `path` 以 `_` 开头的文档（如 `_repo-overview.md`）从匹配列表中移除，记录其完整路径。Overview **不参与**关键词匹配，由 generate-config.js 的 `--overview-path` 参数单独注入。
3. **仓库归属过滤**（仅 common 知识）：对 `source` 为 `"common"` 的知识，检查其 `scannedRepos` 字段：
   - `scannedRepos` 为空数组 -> 不过滤（视为通用知识）
   - `scannedRepos` 非空且当前仓库名**不在列表中** -> 从候选中移除
   - `scannedRepos` 非空且当前仓库名在列表中 -> 保留
   - 当前仓库名取 `repo_path` 的 basename
4. 理解增强系分的核心需求和涉及的技术领域
5. 对剩余 feature 文档，逐条判断是否与需求相关
6. 将相关文档加入待加载列表

**知识匹配确认**:

**无人驾驶模式**（autopilot: true）：展示匹配结果后跳过确认，直接进入 Step 3。

**正常模式**：使用 AskUserQuestion 工具调用知识匹配确认：

展示匹配到的知识文件列表（文件名、title、匹配理由摘要），提供以下选项：
- **确认，继续** -> 进入 Step 3
- **排除部分知识** -> 根据指示移除后重新确认
- **补充知识文件** -> 用户提供额外路径，重新匹配后确认

---

### Step 3: 生成 config.yaml（含 schema 同步）

**调用脚本**:

```bash
acs-junior config-gen \
  --repo-path <repo_path> \
  --platform <platform> \
  --yuque-doc-file <repo_path>/.acs-junior-engineer/enhanced-spec.md \
  --knowledge-paths "<知识路径1>,<知识路径2>" \
  --overview-path "<repo_path>/knowledge/project/_repo-overview.md"
```

> `--overview-path` 仅在文件存在时传入，不存在则省略。

**自动同步**：脚本会自动将 skill 内置的 `acs-spec` schema 文件（schema.yaml + templates/）同步到 `<repo>/openspec/schemas/acs-spec/`，确保 OpenSpec 能正确解析 schema，无需额外操作。

**准备工作**:
1. 从知识索引 JSON 获取需要传给匹配后的知识路径：
```
index = JSON.parse(Read(<repo_path>/knowledge/knowledge-index.json))
repo_base = index.repoKnowledgePath
common_base = index.commonKnowledgePath
platform = index.platform

matched_paths = []
for knowledge in matched_knowledge:
  if knowledge.source == "repo":
    path = repo_base + "/" + knowledge.path
  else:
    path = common_base + "/" + knowledge.path
  matched_paths.append(path)
```

---

### Step 4: 创建变更目录

**生成 change-name**:

从增强系分文档标题提取关键词，转换为 kebab-case：
```
标题：【系分】礼物托盘 SPM 埋点
转换：gift-tray-spm-tracking
```

**执行命令**:
```bash
cd <repo_path>
openspec new change "<change-name>" --schema acs-spec
```

---

### Step 5-7: 生成 OpenSpec Artifacts

> 必须使用 `openspec instructions <artifact> --change "<name>" --json` 获取完整指令（包括 outputPath），然后按 outputPath 写入文件。OpenSpec 会自动检测文件是否存在来标记 artifact 完成。

**Step 5: 生成 Proposal**
```bash
cd <repo_path>
openspec instructions proposal --change "<change-name>" --json
```
1. 解析 JSON 输出，获取 `outputPath`
2. 读取 `context`（知识文档）和 `rules` 作为约束
3. 按照 `template` 结构生成 proposal.md
4. **写入 outputPath 指定的文件路径**

**Step 6: 生成 Spec**
```bash
cd <repo_path>
openspec instructions spec --change "<change-name>" --json
```
1. 解析 JSON 输出，获取 `outputPath`
2. 读取已完成的前置 artifact（proposal.md）
3. 按照 template 生成 spec.md
4. **写入 outputPath**

**Step 7: 生成 Design + Tasks**
```bash
cd <repo_path>
openspec instructions design --change "<change-name>" --json
```
1. 解析 JSON 输出，获取 `outputPath`（design 会同时生成 design.md 和 tasks.md）
2. 读取已完成的前置 artifact（proposal.md, spec.md）
3. 按照 instruction 和 template 生成 design.md 和 tasks.md
4. **写入 outputPath**

### Step 8: 验证 OpenSpec 状态

所有 artifacts（proposal/spec/design/tasks）生成后，统一验证：
```bash
openspec status --change "<change-name>"
```
确认所有 artifact 状态均为 `done`。如有未完成项，定位问题并重新执行对应 Step。

---

### Step 9: 【用户确认】根据 task_type 分支

**无人驾驶模式**（autopilot: true）：展示摘要后跳过确认，feature 直接进入 Step 10，bugfix 直接进入 Step 11。

---

#### 9a. task_type=feature -- 第一次用户确认：提案意图确认

**读取提案文件**:
```
Read <repo_path>/openspec/changes/<change-name>/proposal.md
Read <repo_path>/openspec/changes/<change-name>/spec.md
```

**展示摘要 + 关键决策点**:

```
📋 提案意图确认

📌 核心变更
{从 proposal.md 提取的一句话核心目标}

🎯 关键决策
1. {决策点1：技术方案选型、模块划分等}
2. {决策点2：接口设计、数据流向等}
3. {决策点3：影响范围、兼容性考量等}

📚 运用的知识文件
・{knowledge_file_1.md}
・{knowledge_file_2.md}
・...

━━━━━━━━━━━━━━━━━━━━━━━━
📁 完整文档
・openspec/changes/<change-name>/proposal.md
・openspec/changes/<change-name>/spec.md
```

**使用 AskUserQuestion**:
- **确认，继续设计** -> 进入 Step 10
- **需要调整** -> 修改 proposal.md / spec.md 后重新展示确认
- **重新理解需求** -> 回退到 Step 5 重新生成 proposal

---

#### 9b. task_type=bugfix -- 修复方案最终确认（合并 9a + 10）

> task_type=bugfix 下用户在 stage 0 已通过 Dave 报告确认过根因，本步骤是修复方案落地为 OpenSpec 后的**唯一一次确认**，合并了原 9a「提案意图」+ 原 10「Design & Tasks」两次确认。

**读取全部 OpenSpec 文件**:
```
Read <repo_path>/openspec/changes/<change-name>/proposal.md
Read <repo_path>/openspec/changes/<change-name>/spec.md
Read <repo_path>/openspec/changes/<change-name>/design.md
Read <repo_path>/openspec/changes/<change-name>/tasks.md
```

**展示摘要**:

```
🔧 修复方案最终确认

🐞 缺陷
{从 proposal.md 背景章节提取}

📌 根因（已在 stage 0 确认）
{从增强系分文档提取的根因摘要}

🔧 修复方案
1. {design.md 中的修复要点 1}
2. {design.md 中的修复要点 2}
...

📝 修改任务清单（来自 tasks.md）
共 {N} 个任务:
1. {任务1标题} - {文件路径}
2. {任务2标题} - {文件路径}
...

📊 涉及文件
修改 {M} 个文件

⚠️ 回归风险
风险等级：{从 design.md 提取}

━━━━━━━━━━━━━━━━━━━━━━━━
📁 完整文档
・openspec/changes/<change-name>/proposal.md
・openspec/changes/<change-name>/spec.md
・openspec/changes/<change-name>/design.md
・openspec/changes/<change-name>/tasks.md
```

**使用 AskUserQuestion**:
- **确认方案，进入编码** -> 跳过 Step 10，直接进入 Step 11
- **需要调整方案** -> 收集调整意见 -> 修改 design.md / tasks.md 后重新确认
- **方案不可接受，重新分析根因** -> 报错回退到 stage 0（用户面消息："修复方案需要重新设计，建议从根因分析重新开始"）





---

### Step 10: 【第二次用户确认】Design & Tasks 确认（**仅 task_type=feature**）

> **task_type=bugfix 跳过本步骤**：bugfix 模式在 Step 9b 已完成单次合并确认，直接进入 Step 11。

**无人驾驶模式**：展示摘要后跳过，直接进入 Step 11。

**读取设计和任务文件**:
```
Read <repo_path>/openspec/changes/<change-name>/design.md
Read <repo_path>/openspec/changes/<change-name>/tasks.md
```

**展示摘要**:

```
△ Design & Tasks 确认

△ 设计要点
1. {设计要点1：架构分层、模块职责}
2. {设计要点2：关键类/组件设计}
3. {设计要点3：异常处理、边界情况}

📝 任务概要
共 {N} 个任务:
1. {任务1标题} - {说明}
2. {任务2标题} - {说明}
...

📊 涉及文件
新增 {N} 个，修改 {M} 个
```

**使用 AskUserQuestion**:
- **确认，进入编码** -> 进入 Step 11
- **需要调整** -> 修改 design.md / tasks.md 后重新确认
- **回退到提案** -> 回退到 Step 9



---

### Step 11: Brainstorm 需求追问与方案深化

**目的**：在用户确认设计方案后、编码前，调用 Superpowers brainstorming skill 对 proposal/design/tasks 做深度追问，挖掘模糊需求和隐性约束。

**前置守卫 -- 按 task_type 决策**:

| task_type | complexity | Brainstorm 决策 |
|-----------|------------|-----------------|
| feature | - | 执行 |
| bugfix | simple | **跳过**（小 bug 不必深化） |
| bugfix | medium / complex | 执行（聚焦手回归风险与隐性影响） |

跳过时记录 `stage_2_brainstorm: skipped`，附简短理由（如 `task_type=bugfix, complexity=simple`），直接进入 Step 12。

**前置检查**：读取 state.md frontmatter 的 `superpowers_status`
- `failed` -> 跳过本步骤，记录"Superpowers 未安装，跳过 Brainstorm"，直接进入 Step 12
- `installed` / `already_installed` -> 继续执行
- 不存在（旧状态文件）-> 尝试调用检测，失败则跳过不阻塞

**执行逻辑**:

```
1. 调用 Superpowers brainstorming skill:
   Skill 工具参数:
     skill: "superpowers:brainstorming"
     args: {
       "proposal_path": "<repo_path>/openspec/changes/<change-name>/proposal.md",
       "design_path": "<repo_path>/openspec/changes/<change-name>/design.md",
       "tasks_path": "<repo_path>/openspec/changes/<change-name>/tasks.md"
     }

2. Brainstorm skill 执行 6 步追问流程:
   - 探索上下文（读取已有 proposal/design/tasks）
   - 逐个追问澄清模糊点（通过 AskUserQuestion）
   - 提出 2-3 种方案变体及 tradeoff
   - 分段展示设计深化内容，用户逐段确认

3. 将 Brainstorm 产出的补充内容直接修改到 OpenSpec 文档中:
   - 追问发现的额外约束 -> 补充到 design.md 的约束章节
   - 方案对比中的选择结果 -> 更新 design.md 中的方案描述
   - 澄清的需求细节 -> 更新 proposal.md / spec.md 中对应描述
   - 如 tasks.md 需要调整（如新增验证 task）-> 直接编辑 tasks.md
```

**无人驾驶模式处理**:
- `autopilot: true` 时，跳过追问环节
- 仅执行"探索上下文"，自动补充明确可判断的约束到文档
- 不阻断流程

**核心原则**：Brainstorm 的产出直接反映到 proposal.md / design.md / tasks.md 中，不新增 state 字段。James 读到的就是深化后的文档。

---

### Step 12: 写入 knowledge_paths.json

**文件**：`<repo_path>/.acs-junior-engineer/knowledge_paths.json`

```json
{
  "matched": {
    "repo_knowledge": [
      "{repo_base}/coding-standard.md"
    ],
    "common_knowledge": [
      "{common_base}/ios-rpc-client.md"
    ]
  },
  "unmatched": [
    {
      "id": "ios-coding-standards",
      "title": "iOS 编码军规",
      "path": "{common_base}/ios-coding-standards.md"
    }
  ]
}
```

### Step 13: 更新 state.md

调 advance 一次性完成阶段流转（写状态机字段 + 全部 outputs + append 摘要 + 推进 current_stage）：

```bash
acs-junior advance <repo_path> --stage 2 \
  --duration <秒数> \
  --outputs "stage_2_proposal_id=<change-name>,stage_2_proposal_path=openspec/changes/<change-name>/proposal.md,stage_2_key_docs_proposal=openspec/changes/<change-name>/proposal.md,stage_2_key_docs_spec=openspec/changes/<change-name>/spec.md,stage_2_key_docs_design=openspec/changes/<change-name>/design.md,stage_2_key_docs_tasks=openspec/changes/<change-name>/tasks.md,stage_2_knowledge_paths=.acs-junior-engineer/knowledge_paths.json,stage_2_core_change=<一句话摘要>,stage_2_affected_files=新增 N 个，修改 M 个,stage_2_has_test_cases=true,stage_2_test_yuque_url=<url 或空>,stage_2_brainstorm=executed" \
  --summary "## Alex - Spec 锁定\n\n提案 ID：<change-name>\n核心变更：<一句话摘要>\n涉及文件：新增 N 个，修改 M 个\n关键文档：\n  proposal: openspec/changes/<change-name>/proposal.md\n  spec: openspec/changes/<change-name>/spec.md\n  design: openspec/changes/<change-name>/design.md\n  tasks: openspec/changes/<change-name>/tasks.md\nBrainstorm：已执行/已跳过"
```

advance 自动写入 `stage_2_status: done`、`stage_2_duration`、所有 outputs、`current_stage: 3`，并将 summary append 到 body。**不要**用 update-state 直接改 `stage_2_status` 或 `current_stage`。

---

## 完成前验证

> 步骤清单全部 ✅ 后，逐项执行以下验证，全部通过才可输出返回摘要。

| # | 验证项 | 检查方式 | 不通过时修复动作 |
|---|--------|----------|------------------|
| 1 | config.yaml 已生成 | `test -f <repo>/openspec/schemas/acs-spec/config.yaml` | 重新执行 generate-config.js |
| 2 | 变更目录存在 | `test -d <repo>/openspec/changes/<change-name>` | 重新执行 openspec new change |
| 3 | proposal.md 存在 | `test -f <repo>/openspec/changes/<name>/proposal.md` | 重新执行 Step 5 |
| 4 | spec.md 存在 | `test -f <repo>/openspec/changes/<name>/spec.md` | 重新执行 Step 6 |
| 5 | design.md 存在 | `test -f <repo>/openspec/changes/<name>/design.md` | 重新执行 Step 7 |
| 6 | tasks.md 存在 | `test -f <repo>/openspec/changes/<name>/tasks.md` | 重新执行 Step 7 |
| 7 | knowledge_paths.json 已写入 | `test -f <repo>/.acs-junior-engineer/knowledge_paths.json` | 立即写入 |
| 8 | state.md frontmatter 已更新 | `acs-junior validate <repo> --stage 2` exit code 0 | 补写缺失 frontmatter 字段 |
| 9 | Brainstorm 状态已记录 | frontmatter 中 `stage_2_brainstorm` 为 `executed` 或 `skipped` | 补写标识 |

---

## 返回摘要

**用户确认后输出**:

```
✅ Spec 锁定完成（用户已确认）

📁 提案信息
提案 ID: {change-name}
核心变更: {核心变更摘要}
涉及文件: 新增 {N} 个，修改 {M} 个

📚 关键文档
├─ proposal.md
├─ spec.md
├─ design.md
└─ tasks.md

📚 知识注入
匹配知识: {N} 条
知识路径: .acs-junior-engineer/knowledge_paths.json

🧪 测试用例
状态: {有/无}
文档: {yuque_url 或 "未提供"}
```



---

## 错误处理

| 错误 | 处理 |
|------|------|
| 知识索引文件不存在 | Step 2.0 先用 `acs-knowledge-index scan` 兜底生成；CLI 缺失或 scan 仍失败才降级（警告，继续执行，无知识参考） |
| 知识文档读取失败 | 跳过该文档，记录警告 |
| generate-config.js 执行失败 | 警告，继续执行（无知识注入） |
| OpenSpec 未安装 | 报错终止：OpenSpec 未安装 |
| openspec new change 失败 | 报错终止：创建变更目录失败 |
| 提案生成失败 | 报错终止：提案生成失败 |
| Brainstorm 不可用 | 跳过，记录原因 |

---

## 重要约束

- **禁止自动跳过确认环节**（autopilot: true 除外）
- **禁止在用户确认前开始编码**
- config.yaml 必须在执行 OpenSpec 前生成
- 知识文档内容必须完整注入 config.yaml context
- **两次确认都必须通过后才能进入编码实现**
- Brainstorm 在两次确认后执行，产出直接修改到 OpenSpec 文档中

---

## 调度器指令

> **本环节执行完毕，输出上方返回摘要后，更新 state.md frontmatter（`stage_2_status: done`、`current_stage: 3`），然后回到 PIPELINE_LOOP S1（= Read state.md）。禁止停留等待用户输入。**
