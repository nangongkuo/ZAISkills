---
name: acs-sdd-coding:confirmation-prompts
description: ACS Coding 确认环节的 AskUserQuestion 交互模板。覆盖提案确认、设计确认、PR创建确认三个场景。
---

# ACS Coding 确认交互模板

## 使用说明

各阶段在需要用户确认的环节，引用本文件对应场景的 AskUserQuestion 模板。preview 中的 `{占位符}` 需在运行时替换为实际内容。

---

## 场景1：提案意图确认 (Stage 2 Step 9)

```yaml
AskUserQuestion:
  questions:
    - question: "提案意图是否符合预期？"
      header: "提案确认"
      multiSelect: false
      options:
        - label: "确认，继续设计"
          description: "提案意图正确，进入详细设计和任务拆分"
          preview: |
            {从 proposal.md 提取的摘要}

            ## 核心变更
            {一句话核心目标}

            ## 关键决策
            1. {决策点1}
            2. {决策点2}
            3. {决策点3}

            ## 运用的知识文件
            - {knowledge_file_1.md}
            - {knowledge_file_2.md}
        - label: "调整意图"
          description: "方向有偏差，描述需要调整的内容"
          preview: |
            选择此项后请补充说明，例如：

            - "核心目标理解有误，应该是..."
            - "技术选型需要换成..."
            - "需求范围需要收窄/扩大"

            你的反馈会用于修改 proposal.md / spec.md
            并重新展示摘要供确认。
        - label: "重新理解需求"
          description: "提案与需求偏差较大，从系分文档重新分析"
          preview: |
            将清空当前 proposal.md，
            重新从系分文档出发理解需求。

            ⚠️ 当前提案内容将丢失。

            适用场景：
            - 系分文档理解有误
            - 抓错了核心需求点
            - 需要完全换一个方向
```

**反馈处理**:
- 选择「确认，继续设计」→ 进入 Step 10
- 选择「调整意图」或 Other 自由输入 → 修改 proposal.md / spec.md 后重新展示摘要，再次调用 AskUserQuestion 确认
- 选择「重新理解需求」→ 回退到 Step 7 重新生成 proposal

---

## 场景2：设计方案确认 (Stage 2 Step 10)

```yaml
AskUserQuestion:
  questions:
    - question: "设计方案和任务拆分是否符合预期？"
      header: "设计确认"
      multiSelect: false
      options:
        - label: "确认，进入编码"
          description: "方案和任务拆分符合预期，进入 Stage 3 编码执行"
          preview: |
            {从 design.md + tasks.md 提取的摘要}

            ## 设计要点
            1. {设计要点1}
            2. {设计要点2}
            3. {设计要点3}

            ## 任务拆分 (共 {N} 个)
            T1 {任务1标题} - {简要说明}
            T2 {任务2标题} - {简要说明}
            ...

            ## 涉及文件
            新增 {N} 个，修改 {M} 个
        - label: "调整方案"
          description: "设计或任务拆分需要修改"
          preview: |
            选择此项后请补充说明，例如：

            设计调整：
            - "组件不用 Activity，改用 DialogFragment"
            - "加一层本地缓存，避免每次请求接口"

            任务调整：
            - "T2 和 T3 合并为一个任务"
            - "加一个埋点任务"

            Agent 会修改 design.md / tasks.md 并重新展示。
        - label: "回退到提案"
          description: "设计方向有误，回到提案意图确认步骤"
          preview: |
            将回退到 Step 9 提案意图确认环节，
            重新调整提案后再生成设计方案。

            ⚠️ 当前 design.md / tasks.md 将丢失。

            适用场景：
            - 发现提案意图有遗漏
            - 设计偏离了提案方向
            - 需要重新审视需求理解
```

**反馈处理**:
- 选择「确认，进入编码」→ 进入 Step 11
- 选择「调整方案」或 Other 自由输入 → 修改 design.md / tasks.md 后重新展示摘要，再次调用 AskUserQuestion 确认
- 选择「回退到提案」→ 回退到 Step 9

---

## 场景3：PR 创建确认 (Stage 5 Step 3)

```yaml
AskUserQuestion:
  questions:
    - question: "是否创建 PR？"
      header: "PR创建"
      multiSelect: false
      options:
        - label: "创建 PR"
          description: "使用自动生成的标题和描述创建 PR"
          preview: |
            ## PR 信息预览

            标题：{自动生成的 PR 标题}
            目标分支：master
            源分支：{当前分支名}
            commit：{hash}

            ## 描述摘要
            - 系分文档：{链接}
            - 改动范围：{新增/修改文件数}
            - 任务完成：{N}/{M}

            如需自定义标题，请选择 Other 输入。
        - label: "稍后手动创建"
          description: "跳过 PR 创建，后续手动操作"
```

**反馈处理**:
- 选择「创建 PR」→ 进入 Step 5 执行 PR 创建
- 选择 Other (自定义文本) → 将用户输入作为 PR 标题，进入 Step 5
- 选择「稍后手动创建」→ 记录"用户选择手动创建"，跳到 Step 6

---

## 场景4：知识匹配确认 (Stage 2 Step 2)

```yaml
AskUserQuestion:
  questions:
    - question: "匹配到的知识文件是否符合预期？"
      header: "知识确认"
      multiSelect: false
      options:
        - label: "确认，继续"
          description: "知识匹配结果正确，继续生成方案"
          preview: |
            ## 匹配到的知识文件 (共 {N} 个)

            {逐个列出匹配到的知识文件，每个包含：}
            1. {title} ({path})
               匹配理由：{基于 keywords/description 的匹配依据}

            2. {title} ({path})
               匹配理由：{匹配依据}

            ...

            ## Repo Overview (全局上下文)
            - {_repo-overview.md 路径，若存在}
        - label: "排除部分知识"
          description: "部分知识文件与需求无关，需要移除"
          preview: |
            选择此项后请指明要排除的知识文件，例如：

            - "排除第 2 个，和本次需求无关"
            - "只保留 xxx.md 和 yyy.md"
            - "common 知识都不需要，只要 project 知识"

            排除后会重新展示匹配列表供确认。
        - label: "补充知识文件"
          description: "缺少相关知识，需要额外补充"
          preview: |
            选择此项后请说明需要补充的知识，例如：

            - "还需要匹配 xxx 相关的知识"
            - "把 knowledge/project/yyy.md 也加上"
            - "搜索下有没有关于 zzz 的知识文档"

            补充后会重新展示完整匹配列表供确认。
```

**反馈处理**:
- 选择「确认，继续」→ 进入 Step 3
- 选择「排除部分知识」或 Other 自由输入 → 移除指定知识文件后重新展示，再次调用 AskUserQuestion 确认
- 选择「补充知识文件」→ 根据用户指示重新执行匹配或手动添加，再次确认

---

## 场景5：代码提交确认 (Stage 5 Step 1)

```yaml
AskUserQuestion:
  questions:
    - question: "确认提交以下代码变更？"
      header: "提交确认"
      multiSelect: false
      options:
        - label: "确认提交"
          description: "变更内容和提交信息正确，执行 git commit"
          preview: |
            ## 变更统计
            {git diff --stat 输出}

            ## 改动文件 (共 {N} 个)
            {逐行列出变更文件及状态}
            - M {modified_file_1}
            - M {modified_file_2}
            - A {added_file_1}
            ...

            ## Commit Message
            {自动生成的提交信息}
        - label: "调整提交"
          description: "需要修改提交信息或排除部分文件"
          preview: |
            选择此项后请说明调整内容，例如：

            提交信息调整：
            - "commit message 改为 xxx"
            - "补充一下变更说明"

            文件范围调整：
            - "排除 xxx 文件，不要提交"
            - "只提交 src/ 目录下的改动"

            调整后会重新展示变更信息供确认。
        - label: "查看完整 Diff"
          description: "先查看详细代码改动再决定"
          preview: |
            将执行 git diff 展示完整改动内容。

            查看完成后会再次弹出确认。

            适用场景：
            - 变更文件较多，需要逐个审查
            - 不确定某些改动是否正确
            - 想确认没有遗漏或多余的改动
```

**反馈处理**:
- 选择「确认提交」→ 进入 Step 2 执行 git commit
- 选择「调整提交」或 Other 自由输入 → 调整 commit message 或文件范围后重新展示确认
- 选择「查看完整 Diff」→ 执行 `git diff` 展示后再次调用 AskUserQuestion 确认
