# Repo Overview Template

冷启动时自动生成的仓库概要文档。目标是让 OpenSpec 在最短时间内理解：

- 这个仓库用什么技术栈
- 代码怎么组织的
- 命名和构建有什么惯例
- 关键入口在哪里

文件名固定为 `_repo-overview.md`（下划线前缀），与 feature 知识文档区分。
Overview 不参与 Stage 2 关键词匹配，始终作为全局上下文注入 config.yaml。

使用以下结构：

```md
---
meta:
  name: repo-overview
  description: <一句话项目描述>
  keywords: [repo-overview]
---

# <项目名> - 仓库概要

## Tech Stack
- 语言：<Swift / Kotlin / Java / ObjC>
- 平台：<iOS / Android / HarmonyOS / KMP>
- 框架：<UIKit / SwiftUI / Jetpack Compose>
- 依赖管理：<CocoaPods / SPM / Gradle>
- 最低版本：<e.g., iOS 14.0, Android API 24>

## Directory Structure
```
<repo-root>/
├── <dir1>/        - <用途说明>
├── <dir2>/        - <用途说明>
│   ├── <subdir>/  - <用途说明>
│   └── <subdir>/  - <用途说明>
└── <dir3>/        - <用途说明>
```

## Naming Conventions
- 文件：<PascalCase.swift / kebab-case.kt>
- 类：<前缀规则，如 AP 前缀>
- 方法：<camelCase, verb-first>

## Build System
- 类型：<Xcode workspace / Gradle multi-module>
- 构建命令：<e.g., xcodebuild -workspace X.xcworkspace -scheme Y>
- 关键配置：<Podfile / build.gradle 路径>

## Key Entry Points
- App 入口：<e.g., AppDelegate.swift 路径>
- 核心 Service：<列出 3-5 个关键 Manager/Service 及路径>

## Architecture Pattern
- 模式：<MVC / MVVM / Clean Architecture / 模块化>
- 层级边界：<简述各层如何通信>
```

生成规则：

- 通过快速扫描仓库生成（目录结构 + 采样 3-5 个关键文件），控制在 10 秒内
- `Tech Stack` 从构建配置文件推断（Podfile / build.gradle / Package.swift）
- `Directory Structure` 仅列出顶层 2-3 层，排除 .git / Pods / node_modules / build / DerivedData
- `Naming Conventions` 从采样文件的命名模式推断
- `Key Entry Points` 通过搜索 AppDelegate / Application / Manager / Service 等关键词定位
- `Architecture Pattern` 从目录结构和类组织方式推断
- 全文控制在 30-50 行，保持高密度
- 无法确定的字段写“未识别”，不要猜测
