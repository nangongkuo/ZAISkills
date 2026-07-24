# ACS Code Review 速查卡

> 执行 CR 前必读，本文档是 `risk-checklist.md` + `cr-config.md` + `cross-platform-mapping.md` 的精简版，保留核心判断标准。

---

## 1. 严重级别

| 级别 | 定义 | 修复要求 | CR 阻断 |
|------|------|----------|---------|
| P0-Critical | 线上事故风险（数据丢失、安全漏洞、Crash） | 必须修复 | 是 |
| P1-High | 功能正确性风险（流程错误、异常、内存泄漏） | 必须修复 | 是 |
| P2-Medium | 部分场景风险（边界遗漏、性能退化） | 建议修复 | 否 |
| P3-Low | 代码质量/可维护性 | 可选 | 否 |

---

## 2. 规模阈值

| 规模 | 文件数 | 审查策略 |
|------|--------|----------|
| 小 | <5 | 快速审查 |
| 中 | 5~20 | 标准审查 |
| 大 | 21~50 | 分模块审查 |
| 超大 | >50 | 优先挑核心文件，其余抽查 |

---

## 3. 排除文件

**目录**: `build/` `.gradle/` `.idea/` `Pods/` `DerivedData/` `*.xcworkspace/` `Carthage/` `oh_modules/` `.preview/` `node_modules/` `.cache/` `vendor/` `.git/` `gradle/`

**后缀**: `.png` `.jpg` `.jpeg` `.gif` `.svg` `.ico` `.ttf` `.otf` `.woff` `.woff2`

**文件**: `R.java` `R.txt` `*.lock` `*.generated.*`

---

## 4. 风险扫描关键词速查

扫描前先查看 `collect-diff.sh` 输出的 `RISK SIGNALS`，将其作为重点关注方向。即使某类无信号，仍需完整扫描，防止遗漏隐式风险。

| 类型 | 核心关键词/文件特征 |
|------|----------------------|
| **A-不可回滚** | `Migration` `ALTER TABLE` `DROP TABLE` `addMigrations` `NSMigrationManager` `lightweightMigration` `@Table` `@Column` `relationalStore` `rdbStore` `DELETE FROM` `TRUNCATE` `.sql` `.xcdatamodeld` |
| **B-逻辑风险** | `synchronized` `@Synchronized` `Lock` `DispatchQueue` `@Lock` `mutex` `async/await` `launch` `Task` `!!` `NullPointerException` `as!` `force_unwrap` |
| **C-代码缺陷** | `as!` `asInstanceOf` `cast` `unsafeCast` `registerListener` `addObserver` `NotificationCenter.addObserver` `removeObserver` `unregister` |
| **D-性能** | `onBindViewHolder` `cellForRowAt` `aboutToAppear` `onDraw` `static List` `static Map` `static Array` `static Mutable` |
| **E-安全** | `key =` `token =` `password =` `secret =` `SharedPreferences` `UserDefaults` `AppStorage` `eval` `runJavaScript` |
| **F-兼容性** | `Build.VERSION` `@RequiresApi` `minSdkVersion` `@available` `#available` `Deployment Target` `build.gradle` `Podfile` `oh-package.json5` |
| **G-架构违规** | 无明确关键词，依赖 import 路径和模块边界判断 |

**P0/P1 判定底线**:
- 必须有代码证据（具体行/条件）
- 必须能说清楚触发条件
- 不确定的标“疑似”并说明原因

---

## 5. 跨平台归一化维度速查

**12 维度列表**: 数据模型、网络请求、状态管理、UI 组件、生命周期、开关/Feature Flag、埋点/日志、降级/兜底、缓存策略、超时/重试/并发、安全/权限、性能/加载

**完整覆盖原则**:
跨平台对比必须覆盖全部 12 个维度，防止漏掉“一端已修复、另一端未修复”的风险。

**分析策略**:
- **有代码变更的维度**: 详细分析，提取完整的归一化描述
- **无直接代码变更的维度**: 追溯两端现有实现，检查是否有一端在已有代码中已存在实现/防护，而另一端在本次变更中仍未补齐。
- 无埋点/日志文件变更 → 不写“埋点/日志”
- 无错误处理/空态/降级代码变更 → 不写“降级/兜底”
- 无缓存相关文件变更 → 不写“缓存策略”
- 无网络超时/重试代码变更 → 不写“超时/重试/并发”
- 无权限/加密/鉴权代码变更 → 不写“安全/权限”
- 无预加载/懒加载/图片策略变更 → 不写“性能/加载”

**差异评估原则**:
- 基于业务语义判断，不看代码表面
- 功能缺失要标记原因（平台限制/策略差异/遗漏）
- 实现方式不同但行为等价 → P3

---

## 6. 对话输出格式

---
**审查结论**: [可合入 / 需修复后合入 / 需对齐差异后合入]

**报告文件**:
- `path/to/report.md`

**风险/差异概要**:
[平台/模式] P0: N, P1: N, P2: N, P3: N

**关键发现（P0 / P1）**:
1. [文件:行号] <描述> → <建议>
...

无 P0/P1 时，对话中直接说“本次变更未发现 P0/P1 级别风险”。
