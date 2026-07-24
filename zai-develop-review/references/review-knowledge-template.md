# Review Knowledge Template

目标是让后续 AI 在最短时间内判断：

- 这个经验什么时候应该注意
- 正确的做法是什么
- 哪些做法不要用

优先写短句、短段落和高密度路径信息，不写过程复盘。
默认把正文压缩成“速查卡”，避免占用过多上下文。

格式与 acs-knowledge-scanner 的 feature 文档一致，确保可以被统一检索和消费。
写作侧重点不同：feature 文档侧重“如何正确使用某个封装”，review 知识侧重“避免某类开发错误的正确做法”。

使用以下结构：

```md
---
meta:
  name: <knowledge-name>
  description: <一句话说明：在什么场景下应该怎么做、不要怎么做>
  keywords: [<keyword1>, <keyword2>, ...]
---

# <Knowledge Title>

## TL;DR
<一句话说明：在什么场景下，应该通过什么方式做什么事，不要直接用什么做法>

## Keywords
- 主关键词：<canonical keyword>
- 别名：<alias 1>, <alias 2>, <alias 3>

## Use When
- <会触发此错误的开发场景 1>
- <会触发此错误的开发场景 2>

## Preferred Entry
- 推荐入口：`<正确的类/方法/模式>`
- 位置：`<repo-name/path>`

## How To Use
1. <正确做法的前置条件或初始化>
2. <正确做法的标准步骤>

## Avoid Native Or Raw Usage
- 不要直接使用：`<错误的做法/API/模式>`
- 原因：<为什么这样做是错的，会导致什么问题>
- 替代方式：`<preferred entry>`

## Constraints
- <只写真正会影响调用的 1 到 2 条限制>

## Evidence
- `repo-name/path` - <该文件中的关键证据>
- 对话记录：<简述对话中哪个环节暴露了此问题及如何修正>

## Platform
- <Android | iOS | HarmonyOS | KMP | 多平台>
```

写作规则：

- `TL;DR` 必须同时包含“什么时候用”和“不要直接用什么”
- `Use When` 只写触发场景，不写实现细节
- `Preferred Entry` 只保留当前推荐的主入口；有多个入口时给出选择规则
- `How To Use` 控制在 2 步以内，避免展开成长教程
- `Avoid Native Or Raw Usage` 是强制章节；如果未发现禁用项，直接写“当前未发现明确禁用项”
- `Constraints` 没有高价值限制时可以省略
- `Evidence` 至少覆盖一个文件路径证据，以及对话中暴露此问题的关键环节
- `Evidence` 里的路径统一写成“仓库名 + 仓库内相对路径”
- `Platform` 根据涉及的项目类型填写，便于按平台过滤检索；仅涉及单平台时可省略
- `Keywords`、`Use When`、`Evidence` 都不要超过 2 到 3 条
- 全文默认不超过 12 行正文内容
- 不要贴大段源码；必要时只摘一行关键方法名或路径
