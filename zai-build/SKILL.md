---
name: acs-build
human-name: "编译检查"
description: 编译检查 Skill。当用户需要检查 iOS 或 Android 项目编译状态时使用。背景：用户已完成代码编写，但编译通常不通过，需要执行命令完成工程编译并将结果反馈给调用用户。触发条件：用户提到编译检查、build check、anc build、gradlew 编译等关键词时激活。
model: "opus"
allowed-tools: Bash(bash *)
owner: "肖麟"
---

# 编译检查

## 概述

此 Skill 用于在代码编写完成后执行编译检查，确保 iOS 或 Android 工程能够正常编译通过，执行编译命令并将结果反馈给调用用户。

## 触发条件

当用户进行以下操作时激活此 Skill：
- 提到"编译检查"、"acs-build"、"编译验证"
- 提到 iOS 编译命令 `anc build`
- 提到 Android 编译命令 `./gradlew clean`、`./gradlew assembleDebug`
- 用户已完成代码编写，需要验证编译是否通过

## 工作流程

### Step 1：确定项目根目录

询问用户项目根目录路径，如果用户已提供，直接进入 Step 2。

**询问示例：**
- "请提供项目根目录路径"
- "项目的根目录在哪里？"

### Step 2：检测项目类型

根据项目根目录下的文件结构自动检测是 iOS、Android 还是鸿蒙项目：

**iOS 项目特征：**
- 存在 `.xcodeproj` 或 `.xcworkspace` 文件
- 存在 `Podfile` 文件
- 目录结构包含 iOS 源代码

**Android 项目特征：**
- 存在 `build.gradle` 或 `settings.gradle` 文件
- 存在 `gradlew` 可执行文件
- 目录结构包含 Android 源代码

**鸿蒙项目特征：**
- 存在 `build-profile.json5` 文件
- 存在 `hvigorfile.ts` 或 `hvigorw` 文件
- 存在 `oh_modules` 或 `AppScope` 目录
- 存在 `entry/src/main/ets` 目录结构

### Step 3：执行编译

#### iOS 前置处理：新文件注册

当 Step 2 检测到 iOS 项目时，编译前自动执行：

```bash
python3 <acs-build-scripts>/add_files_to_xcodeproj.py <项目根目录>
```

将 git 未跟踪的新源文件（.m/.h/.swift/.mm）加入 xcodeproj 的对应 build phase，确保编译能找到所有文件。

- 无 xcodeproj / 无新文件 → 静默跳过
- 非 iOS 项目 → 静默跳过
- `pbxproj` 未安装 → 输出警告，继续编译

其中 `<acs-build-scripts>` 为本 skill 的 `scripts/` 目录路径。

#### iOS 项目编译

**Step 3.-1：启用 AntCache 编译缓存(iOS 提速，best-effort)**

iOS 编译开始前，先启用 AntCache 系统级编译缓存。AntCache 通过复用历史构建中间产物大幅减少重复编译（官方数据：iOS 构建耗时约 -68%、OC 编译约 -78%，缓存命中率 >90%），对「反复编译同一工程」的场景（如修复循环中的重编）收益尤为明显。

```bash
# 启用 AntCache（工程级一次性持久化开启，失败不阻断编译）
if anc antcache --on -w <项目根目录> -p iOS >/tmp/antcache_on.log 2>&1; then
    echo "✅ AntCache 已启用（后续 anc build 自动走缓存；首次构建仍需全量）"
else
    echo "↘️ AntCache 不可用（antcache 模块未安装或开启失败），按原流程编译"
fi
```

**关键约束：**
- **工程级一次性开启**：`anc antcache --on` 是持久化配置，开启后后续 `anc build` 自动复用缓存，无需每次带参。该命令幂等，重复执行无副作用。
- **失败必须静默降级**：部分环境未安装 `antcache` 模块，命令会以非 0 退出码（如 255，`ModuleNotFoundError`）失败。此时**只打印一行提示，继续执行后续编译步骤，绝不中止流程、绝不判定编译失败**。AntCache 与 `anc build` 是相互独立的命令，开启成败不影响编译命令本身。
- **首次构建仍是全量**（冷缓存）：提速体现在后续重编（命中热缓存）。
- 若调用方通过 args 传入 `skip_antcache=true`，则跳过本步骤（适用于已知无 antcache 的环境，避免每次打印失败日志）。

**Step 3.0：判断是否需要 anc sync**

如果调用方通过 args 传入 `skip_sync=true`，则直接跳过 sync，仅执行 `anc build`。

> 调用方 args 约定（iOS）：`skip_sync=true` 跳过 anc sync；`skip_antcache=true` 跳过 AntCache 启用探测（Step 3.-1）。两者默认均为 false（自动检测/启用）。

否则，执行检测：

```bash
python scripts/detect_project_type.py <项目根目录>
```

根据输出 JSON 的 `sync.sync_needed` 字段决定：
- `false` → 跳过 sync，执行：`cd <项目根目录> && anc build`，输出提示：`↘️ 跳过 anc sync（Pods 已存在且 Podfile 无变更）`。
- `true` → 执行 sync + build：`cd <项目根目录> && anc sync && anc build`

#### Android 项目编译

**Step 3.1：检查 JDK 版本**

执行编译前，先检查 JDK 版本：
```bash
java -version 2>&1 | head -1
```

提取版本号，判断是否为 JDK 17+。

**Step 3.2：检查 Android Gradle Plugin 版本**

查看项目根目录或模块目录下的 `build.gradle` 文件，获取 AGP 版本：
```bash
grep -r "com.android.tools.build:gradle" <项目根目录>/build.gradle <项目根目录>/*/build.gradle 2>/dev/null | head -1
```

或查看 `gradle/wrapper/gradle-wrapper.properties` 间接判断。

**Step 3.3：预配置 JDK 17 兼容参数**

如果满足以下条件：
- JDK 版本 >= 17
- Android Gradle Plugin 版本 < 7.0

则在 `gradle.properties` 文件中添加 JVM 参数（如已存在则跳过）：
```properties
org.gradle.jvmargs=--add-opens java.base/java.io=ALL-UNNAMED --add-opens java.base/java.lang=ALL-UNNAMED --add-exports jdk.compiler/com.sun.tools.javac.api=ALL-UNNAMED --add-exports jdk.compiler/com.sun.tools.javac.util=ALL-UNNAMED --add-exports jdk.compiler/com.sun.tools.javac.code=ALL-UNNAMED --add-opens jdk.compiler/com.sun.tools.javac.code=ALL-UNNAMED --add-opens jdk.compiler/com.sun.tools.javac.comp=ALL-UNNAMED
```

添加后需停止 Gradle Daemon 使配置生效：
```bash
./gradlew --stop
```

**Step 3.4：执行编译**

执行命令：
```bash
cd <项目根目录> && ./gradlew clean assembleDebug
```

**注意事项：**
- `clean` 用于清理之前的编译产物
- `assembleDebug` 用于编译 Debug 版本
- 确保 `gradlew` 有执行权限（可执行 `chmod +x gradlew`）
- 单次 Gradle 调用执行多个任务，减少进程启动开销

**重要约束：**
- **必须执行完整的 `assembleDebug` 任务，编译生成 APK**
- **禁止只编译单个模块**（如 `:module:assembleDebug`）
- **禁止跳过 clean 步骤**
- 即使只修改了某个模块的代码，也必须编译完整 APK，因为模块间可能存在依赖关系，需要验证整体集成是否正确

> ⚠️ 【严格禁令 - 不可违反】
> 无论代码修改范围多小（即使只改了 1 个文件、1 行代码），都必须执行项目根目录级别的：
> `./gradlew clean assembleDebug`
> 绝对禁止改为模块级编译（如 `:app:assembleDebug`、`:moduleXxx:assembleDebug`、`:feature:assembleDebug` 等任何带模块前缀的写法）。
> 原因：后续自动化测试流程依赖完整 APK 产物。模块级编译不生成完整 APK，会导致测试流程失败。

#### 鸿蒙项目编译

执行命令：
```bash
cd <项目根目录> && ./hvigorw clean && ./hvigorw assembleHap
```

**注意事项：**
- `clean` 用于清理之前的编译产物
- `assembleHap` 用于编译 HAP 包
- 确保 `hvigorw` 有执行权限（可执行 `chmod +x hvigorw`）

### Step 4：确认编译产物

编译完成后，必须确认产物存在：

| 平台 | 产物路径 | 确认命令 |
|------|----------|----------|
| Android | `bundle_runtime/build/outputs/apk/debug/*.apk` 或 `app/build/outputs/apk/debug/*.apk` | `find <项目根目录> -name "*.apk" -path "*/debug/*" \| head -3` |
| iOS | `build/Build/Products/Debug-iphonesimulator/*.app` | `find <项目根目录>/build -name "*.app" \| head -3` |
| 鸿蒙 | `entry/build/default/outputs/default/*.hap` | `find <项目根目录> -name "*.hap" \| head -3` |

若产物未找到，需重新执行编译或排查编译失败原因。

### Step 5：收集并反馈编译结果

收集编译命令的输出结果，包括：
- 是否编译成功
- 如果有错误，提取错误信息
- 如果有警告，汇总警告数量

**反馈格式：**
```
编译结果：<成功/失败>

详细输出：
<编译命令的完整输出>

错误汇总（如有）：
<提取的错误信息>
```

## 资源

### 编译加速：AntCache（iOS）

iOS 编译默认尝试启用 AntCache 系统级编译缓存（见「iOS 项目编译」Step 3.-1），属 best-effort 加速：
- **可用**：复用历史构建产物，构建耗时约 -68%、OC 编译约 -78%，对修复循环中的重编收益显著。
- **不可用**（antcache 模块未安装等）：自动静默降级为普通增量编译，**对编译正确性与产物无任何影响**。
- 缓存为系统级全局缓存，跨项目共享。如需清理：`anc antcache --clear`。

### scripts/

- `detect_project_type.py` - 自动检测项目是 iOS、Android 还是鸿蒙项目
- `add_files_to_xcodeproj.py` - iOS 新文件自动注册到 xcodeproj（编译前自动执行）

**使用方法：**
```bash
python scripts/detect_project_type.py <项目根目录>
```

**输出示例：**
```json
{
  "type": "ios",
  "error": null,
  "details": {
    "ios": true,
    "android": false,
    "harmony": false
  },
  "project_root": "/path/to/project"
}
```

**返回码：**
- `0`：成功识别项目类型
- `1`：未知项目类型或路径不存在
