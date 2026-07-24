---
name: acs-sdd-coding:submit
description: 阶段5-提交代码并创建PR。检查变更、提交commit、推送代码、创建Pull Request。
---

# 阶段5：提交代码并创建PR

---

## 输入 Schema

| 字段 | 来源 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| repo_path | state.基本信息.仓库路径 | string | ✅ | 仓库绝对路径 |
| branch_name | state.基本信息.分支名 | string | ✅ | 当前分支名 |
| 编译结果 | state.阶段3.编译结果 | string | ✅ | 编译结果 |
| 修改文件 | state.阶段3.修改文件 | array | ❌ | 修改的文件列表 |
| 系分文档 | state.阶段1.系分文档 | string | ✅ | 系分文档标题（用于 PR 标题） |
| 系分文档地址 | state.阶段1.系分文档地址 | string | ✅ | 系分文档 URL（用于 PR 描述） |

---

## 输出 Schema

| 字段 | 写入位置 | 类型 | 说明 |
|------|----------|------|------|
| commit_hash | state.阶段5.commit | string | commit hash前7位 |
| pr_url | state.阶段5.PR链接 | string | PR地址或"手动创建" |
| 迭代关联 | state.阶段5.迭代关联 | string | 关联的迭代ID或"未关联" |
| 打包结果 | state.阶段5.打包结果 | string | 打包请求ID/请求链接或"未触发" |
| total_duration | state.流程状态.总耗时 | number | 全流程耗时秒数 |

---

## 步骤清单

> 开始执行前实例化，每步完成后标记 ✅，输出 `[COMPLETE]` 前逐项确认。

- [ ] Step 1：检查变更 + 确认（git status + git diff + 用户确认）
- [ ] Step 2：提交代码（git commit）
- [ ] Step 3：询问用户（PR 确认）
- [ ] Step 4：创建 PR（如确认）
- [ ] Step 5：迭代关联与打包（推断 + 询问 + 关联 + 构建）
- [ ] Step 6：更新最终状态（state.md）

> **清理步骤**：Step 7（清理 `.acs-sdd-coding`）在完成前验证通过后执行，不参与步骤清单检查。

---

## 执行步骤

### Step 1：检查变更 + 确认

```bash
cd <仓库路径>
git status
git diff --stat
```

**变更确认**：

按 `prompts/confirmation-prompts.md` **场景5：代码提交确认** 的模板调用 `AskUserQuestion`，preview 中的占位符替换为实际的变更信息（改动文件列表、diff 统计、生成的 commit message）。

**等待用户反馈**：
- 选择「确认提交」→ 进入 Step 2 执行 git commit
- 选择「调整提交」或 Other 自由输入 → 根据用户指示调整 commit message 或排除文件后，重新展示确认
- 选择「查看完整 Diff」→ 执行 `git diff` 展示完整改动内容后，再次调用 AskUserQuestion 确认

---

### Step 2：提交代码

```bash
git add .
git commit -m "<提交信息>

Co-Authored-By: Claude <noreply@anthropic.com>"
```

前提：用户已开启commit权限。

**提交失败处理**：
- 权限不足：报错终止
- 冲突：报错终止
- 无变更内容：跳过提交，记录日志

---

### Step 3：询问用户

按 `prompts/confirmation-prompts.md` **场景3：PR 创建确认** 的模板调用 `AskUserQuestion`，preview 中的占位符替换为实际的 PR 信息（标题、分支、commit、描述摘要）。

**等待用户反馈**：
- 选择「创建 PR」→ 进入 Step 4 执行 PR 创建
- 选择 Other（自定义文本）→ 将用户输入作为 PR 标题，进入 Step 4
- 选择「稍后手动创建」→ 记录"用户选择手动创建"，跳到 Step 5

---

### Step 4：创建PR（如确认）

```bash
git push origin <分支名>
gh pr create --title "<标题>" --body "<描述>"
```

**PR 描述包含**：
- 系分文档链接
- 分支名
- commit hash

**PR 创建失败处理**：
- 报错终止，提供手动创建命令

---

### Step 5：迭代关联与打包

> 本步骤在 push 成功后执行。自动推断参数，如推断失败则静默跳过，不阻断流程。

**前提条件**：Step 4 已 push 成功。

**子步骤 5.1：检测 huoban-cli 环境并推断参数**

先检测当前环境是否可用：

```bash
huoban-cli user get
```

- 失败 → 静默跳过本步骤，标记 `迭代关联：未触发（环境不可用）`
- 成功 → 继续推断

**推断 platform**（基于仓库根目录特征文件）：
- 存在 `build.gradle` / `build.gradle.kts` → `Android`
- 存在 `.xcodeproj` / `Podfile` / `Package.swift` → `iOS`
- 存在 `hvigorfile.ts` / `build-profile.json5` → `Harmony`
- 无法推断 → 静默跳过

**推断 module-id**（多层递进，失败进入下一层）：

> 仓库名（如 `ios-mylive`）与伙伴平台注册的 `artifactId`（如 `Mylive`）往往不一致，需多层推断。

**层 1：读取仓库内伙伴配置**
```bash
# 检查仓库根目录是否有预置的 module-id 配置
cat .huoban/module_id 2>/dev/null
cat .acs/module_id 2>/dev/null
cat .huoban/config 2>/dev/null | grep -i module_id
```
- 找到有效值 → 直接使用，推断结束

**层 2：从构建文件提取模块名 + `bundle list` 精确查询**

根据平台读取构建产物名称：
- **iOS**：读取 `*.podspec` 中的 `s.name`
- **Android**：读取 `build.gradle` / `build.gradle.kts` 中的 `artifactId` 或 `project(":xxx")` 声明
- **Harmony**：读取 `oh-package.json5` 中的 `name`

获取名称后，从 `git remote URL` 中的 `/{product}/` 段推断 `groupId`
- iOS 常见规则：`com.alipay.ios.phone.{product}`
- Android 常见规则：`com.alipay.android` 或 `com.alipay.android.phone.{product}`

然后用 `bundle list` 精确查询：
```bash
huoban-cli bundle list \
  --group-id=<推断的groupId> \
  --artifact-id=<从构建文件提取的模块名> \
  --version=1.0.0
```
- 返回结果非空 → 提取第一个匹配的 `moduleId`

**层 3：`metadata bundle search` 模糊搜索兜底**

若层 2 未命中，用 `git remote` 提取的仓库名进行模糊搜索：
```bash
huoban-cli metadata bundle search --keyword=<仓库名> --platform=<platform>
```
- 结果**唯一匹配** → 提取 `module-id`

**层 4：用户手动输入**

以上三层均失败 → 在 AskUserQuestion 中提示用户手动输入 `module-id`。

**推断 product-name**：默认 `wallet`。

**子步骤 5.2：用户确认（AskUserQuestion）**

调用 `AskUserQuestion`，询问用户是否需要关联迭代：

- **选项 A**：「关联已有迭代并打包」→ 列出该 product/version 下的迭代供选择
- **选项 B**：「创建新迭代并关联打包」→ 用户输入 `version`，调用 `huoban-cli sprint create`，然后关联打包
- **选项 C**：「跳过，不关联迭代」→ 记录 `迭代关联：跳过`，进入 Step 6

> 如果 module-id 未能自动推断唯一值，询问 UI 中增加输入框让用户补充 module-id。

**子步骤 5.3：关联迭代**

```bash
huoban-cli sprint module add \
  --project-unique-id=<用户选择的/创建的迭代ID> \
  --module-id=<推断或用户输入的module-id> \
  --branch-name=<branch_name>
```

**子步骤 5.4：触发打包（测试包）**

```bash
huoban-cli package build \
  --project-unique-id=<迭代ID> \
  --platform=<推断的platform> \
  --type=test \
  --product-name=wallet \
  --if-not-exists
```

> `--if-not-exists` 为幂等参数：若该迭代下已有 test 包则跳过，避免重复构建。

**失败处理**：
- `sprint module add` 失败 → 记录 warning 到 state.md，不影响后续流程
- `package build` 失败 → 记录 warning 到 state.md，不影响后续流程
- 用户选择跳过 → 记录 `迭代关联：跳过`，影响后续流程

**输出写入 state.md**:

```markdown
迭代关联：<迭代ID> / 跳过 / 未触发
打包结果：<打包请求ID> / 失败 / 未触发
huoban-build：<构建链接或N/A>
```

---

### Step 6：更新最终状态

追加:

```markdown

### 阶段5：提交代码并创建PR
状态：✅ 完成
完成时间：<ISO时间>
执行模式：inline
执行耗时：<秒数>秒
commit: <hash前7位>
PR链接：<url> / 用户选择手动创建
迭代关联：<迭代ID / 跳过 / 未触发>
打包结果：<打包请求ID / 失败 / 未触发>
huoban-build: <构建链接或N/A>

问题记录：[]

## 流程状态
整体状态：✅ 完成
完成时间：<ISO时间>
总耗时：<累计秒数>秒
```

更新基本信息：
- 当前阶段：完成
- 更新时间：<ISO时间>

---

### Step 7：清理 state 文件（验证后执行）

> 本步骤在「完成前验证」全部通过后执行，不在步骤清单中。

任务正常完成后，清理运行时状态目录：

```bash
rm -rf <仓库路径>/.acs-sdd-coding
```

> 仅在整体状态为「✅ 完成」时执行清理。如果流程中途失败，保留 state 文件以支持断点恢复。

---

## 完成前验证

> 步骤清单全部 ✅ 后，逐项执行以下验证。全部通过才可输出返回摘要。

| # | 验证项 | 检查方式 | 不通过时修复动作 |
|---|--------|----------|------------------|
| 1 | 代码已提交或已记录跳过 | `git log -1` 确认 commit 存在，或 state 记录了跳过原因 | 执行 Step 2 |
| 2 | `state.md` 包含「阶段5」 | `grep "阶段5" <repo>/.acs-sdd-coding/state.md` | 立即写入 state.md |
| 3 | 流程状态已标记完成 | `grep "整体状态.*完成" <repo>/.acs-sdd-coding/state.md` | 补写流程状态 |

> **验证全部通过后**，执行 Step 7 清理 `.acs-sdd-coding/` 目录，然后输出返回摘要。

---

## 返回摘要

```
╭────────────────────────────────────────────╮
│        ✅ 阶段 5 完成 - ACS 流程结束       │
╰────────────────────────────────────────────╯

📋 提交信息
commit: {hash}
PR:     {pr_url}

📦 代码变更
分支: {branch_name}
系分: {doc_title}

🔧 迭代关联
迭代: {迭代关联ID或"未关联"}
打包: {打包结果或"未触发"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎉 全部阶段完成!
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ 阶段 1：输入收集与初始化
✅ 阶段 2：Spec 流程
✅ 阶段 3：编码与编译
{state.阶段4.执行状态 == "跳过" ? "⏭️" : "✅"} 阶段 4：自动化测试
✅ 阶段 5：提交 PR & 迭代关联

💡 建议执行 /acs-develop-review 对本次变更进行代码审查

[COMPLETE]
```

---

## 错误处理

| 情况 | 处理 |
|------|------|
| commit失败（权限） | 报错终止：无 commit 权限 |
| commit失败（冲突） | 报错终止：存在代码冲突 |
| push失败（权限） | 报错终止：无 push 权限 |
| push失败（网络） | 重试 3 次后报错终止 |
| PR创建失败 | 报错终止，输出手动创建命令 |
| 无变更内容 | 跳过提交，继续执行 push 和 PR 创建 |
| huoban-cli 不可用 | 静默跳过 Step 5，不影响流程 |
| platform 无法推断 | 静默跳过 Step 5，不影响流程 |
| module-id 推断失败 | AskUserQuestion 中提示用户手动输入 `module-id`，提供「跳过」选项 |
| sprint module add 失败 | 记录 warning 到 state.md，继续执行 Step 6 |
| package build 失败 | 记录 warning 到 state.md，继续执行 Step 6 |

---

## 重要约束

- **禁止在 commit 前修改代码**：代码修改应在阶段 3（build）完成
- **commit 失败时不继续**：commit 失败则不执行 push 和 PR 创建
- **push 失败时保留 commit**：不自动回滚 commit，由用户决定处理方式
- **阶段 4 失败不影响提交**：自动化测试阶段失败时仍可继续提交 PR
