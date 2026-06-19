# APK 逆向分析（apk-reverse-skill）可用性评分报告

**评估时间**：2026-06-12 12:25
**评估结果**：✅ 通过（100分）
**评估环境**：Claude Code + GLM-5.1

---

## 一、SKILL.md 规范性评估

| 序号 | 检查项 | 结果 | 扣分 | 说明 |
|---|---|---|---:|---|
| 1 | name 字段规范性 | ✅ | 0 | `apk-reverse-skill`，符合命名规范 |
| 2 | description 长度 | ✅ | 0 | 约 80 字符，符合 500 字符上限 |
| 3 | human-name 声明 | ✅ | 0 | 已声明：`APK 逆向分析` |
| 4 | model 声明 | ✅ | 0 | 已声明：`sonnet` |
| 5 | allowed-tools 声明 | ✅ | 0 | 已声明：`[Bash, Read, Write, Edit, Agent, TaskCreate, TaskUpdate, AskUserQuestion]` |
| 6 | owner 声明 | ✅ | 0 | 已声明：`凌逸` |
| 7 | 工作流完整性 | ✅ | 0 | 业务类 Skill，有“工作流（4 命令）”+ 标准编排完整流程描述 |
| 8 | 流程步骤逻辑性 | ✅ | 0 | 4 步顺序清晰：analyze -> dynamic（可选）-> render -> publish |
| 9 | 边界条件或异常处理或终止条件 | ✅ | 0 | 三类均已说明：能力边界 T1-T4、PLAYBOOK.md 排错、动态阶段最多 1 次交互 |
| 10 | 工具使用说明 | ✅ | 0 | 4 个脚本均有完整命令/参数/行为 |
| 11 | 参数说明完整性 | ✅ | 0 | task 参数和 skip-decompile 等关键参数均已说明 |
| 12 | 文档篇幅 | ✅ | 0 | 实际行数：168 行，在 200 行以内 |
| 13 | 内容相关性 | ✅ | 0 | 无闲聊，20 行方法论支撑 |

**小计**：100 分（扣 0 分）

---

## 二、工具可用性评估

| 序号 | 工具名称 | 测试命令 | 结果 | 说明 |
|---|---|---|---|---|
| 1 | analyze.sh | `bash scripts/analyze.sh --help` | ✅ | 正常返回用法说明，列出 task/vendor 选项 |
| 2 | dynamic.sh | `bash scripts/dynamic.sh --help` | ✅ | 脚本可执行 |
| 3 | render.sh | `bash scripts/render.sh <workdir>`（现场实测） | ✅ | 实测案例成功；从代码、DeepLink/JNI 再次 render 均成功输出 270KB 报告 |
| 4 | publish.sh | `bash scripts/publish.sh --help` | ✅ | 脚本可执行 |

**小计**：100 分（扣 0 分）

---

## 三、测试完整性评估

| 序号 | 检查项 | 结果 | 扣分 | 说明 |
|---|---|---|---:|---|
| 1 | evals.json 存在性 | ✅ | 0 | `~/.claude/skills/apk-reverse-skill/evals/evals.json` 存在 |
| 2 | 测试用例数量 | ✅ | 0 | 实际数量：7 个（≥5，不扣分） |
| 3 | 测试报告存在性 | ✅ | 0 | `apk-reverse-skill-workspace/benchmark-report.md` 存在 |
| 4 | 阶段性改进 | ✅ | 0 | 报告含 V1/V2/V3 三版对比，覆盖策略/实施/效果 |
| 5 | 对比数值提升 | ✅ | 0 | 多项数值提升：T2 分析、报告完整度、用户交互次数等 |
| 6 | 用例与报告匹配度 | ✅ | 0 | 全部 7 个 eval 用例均有独立验证数据。其中 eval#3（deeplink）和 eval#5（native-jni）为本地现场实测验证 |

**小计**：100 分（扣 0 分）

### 现场实测验证详情

#### eval #3 - DeepLink（小红书 9.32.0 现场实测）

| 验证项 | 结果 |
|---|---|
| `analyze.sh --task deeplink` 执行成功 | ✅ ~2min，无加固，T1+T2 完整运行 |
| scheme/intent-filter 提取 | ✅ 133 条 DeepLink（xhsdiscover/xhssocial/http/https） |
| 路由分发类定位 | ✅ `RouterPageActivity`（q79.b 混淆类定位） |
| exported 组件攻击面 | ✅ 202 个 exported 组件（790 Activity 中） |
| `render.sh` 报告生成 | ✅ 270KB `report.md`，含 DeepLink Scheme 专章 |
| `decision-log` 记录 | ✅ 完整记录分析路径 |

#### eval #5 - Native JNI（小红书 9.32.0 现场实测）

| 验证项 | 结果 |
|---|---|
| `analyze.sh --task native-jni` 执行成功 | ✅ ~2min，无加固，T1+T2 完整运行 |
| so 文件枚举 | ✅ 148 个 so 文件（libdexvmp/libargus/libred_preload 等） |
| VMP 指标检测 | ✅ libmsaoaidsec.so 识别为 VMP 候选 |
| `runtime_mods.json` 输出 | ✅ impact=medium，含 dynamic_loader + recommendations |
| 边界声明 | ✅ 报告明确标注“不还原 VMP 化算法，只做定位” |
| `render.sh` 报告生成 | ✅ 报告含 VMP 候选、so + Native 库分类章节 |

---

## 总分

| 维度 | 得分 |
|---|---:|
| SKILL.md 规范性 | 100 |
| 工具可用性 | 100 |
| 测试完整性 | 100 |
| **最终统计** | **100 / 100** |

**最终结论**：✅ 通过，可以发起上线！
