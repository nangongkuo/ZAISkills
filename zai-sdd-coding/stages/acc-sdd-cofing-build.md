---
name: acs-sdd-coding:build
description: 阶段3-编码与编译。调用 OpenSpec apply 执行代码实现并完成编译检查。
---

# 阶段3：编码与编译检查

---

## 输入 Schema

| 字段 | 来源 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| repo_path | state.基本信息.仓库路径 | string | ✅ | 仓库绝对路径 |
| branch_name | state.基本信息.分支名 | string | ✅ | 当前分支名 |
| 设计稿 | state.阶段1.设计稿 | string | ❌ | 设计稿地址 |
| 提案 ID | state.阶段2.提案 ID | string | ✅ | 提案标识（change-name） |
| 提案路径 | state.阶段2.提案路径 | string | ✅ | 提案文件路径 |
| 关键文档 | state.阶段2.关键文档 | object | ✅ | 关键文档路径集合（proposal/spec/design/tasks） |
| 知识路径 | state.阶段2.知识路径 | string | ✅ | 知识路径文件路径 |
| 核心变更 | state.阶段2.核心变更 | string | ✅ | 核心变更摘要 |
| 涉及文件 | state.阶段2.涉及文件 | string | ❌ | 新增 N 个，修改 M 个 |

---

## 输出 Schema

| 字段 | 写入位置 | 类型 | 说明 |
|------|----------|------|------|
| 编译结果 | state.阶段3.编译结果 | string | 通过/失败 |
| 修复错误数 | state.阶段3.修复错误数 | number | 修复的编译错误数 |
| 修改文件 | state.阶段3.修改文件 | array | 修改的文件列表 |
| 编译产物路径 | state.阶段3.编译产物路径 | string | APK/.app/.hap 文件路径 |
| 质量检查 | state.阶段3.质量检查 | string | 通过/问题列表 |

---

## 输出约束【强制】

| 内容类型 | 输出限制 |
|----------|----------|
| 编译成功 | 仅：✅ 编译通过 |
| 编译失败 | 最多错误<100 字、最多 5 条 |
| 代码片段 | 每段<500 字符 |
| 完整文件 | **禁止输出** |

---

## 步骤清单

> 开始执行前实例化，每步完成后标记 ✅，输出 `[NEXT: stage=4]` 前逐项确认。

- [ ] Step 1：确认前置条件（config.yaml + 变更目录）
- [ ] Step 2：iOS sync 预检与后台启动
- [ ] Step 3：OpenSpec Apply 执行代码实现
- [ ] Step 4：编译检查（acs-build，必须编译整包）
- [ ] Step 5：处理编译结果
- [ ] Step 6：质量检查
- [ ] Step 7：更新 state.md

---

## 执行步骤

### Step 1：确认前置条件

**检查 config.yaml 是否存在**：

```
检查 <repo_path>/openspec/schemas/acs-spec/config.yaml 是否存在
├── 存在 -> 知识已注入，继续执行
└── 不存在 -> 警告：知识未注入，将使用默认能力
```

**检查变更目录是否存在**：

```
检查 <repo_path>/openspec/changes/<change-name>/ 是否存在
├── 存在 -> 继续
└── 不存在 -> 报错终止：变更目录不存在，请先执行阶段 2
```

---

### Step 2：iOS sync 预检与后台启动

**目的**：在编码开始前检测是否需要 `anc sync`，如需要则提前后台启动，与编码并行执行以节省时间。

**执行检测**：

```bash
python <acs-build-scripts>/detect_project_type.py <repo_path>
```

脚本输出 JSON，其中 `sync` 字段包含预检结果，**根据 `sync.status` 处理**：

| sync_status | 动作 | sync_status |
|-------------|------|-------------|
| not_applicable | 直接进入 Step 3 | not_applicable |
| skipped | 直接进入 Step 3 | skipped |
| needed | 后台启动 `cd <repo_path> && anc sync`（使用 Bash 工具 run_in_background: true） | running |

记录 sync_status 供 Step 4 使用。

---

### Step 3：调用 OpenSpec Apply 执行代码实现

**执行命令**：

```bash
cd <repo_path>
openspec instructions apply --change "<change-name>"
```

**OpenSpec 执行内容**：
1. 读取 tasks.md 任务清单
2. 读取 config.yaml context 中的知识文档
3. 按任务顺序执行开发
4. 参考知识文档中的 Preferred Entry 实现
5. 避免使用知识文档中 Avoid Native Or Raw Usage 列出的方式
6. 完成后标记复选框

**知识参考说明**：

config.yaml context 中已包含阶段 2 注入的知识文档，OpenSpec 在执行时会自动参考：
- API 调用方式参考 Preferred Entry
- 避免使用 Avoid Native Or Raw Usage 中的方式
- 遵循 Constraints 中的约束条件
- 按照 How To Use 中的步骤实现

**视觉稿还原**：若涉及 UI 实现，可调用设计稿还原 skill：

```
Skill 工具参数：
  skill: "dmore-codegen"
  args: {
    "dmore_url": "<设计稿地址>"
  }
```

设计稿地址从 `state.阶段1.设计稿` 获取。

**Skill 未找到处理**：若调用失败提示 skill 不存在，执行以下命令安装后重试：

```bash
tnpx @alipay/weavefox-skills install -u yuque.ch "dmore-codegen"
```

**接收输出**：
- 变更文件列表
- 任务完成状态

---

### Step 4：编译检查

根据 Step 2 的 sync_status 决定调用方式：

**sync_status = running**：
1. 等待后台 `anc sync` 任务完成
2. sync 成功 -> 调用 acs-build 并跳过 sync：
```
Skill 工具参数：
  skill: "acs-build"
  args: "skip_sync=true"
```
3. sync 失败 -> 正常调用 acs-build（由 acs-build 自行处理 sync）：
```
Skill 工具参数：
  skill: "acs-build"
```

**sync_status = skipped**：
```
Skill 工具参数：
  skill: "acs-build"
  args: "skip_sync=true"
```

**sync_status = not_applicable**（非 iOS 项目）：
```
Skill 工具参数：
  skill: "acs-build"
```

**重要约束**：
- Android 项目**必须编译完整 APK**（`./gradlew clean assembleDebug`），禁止模块级编译
- iOS 项目**必须编译完整 .app**，禁止只编译单个 target
- acs-build skill 内部已包含此约束和编译产物确认，调用时无需额外传参

---

### Step 5：处理编译结果

**编译成功**：
```
✅ 编译通过
进入质量检查...
```

**编译失败**：
- 分析错误原因
- 区分：相关错误 / 无关错误
- 相关错误：逐个修复，重新编译
- 无关错误：记录并告知用户

循环直到编译通过。

---

### Step 6：质量检查

**说明**：规范已在 OpenSpec config.yaml 中注入，此处仅做基础检查。

| 检查项 | 内容 |
|--------|------|
| 稳定性 | crash 风险（空指针、越界等） |
| 完整性 | 边界 case 处理 |
| 还原度 | UI 视觉效果（如有设计稿） |
| 日志覆盖 | 关键路径（功能入口、分支决策、外部交互、错误处理）是否包含日志输出，缺失时自动补充 |

**发现问题**：
- 自动修复可修复的问题
- 无法修复的问题记录到 `quality_check` 字段

---

### Step 7：更新状态文件

**路径**：`<仓库路径>/.acs-sdd-coding/state.md`

**更新基本信息**：
- 当前阶段：3 → 4
- 更新时间：{time}

**追加阶段 3 输出**：

```markdown
### 阶段3：编码与编译
状态：✅ 完成
完成时间：{time}
执行模式：agent
执行耗时：{duration}秒
编译结果：通过（修复 N 个错误）
修改文件：[文件列表]
编译产物路径：{apk/app/hap 路径}
质量检查：通过 / 问题列表

问题记录：
  - 级别：info
    描述：修复<N>个编译错误
    状态：已处理

## 待执行
下一阶段：4
```

---

## 完成前验证

> 步骤清单全部 ✅ 后，逐项执行以下验证。全部通过才可输出返回摘要。

| # | 验证项 | 检查方式 | 不通过时修复动作 |
|---|--------|----------|------------------|
| 1 | 编译已执行 | 编译结果变量已赋值（通过/失败） | 调用 acs-build |
| 2 | 编译产物存在 | `find <repo_path> -name "*.apk" -o -name "*.app" -o -name "*.hap" \| head -1` | 重新编译整包 |
| 3 | 质量检查已执行 | quality_check 变量已赋值 | 执行 Step 7 质量检查 |
| 4 | `state.md` 包含「阶段3」 | `grep "阶段3" <repo>/.acs-sdd-coding/state.md` | 立即写入 state.md |
| 5 | `state.md` 当前阶段已更新为 4 | `grep "当前阶段.*4" <repo>/.acs-sdd-coding/state.md` | 更新基本信息 |

---

## 返回摘要

```
╭────────────────────────────────────────────╮
│              ✅ 阶段 3 完成              │
╰────────────────────────────────────────────╯

📋 执行结果
编译结果：{通过/失败}（修复 {N} 个错误）
修改文件：{N} 个
质量检查：{通过/有问题}

📦 代码变更
新增文件：{N} 个
修改文件：{M} 个

🧪 测试用例
状态：{有/无} 测试用例
用例数：{N} 条

[NEXT: stage=4]
```

---

## 错误处理

| 情况 | 处理 |
|------|------|
| 变更目录不存在 | 报错终止：请先执行阶段 2 |
| config.yaml 不存在 | 警告，继续执行（无知识参考） |
| 编译错误>10 条 | 输出前 5 条，自动继续修复 |
| 无法修复 | 记录状态，继续流程 |
| 质量问题 | 记录到 quality_check，继续流程 |

---

## 重要约束

- **config.yaml 由阶段 2 生成，本阶段只读取使用**
- **禁止在本阶段修改 config.yaml**
- **OpenSpec apply 会自动参考 config.yaml context 中的知识**
- **编码实现必须遵循知识文档中的推荐方式**

---

## 调度器指令

> **本阶段执行完毕，输出上方返回摘要后，立即执行 `[NEXT: stage=4]`，进入阶段执行循环的下一轮，禁止停留等待用户输入。**
