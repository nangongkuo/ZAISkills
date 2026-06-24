# Feature Document Template

目标是让后续 AI 在最短时间内判断：

- 这个 feature 什么时候该用
- 应该走哪个项目封装入口
- 哪些原生或系统方法不要直接使用

优先写短句、短段落和高密度路径信息，不写过程复盘。
默认把正文压缩成“速查卡”，避免占用过多上下文。

使用以下结构：

```md
---
meta:
  name: <feature-name>
  description: <feature-description>
  keywords: [<keyword1>, <keyword2>, ...]
---

# <Feature Title>

## TL;DR
<一句话说明：在什么场景下，应该通过哪个项目封装使用什么能力，不要直接调用哪个原生能力>

## Keywords
- 主关键词: <canonical keyword>
- 别名: <alias 1>, <alias 2>, <alias 3>

## Use When
- <场景 1>
- <场景 2>

## Preferred Entry
- 推荐入口: `<class/module/function/hook>`
- 位置: `<repo-name/path>`

## Import
`import XXX from 'xxx/xxx'`

## Code Example
```<lang>
// 3-5 行正确用法示例，完整可运行
let client = SomeClient.shared()
client.doSomething(params) { result in
  // handle result
}
```

## How To Use
1. <前置条件或初始化要求>
2. <标准接入步骤>
3. <后续步骤（如有）>

## Avoid Native Or Raw Usage
- 不要直接使用: `<native/system api>`
- 原因: <为什么项目不推荐直接使用>
- 替代方式: `<preferred entry>`

## Constraints
- <只写真正会影响调用的 1 到 2 条限制>

## Evidence
- `repo-a/path`
- `repo-b/path`

## Platform
- <Android | iOS | HarmonyOS | KMP | 多平台>

## Scanned Repos
- `<repo-name-1>`
- `<repo-name-2>`
```

写作规则:

- `TL;DR` 必须同时包含“什么时候使用”和“不要直接用什么”
- `Use When` 只写触发场景，不写实现细节
- `Preferred Entry` 只保留当前推荐的主入口；有多个入口时给出选择规则
- `Import` 只写使用该 feature 必须的 import 语句，1-2 行；平台不同时写最常用的一种
- `Code Example` 给出最小可运行的正确用法，3-5 行，必须体现 Preferred Entry 的实际调用方式；不要写伪代码，写真正可编译的代码
- `How To Use` 控制在 2-5 步，复杂集成可适当展开但不要变成教程
- `Avoid Native Or Raw Usage` 是强制章节；如果未发现禁用项，直接写“当前未发现明确禁用项”
- `Constraints` 没有高价值限制时可以省略
- `Evidence` 至少覆盖定义点或入口，以及一个调用点
- 多仓扫描时，`Evidence` 里的路径统一写成“仓库名 + 仓库内相对路径”
- `Platform` 根据扫描到的项目类型填写，便于按平台过滤检索；仅涉及单平台时可省略
- `Scanned Repos` common 知识必须写（即使只有 1 个仓库），用于知识匹配时的仓库归属过滤；project 知识可省略
- `Keywords`、`Use When`、`Evidence` 都不要超过 2 到 3 条
- 全文默认不超过 12 行正文内容
- 不要贴大段源码；必要时只摘一行关键方法名或路径
