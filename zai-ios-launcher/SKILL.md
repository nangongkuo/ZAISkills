---
name: acs-ios-launch
human-name: "iOS 真机启动"
description: iOS 真机启动 Skill。在 HomeCard 等 iOS 工程编译完成后，自动完成 workspace 探测、真机签名准备、安装、启动、可选 LLDB 接管与 console 日志收集。触发条件：用户提到真机预览、device launch、跑到手机上、acs-ios-launch、把卡片装到手机上看一下等关键词时激活。
model: "opus"
allowed-tools: Bash, Read
owner: "育麟"
---

# iOS 真机启动

## 概述

此 Skill 用于把一个本地已经能编译的 iOS 工程跑到真机上：探测 workspace/scheme → 准备签名 → build → install → launch → 收集 console 日志，可选挂 LLDB。

设计目标是被上游 agent（例如 `home-dev-bot` 的 Native 模板转码流程）在编译验证通过后调用一次，把卡片/页面跑到手机上让用户肉眼验收，所以**默认无人值守，参数全部从调用方传入**。

## 触发条件

激活此 Skill 的典型场景：
- 用户说「跑到手机上看一下」「真机预览」「device launch」「装到手机上」
- 用户显式说「acs-ios-launch」
- 上游 agent 编排：编译通过后需要真机验证

## 命令前置检测

为保证脚本在任何执行环境（CI、远程、PATH 未加载等）都能找到工具，**必须**在执行前检测以下命令：

- `xcrun`: 用 `which xcrun`
- `xcodebuild`: 先试 `xcrun -f xcodebuild` 或 `which xcodebuild`
- `security`: 用 `which security`
- `anc`（如果走 sync）：优先 `which anc`, fallback `~/ant/anc/bin/anc`

scripts 内部已经做了一部分，但调用前先确认。

## 参数（由上游 agent 传入或交互询问）

| 参数 | 说明 | 默认 |
|------|------|------|
| `project_root` | iOS 工程根目录绝对路径（必填） | - |
| `workspace` | 显式指定 `*.xcworkspace` 路径 | 由 discover 决定 |
| `xcodeproj` | 显式指定 `*.xcodeproj`（无 workspace 时） | 由 discover 决定 |
| `scheme` | 编译 scheme 名 | HomeCard 类工程默认 `Portal` |
| `bundle_id` | 真机 Bundle Identifier | 不能判断不改 |
| `dev_team` | Apple Development Team ID | 不能判断，`auto_dev_team` |
| `auto_dev_team` | 自动从本地证书/Profile 推 Team | `true` |
| `device` | 真机 UDID 或 name | 单设备时自动选；多设备必填 |
| `debug_mode` | `no_lldb` / `attach_after` / `wait_attach` | `no_lldb` |
| `skip_sync` | 跳过 AntCLI baseline sync | `true`（默认相信上游已经 sync 过） |
| `build_only` | 只 build 不 install/launch | `false` |
| `yes` | 非交互确认（已由上游确认过） | `true`（被 agent 调用时） |

## 工作流程

### Step 0: 必备前置检查

1. 获取 `project_root` 下的 `README.md`，看是否有项目特定的编译/启动约定（例如 `make build-and-run`）。如果有，先按 README 的指引走；如果 README 只是简单的 `make` 包装、到此为止，按本 skill 的标准流程。
2. `git status --short --branch`: 尽量保留用户未提交的改动，记录脏文件清单，方便结束后回滚判断。
3. **设备**: 探测连接的真机:
```bash
xcrun devicectl list devices
```
- 无设备 → **立即 fail-fast**，输出「未检测到连接的 iOS 真机，请连接设备并解锁后重试」，不要尝试模拟器兜底。
- 多设备且未传 `device` → 列出所有设备让用户选；如果运行在无人值守模式（`yes=true`）且未指定 `device`，报错退出。

### Step 1: 工程探测

调用 discover 脚本:

```bash
.claude/skills/acs-ios-launch/scripts/discover-ios-project.sh --project <project_root>
```

规则:
1. 递归找 `*.xcworkspace` 和 `*.xcodeproj`
2. 忽略 `*.xcodeproj/project.xcworkspace`
3. 有 workspace 优先用 workspace
4. 多个候选 → 列出让用户选；调用方传了 `workspace` 或 `xcodeproj` 直接用
5. 选定容器后用 `xcodebuild -list` 列 scheme

### Step 2: Portal workspace 跳转检查（HomeCard 场景关键）

如果是 Portal/AntCLI 类工程:
1. 必须存在顶层 `*.xcworkspace`（不在 `*.xcodeproj/project.xcworkspace` 路径下）
2. 该 workspace 的 `xcodebuild -list` 必须能列出 `Portal` scheme

**任一条件不满足时**:
- 若 `skip_sync=false`, 调 `scripts/sync-baseline.sh` 跑 AntCLI baseline sync, sync 完重做 Step 1
- 若 `skip_sync=true`（默认，agent 编排时），**直接 fail-fast**，输出「workspace 或 Portal scheme 缺失，且 skip_sync=true 不允许自动同步。请先在工程目录下手工 `anc sync` 或允许 skip_sync=false 后重试」

> ⚠️ **不要回退到 component `*.xcodeproj`** 作为 Portal 工程的 run 容器。Portal 工程必须用 workspace + Portal scheme。

### Step 3: AntCLI Baseline Sync（默认跳过）

**默认 `skip_sync=true`, 跳过此步**。调用方传 `skip_sync=false` 或 Step 2 显式触发时才执行。

```bash
.claude/skills/acs-ios-launch/scripts/sync-baseline.sh --project <project_root>
```

sync-baseline.sh 行为:
1. 从当前 git 分支名解析 Huoban iteration ID（形如 `cp_xxx_数字`）
2. 分支没有 ID 时 prompt 用户输入 `iteration`
3. 跑 `anc clean -f && anc sync <iterationId>`

> ⚠️ **转码场景注意**: 从 `bot/transcode/<name>` 这类分支过来时，分支名没有 iteration ID，sync-baseline.sh 会卡住等输入。所以在转码流程里 `skip_sync` **必须**保持 true。

### Step 4: 真机签名 / 配置准备

```bash
.claude/skills/acs-ios-launch/scripts/prepare-device-run.py \
  --project <project_root> \
  [--xcodeproj <pbxproj_dir> | --pbxproj <pbxproj_file>] \
  [--bundle-id <bundle_id>] \
  [--dev-team <TEAM_ID> | --auto-dev-team] \
  [--yes]
```

注意:
1. 只在「app 所在 project 没有 Development Team」或「需要换 Bundle ID」时才需要动。
2. 自动选 Dev Team 的优先级:
   - `security find-identity -v -p codesigning` 输出的证书 OU 字段
   - `~/Library/MobileDevice/Provisioning Profiles/` 和 `~/Library/Developer/Xcode/UserData/Provisioning Profiles/` 里的 `TeamIdentifier`
   - **不是**用证书 Common Name 括号里的后缀当 Team ID
3. 对 Portal 工程，如果 `xcodebuild -showBuildSettings` 没有 `CODE_SIGN_IDENTITY`，则脚本补 `CODE_SIGN_IDENTITY = "Apple Development"`，保持 `CODE_SIGN_STYLE = Automatic`，**不要**强写 `PROVISIONING_PROFILE_SPECIFIER`（会污染 framework 目标）。
4. 优先动 local-only 文件（user defaults），避免改共享的 shared scheme/profile。

### Step 5: build + install + launch + log

主入口:

```bash
.claude/skills/acs-ios-launch/scripts/run-ios-device.sh \
  --project <project_root> \
  --workspace <workspace_path> \
  --scheme <scheme> \
  --device <device-id> \
  --bundle-id <bundle_id> \
  [--dev-team <TEAM_ID> | --auto-dev-team] \
  [--code-sign-identity "Apple Development"] \
  [--build-only] \
  [--yes]
```

脚本内部依次:
1. 打印最终参数（workspace/scheme/device/bundle/dev-team/...），**`--yes` 模式下跳过等用户确认**；否则等用户确认。
2. `xcodebuild <container_args> -scheme <scheme> -configuration Debug -destination "id=<device>" build`; DerivedData 默认路径，**不要**自定义 `-derivedDataPath`.
3. 在 DerivedData 里定位与 project 同前缀的最新 `.app` 产物。
4. **安装前签名校验**: 必须存在 `embedded.mobileprovision`, `CFBundleIdentifier` 匹配请求的 bundle id, `codesign --verify --deep --strict` 通过, profile application-identifier 与 bundle id 一致。任一不过 → 停在 install 前，报错。
5. `xcrun devicectl device install app --device <device-id> <app>`
6. `xcrun devicectl device process launch --console --device <device-id> --bundle-id <bundle_id>`; stdout/stderr 同步写 DerivedData `logs/Console/agent-<timestamp>-<process>-<bundle-id>.log`。
   - **不要添加 `--timeout`**（除非用户明确要时间窗采样）
7. 从 launch JSON 拿 `result.process.processIdentifier`，写到 `logs/Console/agent-current-run.status`，并在对话上下文中记下「当前 app PID」。
8. 启动成功后用 `scripts/filter-runtime-log.sh` 扫一遍 console 日志，挑关键 fail/crash/timeline 行汇报。

`--build-only` 模式只到 Step 5.2，跳过 install/launch/log。

### Step 6: (可选) LLDB 接管

调用方传 `debug_mode != no_lldb` 时执行:

- `attach_after`: launch 后用 PID 接管
```bash
.claude/skills/acs-ios-launch/scripts/attach-lldb.sh \
  --project <project_root> --device <device-id> --pid <pid>
```
- `wait_attach`: 先 `--wait --include-existing` 起 LLDB，再 launch app（用于断 startup）
```bash
.claude/skills/acs-ios-launch/scripts/attach-lldb.sh \
  --project <project_root> --device <device-id> --process <process_name> \
  --wait --include-existing --bundle-id <bundle_id>
```

LLDB 命令文件按需写在 DerivedData `logs/Debug/`。

### Step 7: 收尾 / 反馈

输出:
- 是否成功跑到端上
- workspace、scheme、device、bundle_id、dev_team
- `.app` 路径、console log 路径、PID、terminate 命令
- 关键 log tail（最后 30 行 + 任意 fail/crash 行）

如果失败，给出失败 step（discover / sync / signing / build / install / launch / log）和原始错误片段。

## 终止设备进程

用户要 stop / kill / 重启 app 时:

1. 优先用对话上下文里记的当前 app PID；其次读 `logs/Console/agent-current-run.status`; 再次 `xcrun devicectl device info processes`.
2. **必须用 CoreDevice 终止**，不要用 host `kill`:
```bash
xcrun devicectl device process terminate --device <device-id> --pid <pid> --kill
```
3. host `kill <pid>` **只能**杀本机的 console 收集器，**不会**杀手机上的 app。明确告诉用户区别。
4. 终止后 `xcrun devicectl device info processes` 验证，或观察下一次 launch 是不是新 PID。

## 关键约束（与 ios-project-agent 2 原版不同处）

| 项 | 原版 | 本 skill |
|----|------|---------|
| 强制人工确认每次 build | 是 | 调用方传 `yes=true` 时跳过 |
| sync-baseline 默认 | 按 README 决定 | 默认 `skip_sync=true`, 避免转码分支无 iteration ID 卡住 |
| 无设备 fallback 模拟器 | 不允许 | 同样不允许: 明确 fail-fast |
| 路径前缀 | `~/.codex/skills/ios-project-agent/scripts/` | `.claude/skills/acs-ios-launch/scripts/` |

## 资源

### scripts/

| 脚本 | 用途 |
|------|------|
| `discover-ios-project.sh` | 探测 workspace/xcodeproj + 列 scheme |
| `sync-baseline.sh` | AntCLI baseline sync（需要 iteration ID） |
| `prepare-device-run.py` | 签名 / Team ID / Bundle ID 准备 |
| `run-ios-device.sh` | build + install + launch + log 主流程 |
| `attach-lldb.sh` | 生成 LLDB 命令文件并启动 |
| `filter-runtime-log.sh` | runtime console log 过滤汇总 |

所有脚本均接受 `--project <root>` 作为入口参数，与当前工作目录无关。
