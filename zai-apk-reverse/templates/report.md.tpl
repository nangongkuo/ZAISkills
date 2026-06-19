# {{TITLE}}

> 由 `apk-reverse-v3` 自动生成 · 工作目录 `{{WORKDIR}}` · 生成时间 {{TIMESTAMP}}

## 🧠 TL;DR

{{TLDR}}

---

## 1. APK 画像（T1）

### 基础信息

| 字段 | 值 |
|---|---|
| 包名 | `{{PACKAGE}}` |
| 版本 | `{{VERSION_NAME}}`（versionCode `{{VERSION_CODE}}`） |
| SDK 范围 | min `{{MIN_SDK}}` / target `{{TARGET_SDK}}` / compile `{{COMPILE_SDK}}` |
| APK 大小 | `{{APK_SIZE_HUMAN}}` |
| SHA256 | `{{SHA256}}` |
| DEX 数 | `{{DEX_COUNT}}` |
| Application 类 | `{{APP_CLASS}}` |
| 入口 Activity | `{{LAUNCH_ACT}}` |
| 加固 | `{{PACKER}}` |

### 签名

| 项 | 值 |
|---|---|
| v1 / v2 / v3 / v4 | `{{SIGN_VERSIONS}}` |
| 证书主体 | `{{SIGN_SUBJECT}}` |
| SHA-256 | `{{SIGN_SHA256}}` |
| Debug 签名？ | `{{SIGN_IS_DEBUG}}` |

### 安全态势

| 项 | 值 | 影响 |
|---|---|---|
| allowBackup | `{{ALLOW_BACKUP}}` | `{{ALLOW_BACKUP_HINT}}` |
| usesCleartextTraffic | `{{CLEARTEXT}}` | `{{CLEARTEXT_HINT}}` |
| debuggable | `{{DEBUGGABLE}}` | `{{DEBUGGABLE_HINT}}` |
| Network Security Config | `{{NSC}}` | - |

### 权限（前 15 + 全部 dangerous）

{{PERMISSIONS_TABLE}}

### 组件统计

| 类型 | 总数 | 其中 exported |
|---|---:|---:|
| Activity | `{{ACT_TOTAL}}` | `{{ACT_EXPORTED}}` |
| Service | `{{SVC_TOTAL}}` | `{{SVC_EXPORTED}}` |
| Provider | `{{PRV_TOTAL}}` | `{{PRV_EXPORTED}}` |
| Receiver | `{{RCV_TOTAL}}` | `{{RCV_EXPORTED}}` |

### Exported 攻击面（前 10）

{{EXPORTED_LIST}}

### DeepLink Scheme（去重前 20）

{{DEEPLINKS_TABLE}}

### Native 库（按 ABI 分组）

{{LIBS_SUMMARY}}

### SDK 画像（粗筛）

{{SDK_HINTS_LIST}}

### Assets / 资源

- assets 数：`{{ASSETS_COUNT}}`（前 20 个：`{{ASSETS_SAMPLE}}`）

### 运行时框架修改（不是加固）

{{RUNTIME_MODS_TABLE}}

**对静态分析的影响等级**：**{{RUNTIME_IMPACT}}**

{{RUNTIME_RECOMMENDATIONS}}

---

## 2. 静态分析（T2）

> 由 `analyze.sh` 跑 jadx + static-grep 产出，证据标 📖。

### 反编译概要

- 索引类数：`{{TOTAL_CLASSES}}`（`{{DEX_COUNT}}` 个 dex）
- 反编译 Java 文件：`{{JAVA_COUNT}}`
- task 关键字筛选：`{{TASK}}`

### 静态 grep 命中

{{STATIC_FINDINGS_TABLE}}

### 任务特化分析

{{TASK_TEMPLATE_BODY}}

---

## 3. 动态分析（T3）

> 由 `dynamic.sh` 的多轮 Frida hook 产出，证据标 🧪。

{{DYNAMIC_ROUNDS}}

---

## 4. 关键发现

> 由分析师跨 §1/§2/§3 综合归纳。每条带证据引用、严重性。

{{KEY_FINDINGS}}

---

## 5. 复现与建议

### 5.1 复现命令

```bash
# 完整链路（v3 skill）
bash {{SKILL_DIR}}/scripts/analyze.sh {{APK_PATH}} --task {{TASK}}
bash {{SKILL_DIR}}/scripts/dynamic.sh {{WORKDIR}} round-1
bash {{SKILL_DIR}}/scripts/render.sh {{WORKDIR}}
```

### 5.2 关键 frida 启动命令

```bash
python3 {{SKILL_DIR}}/scripts/lib/run_frida.py --spawn {{PACKAGE}} \
  {{SKILL_DIR}}/scripts/frida/lib/_common.js \
  {{SKILL_DIR}}/scripts/frida/00_bootstrap.js \
  {{FRIDA_TASK_SCRIPTS}} \
  --duration 60 --out trace.log
```

### 5.3 建议（对防御方）

{{DEFENSE_SUGGESTIONS}}

---

## 6. 附录

<details>
<summary>📝 决策日志（多轮迭代推理过程）</summary>

{{DECISION_LOG}}

</details>

<details>
<summary>📷 截图证据</summary>

{{SCREENSHOTS}}

</details>

<details>
<summary>📄 原始 frida 日志摘要（前 100 行 * 每轮）</summary>

{{RAW_LOG_PREVIEWS}}

</details>

<details>
<summary>完整 meta.json</summary>

```json
{{META_JSON_PRETTY}}
```

</details>

<details>
<summary>完整 runtime_mods.json</summary>

```json
{{RUNTIME_MODS_JSON_PRETTY}}
```

</details>

---

*报告由 [apk-reverse-v3](https://github.com/) 自动生成，证据标注：📖 jadx 静态 · 🧪 frida 动态 · ⚠️ 推测*
