---
name: acs-bug-fix:config
description: 缺陷修复 Skill 阶段配置中心。集中定义所有执行阶段、流转规则和扩展点。
---

# ACS Bug Fix 阶段配置

## 配置说明

此文件集中定义所有执行阶段，如需添加新阶段：
1. 在 `stages` 数组中添加阶段定义
2. 创建对应的子 skill 文件（如 `acs-bug-fix-xxx.md`）
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
| `execution_mode` | 执行模式：`agent`（子 Agent 顺序执行） / `inline`（主对话直接执行） |

---

## 阶段定义

```yaml
stages:
  - id: 1
    name: defect-input
    skill_file: stages/acs-bug-fix-defect-input.md
    description: 阶段1-缺陷输入与初始化
    first_time_prompt: true
    next_stage: 2
    execution_mode: inline

  - id: 2
    name: analysis
    skill_file: stages/acs-bug-fix-analysis.md
    description: 阶段2-根因分析（迭代循环）
    first_time_prompt: false
    next_stage: 3
    execution_mode: inline

  - id: 3
    name: fix-plan
    skill_file: stages/acs-bug-fix-fix-plan.md
    description: 阶段3-修复方案与确认
    first_time_prompt: false
    next_stage: 4
    execution_mode: inline

  - id: 4
    name: coding
    skill_file: stages/acs-bug-fix-coding.md
    description: 阶段4-编码修复
    first_time_prompt: false
    next_stage: 5
    execution_mode: agent

  - id: 5
    name: submit
    skill_file: stages/acs-bug-fix-submit.md
    description: 阶段5-提交代码
    first_time_prompt: false
    next_stage: null
    is_final: true
    execution_mode: inline
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

### 外部依赖

- `acs-build` - 编译检查（阶段 4 使用）
