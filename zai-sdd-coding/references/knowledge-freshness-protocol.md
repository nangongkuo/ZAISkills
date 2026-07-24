---
name: knowledge-freshness-protocol
description: 知识保鲜协议。commit 后自动检查受影响的知识文档，逐节校验并修补过时内容。适用于任何 Claude Code 会话。
---

# 知识保鲜协议

本协议由 PostToolUse hook (`acs-knowledge-index freshness-check`) 触发，也可手动执行。

---

## A. 获取变更范围

```bash
cd <repo_path>
git diff HEAD~1 --name-only    # → changed_files
git diff HEAD~1                # → full_diff
```

## B. 加载知识索引

```
Read <repo_path>/knowledge/knowledge-index.json
```

- 文件不存在 → 终止，无需检查
- 同时尝试读取 `<repo_path>/.acs-sdd-coding/knowledge-paths.json`（如有），作为辅助信号

## C. 匹配受影响的知识文档

对 `knowledge-index.json` 中的每个 feature，按以下规则判定“可能受影响”：

| 匹配维度 | 匹配方式 |
|----------|----------|
| **关键词命中** | feature 的 `keywords` 任一出现在 `changed_files` 路径或 `full_diff` 文本中（不区分大小写） |
| **入口命中** | Read 知识文档的 `## Preferred Entry` 章节，提取 class/method 名，检查是否出现在 `full_diff` 中 |
| **路径命中** | 知识文档 `## Evidence` 中的文件路径与 `changed_files` 有交集 |

任一维度命中即视为“可能受影响”。

- 命中 0 个 → 无影响，终止
- 命中 > 5 个 → 取关键词命中次数最多的 5 个，其余记录为跳过

## D. 检查 Repo Overview 是否需要更新

**独立于 feature 文档匹配**，仅在 `_repo-overview.md` 存在时执行，根据结构性信号判断：

| 触发信号 | 检测方式 |
|----------|----------|
| **目录结构变化** | changed_files 中存在新增/删除的顶层目录 |
| **构建配置变化** | changed_files 包含 Podfile / build.gradle / Package.swift 等 |
| **关键入口变化** | changed_files 包含 AppDelegate / Application / MainActivity 等入口文件 |

无结构性信号 → 跳过 overview 检查。
命中信号 → 读取 overview + 变更文件，仅更新受影响章节（Directory Structure / Build System / Key Entry Points）。

## E. 逐节校验

对每个受影响的知识文档，Read 完整内容 + Read 变更涉及的源码文件（变更后版本），逐节校验：

| 章节 | 校验逻辑 | 过时信号 |
|------|----------|----------|
| **Preferred Entry** | Grep 代码确认推荐的 class/method 仍存在且签名未变 | class/method 不存在、已 rename、被标记 @deprecated |
| **Import** | 确认 import 路径对应的文件/模块仍存在 | 文件已移动或删除、路径变更 |
| **Code Example** | 确认示例中的 API 调用与当前方法签名一致 | 参数增删改、返回类型变化 |
| **How To Use** | 确认步骤中提及的方法/初始化流程仍准确 | 方法 renamed/removed、步骤顺序变化 |
| **Avoid Native Or Raw Usage** | 确认“不要使用”的原生 API 仍存在且封装仍存在 | 封装被移除或原生 API 已不存在 |
| **Constraints** | 确认约束在新代码中仍成立 | 约束已被放宽或收紧 |
| **TL;DR** | 仅当上述章节变更导致 TL;DR 真实性错误时更新 | Preferred Entry 或 Avoid 变更影响了核心结论 |

**保守原则**：只修补**可证伪**的过时内容（代码中可验证）。判断标准：**这段知识会不会导致未来 AI 生成错误的代码？**不确定时不修补。

## F. 判定来源并执行修补

| 知识来源 | 路径模式 | 处理方式 |
|----------|----------|----------|
| `source: "repo"` | `knowledge/project/...` | 直接 Edit 对应章节 |
| `source: "common"` | `knowledge/common/...` | **不修改**，输出警告 |

**修补规则**：
- 保留 frontmatter（`---` 块）不动
- 保留非过时章节不动（逐字节保留）
- 仅替换过时章节的 `## Header` 到下一个 `## Header` 之间的内容
- 遵循知识文档写作规范（短句、高密度、不超过 12 行正文）
- 不新增章节、不修改 `meta.keywords` 或 `meta.name`

## G. 提交知识更新

若有 `knowledge/project/` 文档被修补：

```bash
cd <repo_path>
git add knowledge/project/
git commit -m "chore: 自动更新知识文档

更新内容:
- <doc1.md>: <更新的章节列表>

Co-Authored-By: Claude <noreply@anthropic.com>"
```

无文档被修补 → 不提交。

## H. 输出结果

**Common 警告格式**（有警告时输出）：
```
⚠️ Common 知识可能过期：
  · knowledge/common/ios/ios-rpc-client.md → Preferred Entry 签名变更
```
