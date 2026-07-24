---
name: acs-sdd-coding:config
description: 移动端 AI Coding 阶段配置中心。集中定义所有执行阶段、流转规则和扩展点。
---

# ACS Coding 阶段配置

## 配置说明

此文件集中定义所有执行阶段。如需添加新阶段：
1. 在 `stages` 数组中添加阶段定义
2. 创建对应的子 skill 文件（如 `acs-sdd-coding-xxx.md`）
3. 配置流转规则（next_stage）

---

## 阶段列表

| 字段 | 说明 |
|------|------|
| `id` | 阶段编号，用于排序和状态追踪 |
| `name` | 阶段标识名，用于文件命名 |
| `skill_file` | 子 skill 文件名 |
| `description` | Agent 调用时的描述 |
| `first_time_prompt` | 首次执行时是否询问用户 |
| `next_stage` | 下一阶段 ID |
| `is_final` | 是否最终阶段 |
| `execution_mode` | 执行模式：`agent`（子 Agent 隔离执行）/ `inline`（主对话直接执行） |
| `conditional` | 是否为条件性阶段 |

---

## 阶段定义

```yaml
stages:
  - id: 1
    name: input-init
    skill_file: stages/acs-sdd-coding-input-init.md
    description: 阶段 1-输入收集与初始化
    first_time_prompt: true
    next_stage: 2
    execution_mode: inline

  - id: 2
    name: spec
    skill_file: stages/acs-sdd-coding-spec.md
    description: 阶段 2-Spec 流程
    first_time_prompt: false
    next_stage: 3
    execution_mode: inline

  - id: 3
    name: build
    skill_file: stages/acs-sdd-coding-build.md
    description: 阶段 3-编码编译
    first_time_prompt: false
    next_stage: 4
    execution_mode: agent

  - id: 4
    name: test
    skill_file: stages/acs-sdd-coding-test.md
    description: 阶段 4-自动化测试
    first_time_prompt: false
    next_stage: 5
    execution_mode: agent
    conditional: true  # 条件性阶段，根据 state.阶段2.有测试用例 决定是否执行

  - id: 5
    name: submit
    skill_file: stages/acs-sdd-coding-submit.md
    description: 阶段 5-提交代码并创建 PR
    first_time_prompt: false
    next_stage: null
    is_final: true
    execution_mode: inline
```

---

## 扩展示例

### 添加新阶段（阶段 6：代码审查）

```yaml
- id: 6
  name: review
  skill_file: stages/acs-sdd-coding-review.md
  description: 阶段 6-代码审查
  first_time_prompt: false
  next_stage: null
  is_final: true
  execution_mode: agent
```

然后创建 `acs-sdd-coding-review.md` 子 skill 文件即可。

**注意**：添加新阶段后，需要修改原最终阶段（阶段 5: submit）的 `next_stage` 指向新阶段。

---

## 条件性阶段执行

某些阶段可能需要根据前置条件决定是否执行（如阶段 4：自动化测试）。

### 配置字段

| 字段 | 说明 |
|------|------|
| `conditional` | 是否为条件性阶段 |
| `condition` | 执行条件表达式（可选，默认读取 state 中的判断字段） |

### 执行逻辑

```
阶段 N 完成后
  ↓
读取 next_stage 配置
  ↓
检查是否 conditional: true
  ├─ 否 → 直接执行下一阶段
  └─ 是 → 检查执行条件
        ↓
      读取 state.阶段2.有测试用例
        ├─ true  → 执行阶段 N+1
        └─ false → 跳过阶段 N+1，记录跳过状态，继续执行阶段 N+2
```

### 状态记录

条件性阶段被跳过时，在 state.md 中记录：

```markdown
### 阶段 4：自动化测试
状态：⏭️ 跳过
原因：未提供测试用例文档
```

---

## 编排规则

### 流转逻辑

1. 阶段完成后，读取 `next_stage` 确定下一阶段
2. 若 `first_time_prompt: true` 且是首次执行，询问用户是否继续
3. 若 `is_final: true`，完成后标记流程结束
4. 正常完成自动流转到 `next_stage`

### 获取阶段配置函数

```
get_stage_config(stage_id):
  从 stages 数组中找到 id 匹配的阶段
  返回完整的阶段配置对象

get_next_stage(current_stage):
  config = get_stage_config(current_stage)
  return config.next_stage

is_final_stage(stage_id):
  config = get_stage_config(stage_id)
  return config.is_final || config.next_stage == null
```

---

## 依赖技能

### OpenSpec CLI（内置）

已内嵌 OpenSpec 能力，无需调用独立 skill。

| 命令 | 用途 | 调用阶段 |
|------|------|----------|
| `openspec new change` | 创建变更目录 | 阶段 2: Spec 流程 |
| `openspec instructions proposal` | 生成提案 | 阶段 2: Spec 流程 |
| `openspec instructions spec` | 生成规范 | 阶段 2: Spec 流程 |
| `openspec instructions design` | 生成设计+任务 | 阶段 2: Spec 流程 |
| `openspec instructions apply` | 代码实现 | 阶段 3: 编码编译 |

### 外部依赖

- `dmore-codegen` - 设计稿还原（可选）
- `acs-build` - 编译检查
- `yuque` CLI - 读取系统文档
- OpenSpec CLI - 已内置在流程中

## 知识优先级

```
仓库知识文档 (/knowledge/project/) > 通用知识文档 (/knowledge/common/) > OpenSpec 默认能力
```

### 知识目录

| 类型 | 路径 | 说明 |
|------|------|------|
| 通用知识文档 | `<repo>/knowledge/common/` | 按平台组织的通用知识（iOS、Android、Harmony、KMP 等） |
| 仓库知识文档 | `<repo>/knowledge/project/` | 仓库特定知识（由仓库自行维护） |

### 远程知识仓库配置

**用途**：集中维护通用知识文档，支持多项目复用

**配置块**：

```yaml
knowledge:
  remote:
    # 远程知识仓库 Git 地址
    # 支持直接填写 URL，或使用 ${ENV_VAR:-default} 语法引用环境变量
    url: "git@code.alipay.com:kangwenbao.kwh/acs-common-knowledge.git"

    # 同步策略
    sync:
      # 冲突处理： error(报错) / skip(跳过) / overwrite(覆盖)
      on_conflict: "error"

  # 本地知识目录（相对于仓库根目录）
  local:
    project: "knowledge/project"
    common: "knowledge/common"
```

**配置读取优先级**：
1. 环境变量（如 `ACS_COMMON_KNOWLEDGE_URL`）
2. 本配置文件中的 `knowledge.remote.url`
3. 未配置 → 报错终止

**远程仓库结构**：
```
acs-common-knowledge/
└── knowledge/
    └── common/
        ├── iOS/
        │   ├── ios-coding-standards.md
        │   └── ios-rpc-client.md
        ├── Android/
        │   └── android-coding-standards.md
        ├── Harmony/
        │   └── harmony-coding-standards.md
        └── kmp/
            └── kmp-coding-standards.md
```

**Sync 策略**：
- 同名文件冲突时报错，需手动解决
- 本地优先：冲突时保留本地版本
- 远程仓库只读（upload 需单独授权）
