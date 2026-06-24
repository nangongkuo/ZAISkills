---
name: acs-knowledge-scanner
description: 扫描用户指定的本地仓库根目录下的代码、注释和文档，围绕用户提供的一个或多个关键词提炼出单个自定义 feature 的 Markdown 总结文档，并把结果写入用户指定的目标仓库的 /knowledge 目录下。知识文件跟随仓库，不再区分 biz/project 类型。
---

# ACS Project Custom Feature Scanner V2

## Goal

围绕一组关键词，只沉淀一个 feature 文档，并让文档优先回答这三个问题：

- 什么时候应该使用这个 feature
- 在项目里应该怎么接入和调用
- 为什么不能直接使用原生方法或系统 API

始终把目标放在“帮助后续 AI 少走弯路、少误用原生能力”，不要产出泛泛而谈的模块介绍。

默认追求“最小可用上下文”：

- 只保留能帮助模型做决策的信息
- 不写长背景、不写分析过程、不贴大段源码
- 输出应像高信号速查卡，而不是设计文档

## Inputs

技能启动后，通过交互式对话引导用户逐步输入以下信息：

1. **扫描仓库**（必填）：输入 `.` 扫描当前仓库，或输入仓库地址（本地路径 / Git URL）
2. **扫描关键词**（必填）：用户指定要扫描的一个或多个关键词
3. **目标仓库目录**（必填）：用户指定知识文件要落入的目标仓库路径
4. **输出文档名**（必填）：用户指定输出文档的名称

用户输入每项信息后，技能会等待用户确认后再继续下一步。

## Workflow

### 1. 引导用户输入扫描配置

技能启动后，通过交互式对话引导用户完成以下配置，**交互原则：能选择就不让用户手动输入**，优先提供选项让用户点击，仅在选项无法覆盖时才要求文本输入。使用 AskUserQuestion 工具呈现选项。

**步骤 1：选择扫描仓库**
- 使用选项让用户选择扫描来源：
  - **当前仓库**（推荐）- 扫描当前工作目录
  - **输入本地路径** - 手动输入本地仓库路径
  - **输入 Git URL** - 输入远程仓库地址，自动浅克隆
- 大多数场景下用户会选择“当前仓库”，将其作为推荐默认项
- **Git URL 处理**：自动浅克隆到临时目录 `<目标仓库>/.acs-tmp/scan-<repo-name>/`
```bash
git clone --depth 1 "<git-url>" "<临时目录>"
```
扫描完成后自动删除临时目录
- **本地路径处理**：检查路径是否存在，不存在则报错提示

**步骤 2：选择功能类型**
- 使用选项让用户选择：
  - **project** - 业务项目特性，文档写入 `/knowledge/project/` 目录
  - **common** - 通用组件/基础库特性，文档写入 `/knowledge/common/<platform>/` 目录（`<platform>` 由扫描自动识别，如 `iOS`、`Android`、`HarmonyOS`）

**步骤 3：输入扫描关键词**
- 这是唯一必须由用户文本输入的步骤
- 提示用户输入要扫描的关键词（支持多个关键词，用逗号分隔。例如：直播推流、LivePush）
- 建议用户提供多个关键词以提高扫描覆盖率

**步骤 4：选择目标仓库目录**
- 根据上下文智能生成选项，让用户选择：
  - **当前工作目录**（推荐）- 使用当前工作目录作为目标仓库
  - **与扫描仓库相同** - 若步骤 1 选择了非当前目录的本地路径，提供此选项
  - **输入其他路径** - 手动输入目标仓库路径
- 注意：如果步骤 1 选择的是当前仓库，则“当前工作目录”和“与扫描仓库相同”含义重复，只展示“当前工作目录”和“输入其他路径”两个选项

**步骤 5：选择输出文档名**
- 根据用户在步骤 3 输入的关键词，自动生成 2-3 个候选文档名供用户选择
- 候选名生成规则：
  - 取主关键词的英文小写形式，用 `-` 连接，例如关键词“直播推流、LivePush”→ 候选名 `live-push`
  - 如果关键词已经是英文，直接转小写 kebab-case
  - 如果关键词是中文，尝试翻译为简短英文 kebab-case
- 同时提供“自定义名称”选项，让用户手动输入
- 所有候选名不带 `.md` 后缀

### 2. 识别并确认扫描仓库

用户输入配置后，技能自动执行以下操作：

**a）识别扫描仓库**

- 从用户指定的 `scan_root_dir` 出发，识别其中所有可读的本地仓库或项目目录
- 优先识别带有 `.git` 的目录；非 Git 项目但确实需要扫描的目录也可纳入
- 忽略明显无关的缓存目录、构建产物目录、依赖目录和临时目录

**b）展示扫描仓库列表并确认**

- 列出识别到的全部仓库/项目目录
- 友好提示用户确认是否正确
- 如果发现仓库明显超出本次主题，提醒用户清理或排除
- 等待用户确认后继续

### 3. 确认输出配置

**a）展示输出目标**

- 展示用户输入的目标仓库路径：`output_repo_dir`
- 展示用户选择的功能类型（`project` 或 `common`）
- 说明落盘规则：
  - 若功能类型为 `project`: `<output_repo_dir>/knowledge/project/<output_doc_name>.md`
  - 若功能类型为 `common`: `<output_repo_dir>/knowledge/common/<platform>/<output_doc_name>.md`（`<platform>` 由扫描自动识别）
- 告知用户文档将写入目标仓库的对应目录（project 知识或 common 知识）

**b）仓库版本提醒**

- 友好提示用户确认扫描仓库是否已更新到需要分析的版本
- 告知用户：技能不会执行 `git checkout`、`git pull`、不自动切换分支、不修改扫描仓库现场
- 等待用户确认后继续

### 4. 扫描代码、注释和文档

优先建立“定义点 + 统一入口 + 真实调用点 + 禁止绕过证据”的证据链。

默认扫描用户指定的 `scan_root_dir` 下识别出的全部目标仓库，不要求用户逐个再次输入。

至少搜索以下信息：

- feature 封装类、门面层、manager、service、provider、hook、util、helper
- 注释、README、设计文档、迁移文档、模块说明
- 测试、示例代码、demo、接入样例
- 直接调用原生 API 的历史痕迹，以及项目里对这种写法的替代

优先搜索顺序：

1. 代码定义点
2. 统一入口或封装层
3. 业务调用点
4. 文档和注释里的规范说明
5. 反例、兼容层、deprecated 提示、lint 或 wrapper 痕迹

**短路规则**：如果前两轮搜索已同时命中“定义点 + 调用点 + 禁用/替代证据”，可跳过剩余低优先级搜索。仅当证据不足时才继续扩展搜索范围。

不要因为一个关键词命中就下结论。至少交叉验证两个以上证据来源。

**遇到不确定时必须询问用户**：

扫描过程中如果出现以下情况，必须暂停并向用户提问，不得自行假设或跳过：

- 关键词命中了多个含义不同的模块或类，无法判断用户想要的是哪一个
- 找到了疑似封装层，但不确定它是当前推荐入口还是已废弃的旧方案
- 代码结构或命名风格超出你的理解范围，无法确定其用途或调用关系
- 扫描结果相互矛盾（例如文档说明 A，但代码里大量调用 B）
- 找不到足够证据，但你不确定是“确实不存在”还是“搜索策略遗漏了”

原则：**不要隐藏困惑，不要假设**。宁可多问一次用户，也不要在文档中写入不确定的结论。向用户提问时，说明你目前找到了什么、困惑在哪里、需要用户帮你确认什么。

### 5. 判断项目推荐写法

围绕下面问题整理结论：

- 项目是否已经把原生能力包装成统一入口
- 调用方是否普遍通过统一入口使用
- 仓库里是否明确表达过“不要直接调用系统能力”
- 哪个封装才是当前推荐方式
- 不同场景下是否存在不同入口和优先级

如果只能找到原生调用，而找不到稳定封装，不要编造“项目标准”。可以写明“当前未发现稳定封装，暂不建议沉淀为项目 custom feature”。

对于上述每个问题，如果你只有猜测而没有代码证据，必须标注为“未确认”并向用户说明你的推测依据，让用户决定是否采纳。

### 6. 写 feature 文档并写入目标仓库

**写 feature 文档**

写文档时优先满足“让 AI 一眼知道什么时候使用、怎么用、不要怎么用”。

必须遵循：

- 先写 `什么时候使用`，再写 `怎么用`
- 明确写出推荐入口，不要只写模块背景
- 如果存在禁止项，明确写出“不建议直接使用哪些原生方法”
- `Import` 必须给出真实的 import 语句（1-2 行），让后续 AI 直接复制使用
- `Code Example` 必须给出 3-5 行最小可运行的正确用法，体现 Preferred Entry 的实际调用
- 结论必须能被扫描证据支撑

文档结构使用 [feature-document-template.md](./references/feature-document-template.md)，并按以下要求添加 meta 信息：

**文档 frontmatter 必须包含以下信息：**
```yaml
---
meta:
  name: <feature-name>
  description: <feature-description>
  keywords: [<keyword1>, <keyword2>, ...]
---
```

- `name`: feature 名称，必须与 output_doc_name 一致
- `description`: feature 描述，一句话说明这个 feature 是什么、在什么场景下使用
- `keywords`: 关键词数组，用于 AI 检索，可包含用户输入的关键词及其变体（缩写、别名等）

额外要求：

- 默认控制在 150 到 300 字或同等信息密度内
- 每个章节只保留 1 到 3 条最高价值信息
- 如果一条信息不能改变后续模型的实现决策，就不要写
- 证据只保留最关键的 2 到 4 个路径
- 开放问题只有真的会影响使用决策时才写，没有就省略
- **`Scanned Repos` 章节**：功能类型为 `common` 时**必须写入**（即使只扫描了 1 个仓库），列出所有扫描过的仓库名。该字段用于知识匹配时的仓库归属过滤，缺失会导致知识被错误匹配到不相关的仓库，功能类型为 `project` 时可省略

**写入目标仓库对应目录**

根据用户选择的功能类型，将文档写入对应目录：
- 若功能类型为 `project`: 写入 `<output_repo_dir>/knowledge/project/<output_doc_name>.md`
- 若功能类型为 `common`: 写入 `<output_repo_dir>/knowledge/common/<platform>/<output_doc_name>.md`（`<platform>` 由扫描自动识别，如 `iOS`、`Android`、`HarmonyOS`）

**common 知识 .gitignore 检查（仅功能类型为 common 时执行）**

common 类型的知识文档不应该跟随仓库提交到远端（因为它是本地扫描产物，不同开发者的本地环境可能不同）。写入 common 文档后，必须执行以下检查：

1. 检查目标仓库根目录下是否存在 `.gitignore` 文件
   - 若不存在，创建 `.gitignore` 文件
2. 读取 `.gitignore` 内容，检查是否已包含 `knowledge/common/` 相关的忽略规则
   - 匹配以下任一模式即视为已配置：`knowledge/common/`、`knowledge/common`、`/knowledge/common/`、`/knowledge/common`
3. 若未找到匹配规则，在 `.gitignore` 末尾追加：
```
# AI 扫描产出的 common 知识文档（本地产物，不提交）
knowledge/common/
```
4. 向用户告知 `.gitignore` 的变更情况（已存在规则则告知无需修改，新增规则告知已自动添加）

注意：`project` 类型的知识文档在普通仓库中允许跟随仓库提交，但对于**白名单仓库**（`knowledge/project/` 由远端维护的），需要通过 `upload-project` 上传到远端 project 知识仓库（见下方 project 知识 upload 规则）。

**project 知识 .gitignore 检查（仅功能类型为 project 且目标仓库为白名单仓库时执行）**

白名单仓库的 `knowledge/project/` 由远端维护，不应跟随仓库提交。写入 project 文档后，必须执行以下检查：

1. 判断目标仓库是否为白名单仓库：
```bash
REPO_NAME=$(cd <output_repo_dir> && git remote get-url origin | sed 's/.*\///' | sed 's/\.git$//')
# 白名单列表见 acs-knowledge-index CLI 内置 PROJECT_REMOTE_REPOS
```
2. 若在白名单中，检查目标仓库根目录下 `.gitignore` 是否已包含 `knowledge/project/` 相关的忽略规则
   - 匹配以下任一模式即视为已配置：`knowledge/project/`、`knowledge/project`、`/knowledge/project/`、`/knowledge/project`
3. 若未找到匹配规则，在 `.gitignore` 末尾追加：
```
# AI 扫描产出的 project 知识文档（远端维护，不提交）
knowledge/project/
```
4. 向用户告知 `.gitignore` 的变更情况

**确认落盘结果**

写入完成后，向用户确认：
- 最终落盘路径

**common 知识 upload（仅功能类型为 common 时执行）**

common 知识不跟随业务仓库提交，需要上传到远端知识仓库供团队通过 sync 获取。

文档写入本地后，先确保 CLI 可用，并询问用户是否上传：

1. **检查并安装 acs-knowledge-index CLI**:
```bash
# 检查 CLI 是否已安装
if ! which acs-knowledge-index &>/dev/null; then
  echo "acs-knowledge-index CLI 未找到，请先执行 acs-install.sh 安装"
  exit 1
fi
```

- 若 CLI 未安装，向用户提示：`acs-knowledge-index CLI 未找到，请先执行 acs-install.sh 安装`，跳过 upload 步骤
2. 向用户说明：common 知识已写入本地，但是需要 `upload` 到远端知识仓库才能供团队使用
3. 询问用户：「是否立即上传到远端知识仓库？」
   - 若用户确认：直接执行 `acs-knowledge-index upload --platform <platform> <output_repo_dir>`，其中 `<platform>` 根据扫描识别的项目平台自动填充，`<output_repo_dir>` 使用用户输入的目标仓库路径。CLI 默认只上传新增文件，跳过远端已存在的同名文件；如需覆盖可加 `--force`。执行完成后向用户反馈上传结果
   - 若用户拒绝：告知用户后续可手动执行上述命令完成上传，继续后续流程


**project 知识 upload（仅功能类型为 project 且目标仓库为白名单仓库时执行）**

白名单仓库的 `knowledge/project/` 由远端 project 知识仓库维护（gitignored），不跟随业务仓库提交。文档写入本地后需 upload 到远端仓库供团队通过 sync 获取。

**判断条件**：功能类型为 `project`，且目标仓库的 git remote 仓库名在白名单中（CLI 内置 `PROJECT_REMOTE_REPOS` 列表）。

判断方式:
```bash
# 提取仓库名
REPO_NAME=$(cd <output_repo_dir> && git remote get-url origin | sed 's/.*\///' | sed 's/\.git$//')
# 检查是否在白名单（由 CLI 内部判断，此处仅说明原理）
```

执行步骤：
1. 确保 `acs-knowledge-index` CLI 可用（同 common upload 的检查逻辑）
2. 向用户说明：该仓库的 project 知识由远端维护，需要 upload 到远端 project 知识仓库
3. 询问用户：「是否立即上传到远端 project 知识仓库？」
   - 若用户确认：执行 `acs-knowledge-index upload-project <output_repo_dir>`。CLI 默认只上传新增文件；如需覆盖可加 `--force`。执行完成后向用户反馈上传结果
   - 若用户拒绝：告知用户后续可手动执行上述命令完成上传，继续后续流程

> 注意：对于非白名单仓库的 project 知识，仍沿用原有逻辑（跟随仓库 git commit），不执行此 upload 步骤。

### 7. 确认写入结果与更新索引

文档写入目标仓库后，确认以下事项：

- 文档是否正确落入目标目录
- 文件是否包含完整的 meta 信息

**更新目标仓库知识索引**：

写入成功后，重新扫描目标仓库的知识目录并更新索引：

```bash
acs-knowledge-index scan <目标仓库路径> \
  --platform auto \
  --output <目标仓库路径>/knowledge/knowledge-index.json
```

**knowledge-index.json .gitignore 检查**：

`knowledge-index.json` 是本地扫描产物，不应跟随仓库提交，每次生成索引后，必须执行以下检查：

1. 检查目标仓库根目录下是否存在 `.gitignore` 文件
   - 若不存在，创建 `.gitignore` 文件
2. 读取 `.gitignore` 内容，检查是否已包含 `knowledge-index.json` 相关的忽略规则
   - 匹配以下任一模式即视为已配置：`knowledge-index.json`、`knowledge/knowledge-index.json`、`**/knowledge-index.json`
3. 若未找到匹配规则，在 `.gitignore` 末尾追加：
```
# AI 扫描产出的知识索引文件（本地产物，不提交）
knowledge/knowledge-index.json
```
4. 向用户告知 `.gitignore` 的变更情况

**清理临时目录**：

如果扫描源是 Git URL（步骤 1 中克隆的临时目录），在写入和索引更新完成后删除：

```bash
rm -rf <目标仓库>/.acs-tmp/scan-<repo-name>/
```

**异常处理**

若写入失败，按失败原因处理：

1. **目标目录不存在**:
   - 创建对应的目录结构
   - 重试写入

2. **权限错误**:
   - 终止流程，向用户报告失败原因
   - 由用户决定是否重试或手动处理

3. **其他错误**:
   - 终止流程，向用户报告失败原因
   - 由用户决定是否重试或手动处理

## Platform-Aware Scan Rules

根据项目平台类型，自动应用对应的排除目录和高价值搜索路径。

### 排除目录

| 平台 | 排除目录 |
|------|----------|
| Android | `build/`, `.gradle/`, `.idea/`, `gradle/`, `local.properties` |
| iOS | `Pods/`, `DerivedData/`, `*.xcworkspace/`, `*.build/`, `Carthage/` |
| 鸿蒙 (HarmonyOS) | `oh_modules/`, `.preview/`, `build/`, `entry/build/` |
| KMP | `build/`, `.kotlin/`, `kotlin-js-store/` |
| 通用 | `node_modules/`, `.cache/`, `vendor/`, `.git/` |

### 高价值搜索路径

| 平台 | 优先扫描路径 |
|------|--------------|
| Android | `src/main/java/**`, `src/main/kotlin/**`, `buildSrc/`, `gradle/*.kts` |
| iOS | `Sources/`, `Classes/`, `*.swift`, `*.m`, `*.h`, `Podfile` |
| 鸿蒙 (HarmonyOS) | `entry/src/main/ets/**`, `commons/`, `features/`, `oh-package.json5` |
| KMP | `shared/src/commonMain/`, `composeApp/`, `iosApp/`, `androidApp/` |

扫描时根据仓库实际内容自动判断平台类型，无需用户手动指定。如果仓库包含多个平台代码，合并适用规则。

## Workspace Rules

- 扫描阶段只读取源仓库，不做任何修改
- 不自动执行 git 操作（checkout / pull / push / commit）
- 输出路径需经用户确认后才写入
- 多仓扫描时，推荐将输出路径与扫描路径物理隔离，避免扫描现场与知识沉淀互相污染

## Example

以直播业务为例：

- `common` 仓里定义了某个 feature 的封装
- `myLive` 仓里实际调用了这个 feature

推荐做法：

- 扫描根目录：包含 `common` 和 `myLive` 两个待扫描仓库的父目录
- 目标仓库：`myLive` 或其他知识仓库
- 扫描时同时读取 `common` 的定义点和 `myLive` 的使用点
- 扫描前先提示用户自行更新 `common` 和 `myLive` 到需要分析的本地版本
- 文档写入目标仓库的 `/knowledge/project/` 目录（仓库知识）

如果只扫描一个仓库，流程相同：扫描前确定目标仓库，文档写入目标仓库的 `/knowledge` 目录。

## Search Strategy

优先使用快速文本搜索工具扫描工作目录下的全部目标仓库，并根据命中结果继续追踪上下游。

建议从这些线索开始：

- 关键词原词、大小写变体、缩写
- 可能的类名、模块名、方法名前后缀
- `deprecated`、`wrapper`、`facade`、`adapter`、`compat`
- `不要直接`、`统一入口`、`推荐`、`封装`、`迁移`

高价值证据优先级：

1. 统一入口定义点
2. 多个业务模块共用的真实调用点
3. 注释或文档里的规范性表述
4. 测试或 demo 里的标准接法
5. 原生调用被包裹、替代或限制的痕迹

低价值信号：

- 只有一次性的业务命中
- 只有模块名重合，没有调用关系
- 只有原生 API 出现，没有项目封装

## Output Rules

### 单次只写一个 feature

一次运行只能产出一个 feature 文档。

允许：

- 多个关键词共同描述同一个 feature
- 多个仓库共同为同一个 feature 提供证据

不允许：

- 一个请求里同时写多个互不相关的 feature 文档
- 把不同 feature 混成一篇“大杂烩”说明

### 优先让 AI 易检索

写作时优先考虑检索效率：

- 标题和摘要尽量包含主 feature 名
- 关键词单独成节
- 路径使用“仓库名 + 仓库内相对路径”的稳定形式
- 规则短句化，不写大段背景介绍

### 优先压缩上下文成本

输出时优先做信息压缩，而不是信息穷举：

- 用一句话讲清“场景 + 推荐入口 + 禁止项”
- 用最少字段表达稳定规则
- 同类证据不重复列举
- 能合并进短句的信息，不拆成多个段落
- 非关键历史、实现细节、推导过程一律省略

### 优先约束误用

如果项目里存在“应该走封装而不是直接调用原生”的意图，必须显式写出来：

- 哪些原生能力不要直接使用
- 为什么不要直接使用
- 应该改走哪个入口
- 特殊场景下允许的例外是什么

## Quality Bar

满足以下条件再沉淀为 custom feature:

- 至少能定位一个定义点或统一入口
- 至少能定位一个真实调用点
- 能说明推荐写法与原生写法的关系
- 结论来自代码、注释、文档中的至少两类证据

如果达不到这个门槛：

- 不要硬写“最佳实践”
- 明确说明证据不足点
- 不更新索引，避免污染后续 AI 检索
- 向用户明确报告哪些结论缺乏证据支持，由用户决定是否继续沉淀

## Deliverables

完成一次运行后，交付以下内容：

**写入目标仓库的文件**:
- 若功能类型为 `project`: `<output_repo_dir>/knowledge/project/<output_doc_name>.md`
- 若功能类型为 `common`: `<output_repo_dir>/knowledge/common/<platform>/<output_doc_name>.md`

最终汇报时，明确说明：

- 扫描根目录：`<scan_root_dir>`
- 功能类型：`<project/common>`
- 实际扫描仓库：`<repo list>`
- 目标仓库：`<output_repo_dir>`
- 最终输出路径：`<final-output-path>`
