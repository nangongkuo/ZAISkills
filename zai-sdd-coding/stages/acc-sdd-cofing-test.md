---
name: acs-sdd-coding:test
description: 阶段 4-自动化测试。打包并安装到模拟器验证。
---

# 阶段 4：自动化测试

**执行条件**：`state.阶段2.有测试用例` 为 `true` 时执行，否则跳过。

---

## 输入 Schema

| 字段 | 来源 | 类型 | 必填 | 说明 |
|------|------|------|------|------|
| repo_path | state.基本信息.仓库路径 | string | ✅ | 仓库绝对路径 |
| branch_name | state.基本信息.分支名 | string | ✅ | 当前分支名 |
| 编译结果 | state.阶段3.编译结果 | string | ✅ | 编译结果 |
| 有测试用例 | state.阶段2.有测试用例 | boolean | ✅ | 是否需要执行测试 |
| 测试用例文档URL | state.阶段2.测试用例文档URL | string | ❌ | 语雀测试用例文档 URL（有测试用例时必填，来源为调用方传入的 test_yuque_url） |

---

## 输出 Schema

| 字段 | 写入位置 | 类型 | 说明 |
|------|----------|------|------|
| 执行状态 | state.阶段4.执行状态 | string | 执行/跳过 |
| 跳过原因 | state.阶段4.跳过原因 | string | 跳过时的原因 |
| 打包结果 | state.阶段4.打包结果 | string | 成功/失败 |
| 包路径 | state.阶段4.包路径 | string | 包文件路径 |
| 安装结果 | state.阶段4.安装结果 | string | 成功/失败 |
| 验证结果 | state.阶段4.验证结果 | string | 通过/失败/跳过 |
| 测试报告 | state.阶段4.测试报告 | object | acs-auto-test 返回的测试报告（含 passed/failed/用例详情） |
| 重试次数 | state.阶段4.重试次数 | number | 测试失败后的重试次数 |

---

## 步骤清单

> 开始执行前实例化，每步完成后标记 ✅，输出 `[NEXT: stage=5]` 前逐项确认。

- [ ] Step 1：检查执行条件
- [ ] Step 2：识别平台
- [ ] Step 3：执行打包
- [ ] Step 4：安装到模拟器
- [ ] Step 5：调用 acs-auto-test
- [ ] Step 6：解析测试报告
- [ ] Step 7：测试失败修复循环（如需要）
- [ ] Step 8：更新 state.md

> **跳过场景**：Step 1 判定无测试用例时，仅需完成 Step 1 + Step 8（state.md 记录跳过），其余标记 ⏭️。

---

## 执行步骤

### Step 1：检查执行条件

**判断是否执行此阶段**：

```
读取 state.阶段2.有测试用例
├── false -> 跳过此阶段，记录跳过状态，直接进入阶段 5
└── true  -> 继续执行
```

---

### Step 2：识别平台

根据仓库结构识别目标平台：

| 判断条件 | 平台 |
|----------|------|
| 存在 `*.xcodeproj` 或 `*.xcworkspace` | iOS |
| 存在 `build.gradle` 或 `app/build.gradle` | Android |

#### 判断项目类型（iOS）

iOS 项目可能是 **App** 或 **Framework**，只有 App 类型才能直接打包成 `.app`：

```bash
# 检查主工程产品类型
grep "productType" <project>.xcodeproj/project.pbxproj | head -1

# 结果判断：
# - com.apple.product-type.application -> App，可直接打包
# - com.apple.product-type.framework   -> Framework，需要查找依赖的 App target
```

#### Framework 项目的 App Target 查找

当主工程是 Framework 时，需要查找可用的 App target 进行打包：

**查找顺序**：

| 优先级 | 位置 | 说明 |
|--------|------|------|
| 1 | `Pods/Portal/Portal/Portal.xcodeproj` | 支付宝 Portal 主工程 |
| 2 | `Pods/<App>/` | 其他 Pod 依赖中的 App |
| 3 | `<workspace>` | 由其他 project / workspace 关联的项目 |

**执行命令**：

```bash
# 1. 检查 Pods 目录下的 Portal
ls Pods/Portal/Portal/Portal.xcodeproj 2>/dev/null

# 2. 确认 Portal 是 App 类型
grep "productType" Pods/Portal/Portal/Portal.xcodeproj/project.pbxproj

# 3. 列出 Portal 的 schemes
xcodebuild -list -project Pods/Portal/Portal/Portal.xcodeproj
```

---

### Step 3：执行打包

#### iOS 打包

**场景 A：主工程是 App**

```bash
cd <repo_path>

# 查找 scheme
xcodebuild -list -project <project_name>.xcodeproj
# 或
xcodebuild -list -workspace <workspace_name>.xcworkspace

# 构建 for 模拟器
xcodebuild \
  -workspace <workspace_name>.xcworkspace \
  -scheme <scheme_name> \
  -sdk iphonesimulator \
  -configuration Debug \
  -derivedDataPath ./build \
  build
```

**场景 B：主工程是 Framework（需要通过 Portal 打包）**

```bash
cd <repo_path>

# 必须使用 workspace 构建（Portal 依赖 Pods 环境）
xcodebuild \
  -workspace <workspace_name>.xcworkspace \
  -scheme Portal \
  -sdk iphonesimulator \
  -configuration Debug \
  -derivedDataPath ./build \
  build

# 注意：不要单独构建 Pods/Portal/Portal/Portal.xcodeproj
# 原因：Portal 需要完整的 Pods 环境和依赖配置
```

**查找生成的 App 包**：

```bash
# 查找生成的 .app 文件
find ./build -name "*.app"

# 典型路径：
# ./build/Build/Products/Debug-iphonesimulator/AlipayWallet.app
# ./build/Build/Products/Debug-iphonesimulator/<app-name>.app
```

**获取 Bundle ID**：

```bash
# 方法 1：使用 plutil（推荐）
plutil -extract CFBundleIdentifier raw <app_path>/Info.plist

# 方法 2：使用 defaults
defaults read <app_path>/Info.plist CFBundleIdentifier
```

#### Android 查找 APK

Android APK 在阶段 3（build）中已生成，直接查找即可：

```bash
# APK 可能存在的路径（按优先级查找）
APK_PATHS=(
  "bundle_runtime/build/outputs/apk/debug/bundle_runtime-debug.apk"
  "bundle_runtime/build/intermediates/apk/debug/bundle_runtime-debug.apk"
)

for path in "${APK_PATHS[@]}"; do
  if [ -f "$path" ]; then
    echo "✓ 找到 APK: $path"
    APK_FILE="$path"
    break
  fi
done

# 若上述路径都找不到，尝试全局搜索
if [ -z "$APK_FILE" ]; then
  APK_FILE=$(find . -name "*.apk" -path "*/debug/*" | head -1)
fi
```

**打包失败处理**：
- 记录失败原因
- 继续进入阶段 5（提交 PR）
- 在状态文件中记录失败信息

---

### Step 4：安装到模拟器

#### iOS 模拟器

```bash
# 1. 列出可用模拟器
xcrun simctl list devices

# 2. 检查是否有已启动的模拟器
xcrun simctl list devices booted

# 3. 启动模拟器（如未启动）
xcrun simctl boot "<device_name>"

# 4. 安装 App
xcrun simctl install booted <app_path>

# 5. 获取 Bundle ID（从安装的 App）
plutil -extract CFBundleIdentifier raw <app_path>/Info.plist

# 6. 启动 App
xcrun simctl launch booted <bundle_id>
```

#### Android 模拟器

```bash
# 1. 检查是否有已启动的模拟器
adb devices

# 2. 若无模拟器运行，列出可用模拟器
emulator -list-avds

# 3. 启动模拟器（如未启动）
emulator -avd <avd_name> -detached

# 4. 等待模拟器启动完成
adb wait-for-device

# 5. 安装 APK
adb install -r <apk_path>

# 6. 获取包名
aapt dump badging <apk_path> | grep package

# 7. 启动 App
adb shell am start -n <package_name>/<activity_name>
```

**安装失败处理**：
- 记录失败原因
- 继续进入阶段 5（提交 PR）

---

### Step 5：调用 acs-auto-test

**前置条件**：App 已安装并启动（Step 4 完成）

**调用参数**：

**输入参数**：

```json
{
  "platform": "{android/ios}",
  "yuque_url": "{state.阶段2.测试用例文档URL}"
}
```

**平台获取**：从 Step 2 识别的平台（注意：传给 acs-auto-test 时需小写：android / ios）

**测试用例文档 URL**：从 `state.阶段2.测试用例文档URL` 读取。acs-auto-test 会自动解析语雀文档中的前置配置和测试用例表格，支持视觉对比、行为预期、日志校验三种类型。

**执行命令**：

```
调用 Skill 工具:
  skill: "acs-auto-test"
  args: <上述 JSON 参数>
```

### Step 6：解析测试报告

**测试报告格式**（acs-auto-test 返回）：

```json
{
  "platform": "android",
  "cases": [
    {
      "case_id": "case_001",
      "type": "behavior",
      "instruction": "进入直播间，右下角三个点设置按钮",
      "status": "passed"
    },
    {
      "case_id": "case_002",
      "type": "log_check",
      "instruction": "进入直播间，点击评论输入框",
      "status": "failed",
      "failure_info": {
        "error_type": "assertion_failed",
        "error_message": "日志中未找到关键字 \"CommentInput\"",
        "assertion_detail": {
          "keyword": "CommentInput",
          "found": false,
          "log_source": "adb_logcat"
        }
      }
    },
    {
      "case_id": "case_003",
      "type": "visual_diff",
      "instruction": "进入直播间，等待5秒后截图",
      "status": "passed",
      "assertion_detail": {
        "score": 92,
        "issues": "P0:0, P1:1, P2:3",
        "report_path": "~/acs-client-sdd-workspace/visual-diff-reports/visual-diff-android-20260430-160000.md",
        "decision": "修复后通过"
      }
    }
  ]
}
```

**关键字段说明**：
- `type`：测试类型（behavior / visual_diff / log_check）
- `status`：执行状态（passed / failed / error）
- `failure_info.error_type`：错误类型（assertion_failed / flow_error / element_not_found 等）
- `failure_info.error_message`：错误描述，用于修复定位
- `assertion_detail`：断言详情（visual_diff 含评分和报告路径，log_check 含关键字匹配信息）

### Step 7：测试失败修复循环

**最大重试次数**：5 次

**修复流程**：

```
解析测试报告
    ↓
检查是否有 failed case
├── 无 failed -> 测试通过，进入 Step 8
└── 有 failed -> 进入修复循环
    ↓
分析失败原因
    ↓
修改代码（根据 reason 定位问题）
    ↓
重新编译（调用 acs-build 或执行编译命令）
    ↓
重新安装 App
    ↓
再次调用 acs-auto-test
    ↓
检查结果
├── 全部通过 -> 测试通过，进入 Step 8
├── 仍有失败且未达上限 -> 继续修复循环
└── 达到最大重试次数 -> 记录失败，进入 Step 8
```

**修复策略**：

| failure_info.error_type | 含义 | 修复策略 |
|-------------------------|------|----------|
| `assertion_failed` | 断言失败（需改代码） | 根据 error_message 及 assertion_detail 定位问题，修改代码 |
| `flow_error` | 流程问题（不需改代码） | 检查测试配置或重跑，不修改代码 |
| `element_not_found` | 元素未找到 | 检查 UI 代码，确认元素 ID/文本是否正确 |
| `navigation_failed` | 导航失败 | 检查页面跳转逻辑或 scheme 配置 |
| `max_steps_reached` | 达到最大步数 | 检查操作链路是否合理，可能需要简化步骤 |
| `app_crashed` | 应用崩溃 | 检查 crash 日志，修复崩溃问题 |

> **注意**：`flow_error` 类型的失败不需要修改代码，重跑即可；`assertion_failed` 才需要进入代码修复流程。

---

### Step 8：更新状态文件

**路径**：`<仓库路径>/.acs-sdd-coding/state.md`

**执行成功时追加**：

```markdown
### 阶段4：自动化测试
状态：✅ 完成
完成时间：{time}
执行模式：agent
执行耗时：{duration}秒
执行状态：执行
打包结果：成功
包路径：{app_path}
安装结果：成功
验证结果：通过
重试次数：{retry_count}
测试报告：
  平台：{platform}
  用例总数：{total}
  通过：{passed}
  失败：0

问题记录：[]
```

**跳过时追加**：

```markdown
### 阶段4：自动化测试
状态：⏭️ 跳过
完成时间：{time}
执行状态：跳过
跳过原因：未提供测试用例文档

问题记录：[]
```

**失败时追加**：

```markdown
### 阶段4：自动化测试
状态：⚠️ 失败（已继续）
完成时间：{time}
执行模式：agent
执行耗时：{duration}秒
执行状态：执行
打包结果：{成功/失败}
失败原因：{error_message}
重试次数：{retry_count}
测试报告：
  平台：{platform}
  用例总数：{total}
  通过：{passed}
  失败：{failed}
  失败用例：
    - {case_id} ({type}): {error_type} - {error_message}

问题记录：
  - 级别：warn
    描述：自动化测试存在失败用例，已达到最大重试次数
    状态：已处理
```

**更新基本信息**：
- 当前阶段：4 → 5
- 更新时间：{time}

---

## 完成前验证

> 步骤清单全部 ✅ / ⏭️ 后，逐项执行以下验证。全部通过才可输出返回摘要。

| # | 验证项 | 检查方式 | 不通过时修复动作 |
|---|--------|----------|------------------|
| 1 | `state.md` 包含「阶段4」 | `grep "阶段4" <repo>/.acs-sdd-coding/state.md` | 立即写入（执行/跳过/失败） |
| 2 | 执行状态已明确 | `state.阶段4.执行状态` 有值 | 写入「执行」或「跳过」 |
| 3 | 跳过时原因已记录 | 跳过场景下 state 包含跳过原因 | 补写跳过原因 |
| 4 | `state.md` 当前阶段已更新为 5 | `grep "当前阶段.*5" <repo>/.acs-sdd-coding/state.md` | 更新基本信息 |

---

## 返回摘要

**执行成功**：

```
╭────────────────────────────────────────────╮
│              ✅ 阶段 4 完成              │
╰────────────────────────────────────────────╯

📋 测试结果
打包：成功
安装：成功
测试：通过
用例：{passed}/{total} 通过
重试：{retry_count} 次

[NEXT: stage=5]
```

**跳过**：

```
╭────────────────────────────────────────────╮
│    ⏭️ 阶段 4 跳过（未提供测试用例文档）   │
╰────────────────────────────────────────────╯

[NEXT: stage=5]
```

**失败**：

```
╭────────────────────────────────────────────╮
│         ⚠️ 阶段 4 失败（已继续执行）      │
╰────────────────────────────────────────────╯

失败原因
{error_message}

[NEXT: stage=5]
```

---

## 错误处理

| 情况 | 处理 |
|------|------|
| 无测试用例 | 跳过此阶段 |
| 平台识别失败 | 记录错误，跳过此阶段 |
| 主工程是 Framework 且找不到 App target | 记录失败，继续提交 PR |
| 打包失败 | 记录失败，继续提交 PR |
| 安装失败 | 记录失败，继续提交 PR |
| 测试用例失败 | 修复代码后重试，最多 5 次 |
| 达到最大重试次数仍有失败 | 记录失败，继续提交 PR |

### 常见问题排查

| 问题 | 原因 | 解决方案 |
|------|------|----------|
| `productType_not_found` | project.pbxproj 格式异常 | 检查项目文件完整性 |
| `Portal 构建失败` | 单独构建 Portal.xcodeproj | 使用 workspace 构建 |
| `App 安装失败` | 模拟器未启动或架构不匹配 | 确认模拟器已启动，检查架构 |
| `App 启动失败` | Bundle ID 不正确 | 从 Info.plist 重新获取 Bundle ID |
| `找不到 .app 文件` | 构建失败或路径错误 | 检查 derivedDataPath 下的 Products 目录 |
| `找不到 APK 文件` | 阶段 3 未生成 APK | 检查 build 阶段是否成功 |
| `adb devices 为空` | 模拟器未启动 | 启动 Android 模拟器 |
| `adb install 失败` | 签名冲突或存储空间不足 | 使用 -r 参数覆盖安装，清理模拟器空间 |

---

## 重要约束

- **失败不阻塞**：此阶段失败不影响 PR 创建
- **跳过需记录**：跳过时必须在状态文件中记录原因
- **无用户确认**：此阶段自动执行，无需用户确认

---

## 调度器指令

> **本阶段执行完毕，输出上方返回摘要后，立即执行 `[NEXT: stage=5]`，进入阶段执行循环的下一轮，禁止停留等待用户输入。**
