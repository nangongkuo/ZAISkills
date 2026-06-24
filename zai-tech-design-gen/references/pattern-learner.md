# 模式参照协议 (pattern-learner)

> 阶段 3 代码锚定完成后的**后置增强步骤**。
> 对每个已命中需求点，主动发现仓库中同类实现，提取实现骨架。
> 让阶段 5 的"实现思路"从泛写变成"参照 X 类的模式"。
> 本文件可独立迭代优化。

## 定位（边界）

**纯增强步骤**: 有参照→丰富阶段 5 的实现思路；无参照不影响主流程。
对仓库**只读**，只跑 `ls` / `grep` / `Read`；符合主流程 Workspace Rules.
只对**已命中**（高/中置信）需求点执行，未定位的不追。

## 输入

单个已命中需求点的定位结果（来自 `prd-code-locator.md` 输出）:
```
{
  需求点: "R1",
  定位状态: 命中 | 部分命中,
  入口: [{ 文件路径: "src/coupon/CouponClaimManager.swift", 类/方法: "CouponClaimManager.doClaim()", 已验证: true }],
  置信度: 高 | 中
}
```

## 输出

一个「模式参照」对象:
```
{
  需求点: "R1",
  有参照: true | false,
  参照来源: "同目录同类型" | "同基类/协议" | "同路由注册",
  参照类: { 文件路径, 类名, 已验证: true },
  实现骨架: {
    入口方法: ["fetchDetail()", "bindViewModel()"],
    依赖注入: ["CouponService", "TrackingService"],
    数据流: "fetchDetail() → CouponDetailModel → bind到CouponDetailView",
    错误处理: "onError回调 → 展示ErrorView"
  }
}
```

有参照=false 时, `参照来源`/`参照类`/`实现骨架` 省略。

## 发现策略

按优先级执行，**命中即短路**（取第一个命中路径的最优参照）。

### 路径 ① - 同目录兄弟（最优先）

**思路**: 同目录下同命名模式的文件大概率是同层级同职责的实现。

**步骤**:
1. 取入口文件所在目录, `ls` 列出全部文件。
2. 提取入口文件名的**后缀模式**（如 `CouponClaimManager.swift` → `*Manager.swift`; `PaymentPlugin.kt` → `*Plugin.kt`）。
3. 筛出同后缀模式的其他文件作为候选。
4. 候选 >5 个时，取与入口文件名**编辑距离最近**的 1 个（优先同业务域词根, 如 `CouponDetail` vs `CouponClaim`）。
5. 候选 ≤5 个时，取与入口文件名最相似的 1 个。
6. `test -f` 验证候选文件存在 → 命中，进入提取阶段。

**示例**:
```bash
ls src/coupon/
# CouponClaimManager.swift  CouponDetailManager.swift  CouponListManager.swift  CouponModel.swift
# 入口 = CouponClaimManager.swift → 模式 = *Manager.swift
# 候选 = CouponDetailManager.swift, CouponListManager.swift
# 取 CouponDetailManager.swift (同 Coupon 域, 功能对称)
```

**落空** → 进入路径 ②。

### 路径 ② - 同基类/同协议实现

**思路**: 继承同一基类或实现同一协议的类，通常遵循相同的实现模式。

**步骤**:
1. 读入口文件**前 30 行**, 提取类声明中的基类/协议名。
   - Swift: `class X: BaseClass, Protocol { ... }` / `struct X: Protocol { ... }`
   - Kotlin/Java: `class X : BaseClass(), Interface { ... }` / `class X extends Base implements Interface`
   - ArkTS/TS: `class X extends Base implements Interface`
2. 提取到基类/协议名后，全仓库 `grep` 同基类/协议的其他实现类:
```bash
grep -rn "class.*: BasePlugin" <repo_path> --include="*.swift" --include="*.kt" -l
```
3. 从结果中排除入口文件自身, 取第一个作为参照候选。
4. `test -f` 验证 → 命中，进入提取阶段。

**落空**（入口类无继承/协议声明，或全仓无其他同基类实现）→ 进入路径 ③。

### 路径 ③ - 同路由注册

**思路**: 路由表中相邻注册的页面通常结构相似。

**前提**: 阶段 3 第③层（路由/页面锚定）已命中，且记录了路由表文件位置。

**步骤**:
1. 读路由表文件，找到入口页面的注册行。
2. 取其上下相邻的注册项（±3 行范围内的其他页面注册）。
3. 提取相邻注册项指向的类/文件。
4. `test -f` 验证 → 命中，进入提取阶段。

**落空**（阶段 3 未通过路由层定位，或路由表中无相邻注册）→ 三条路径全落空，`有参照: false`，跳过。

## 提取规则

对命中的参照类，提取**实现骨架**（不读完整实现细节）。

**读取范围**: 参照类文件的**前 80 行**（覆盖类声明 + 属性 + 初始化 + 关键方法签名）。

**提取维度**:

| 维度 | 提取方式 | 示例 |
|------|----------|------|
| 入口方法 | 方法签名（`func`/`fun`/`def` 行） | `fetchDetail()`、`bindViewModel()` |
| 依赖注入 | 构造参数 / 属性声明中的 Service/Repository 类型 | `CouponService`、`TrackingService` |
| 数据流 | 从方法名和类型引用推断 API→Model→View 路径 | `fetchDetail() → CouponDetailModel → bind到View` |
| 错误处理 | 方法签名中的 Error/Callback 类型 / try-catch 模式 | `onError回调 → ErrorView` |

**不提取**: 方法体内的具体实现逻辑、注释、常量定义。

## 边界控制

| 约束 | 规则 |
|------|------|
| 执行条件 | 仅对已命中（高/中置信）需求点执行 |
| 每点参照数 | 最多 1 个（取最相似的） |
| 候选上限 | 同目录候选 >5 个时只取编辑距离最近的 1 个 |
| 读码量 | 参照类最多读前 80 行 |
| 验证 | 参照类文件路径必须 `test -f` 通过 |

## 降级行为

| 情况 | 行为 |
|------|------|
| 入口文件目录无同类型文件 | 尝试路径 ② |
| 入口类无继承/协议声明 | 尝试路径 ③ |
| 阶段 3 未通过路由层定位 | 路径 ③ 跳过 |
| 三条路径全落空 | `有参照: false`，跳过, 不影响主流程 |
| 参照类文件不足 80 行 | 读全文 |

## 与阶段 5 的消费方式

阶段 5 生成技术方案时:
- **有参照**: 第 3 章"实现思路"改为"参照【参照类】的实现模式：{实现骨架摘要}，本需求按相同模式..."。
- **无参照**: 保持原有泛写方式，不受影响。
