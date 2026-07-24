# Cross-Platform Logic Mapping Guide

本文件定义跨平台 CR 中如何将各平台代码变更归一化为可比较的业务语义描述。

核心思路：**按功能点拆分，按业务语义归一化，不按代码结构对比。**

## 映射层次

### 第一层：功能点识别

从变更文件中识别“功能点”。一个功能点 = 一个用户可感知的行为或一个独立的数据处理逻辑。

识别方法：

| 步骤 | 操作 | 说明 |
|------|------|------|
| 1 | 识别入口文件 | 页面/Activity/ViewController/Ability 是功能点的入口 |
| 2 | 追踪调用链 | 从入口追踪到 ViewModel/Interactor/Model，确定功能边界 |
| 3 | 归并关联变更 | 同一功能点的 Model/Service/RPC 变更归入同一功能点 |

**功能点命名规则**：使用业务语言，不使用技术语言。
- 正确：`直播间礼物面板`、`订单支付流程`、`用户登录`
- 错误：`GiftFragment`、`OrderViewController`、`LoginAbility`

### 第二层：逻辑归一化

对每个功能点中的核心逻辑，按以下维度提取归一化描述：

#### 2.1 数据模型归一化

| 维度 | 描述要求 |
|------|----------|
| 字段列表 | 列出所有字段，使用业务命名（不使用平台命名） |
| 字段类型 | 使用通用类型（String/Int/Float/Bool/Date/List/Map） |
| 默认值 | 记录每个字段的默认值 |
| 可选性 | 标记哪些字段是可选的，哪些是必填的 |
| 校验规则 | 记录字段校验逻辑 |

平台类型映射：

| 通用类型 | Android | iOS | HarmonyOS |
|----------|---------|-----|-----------|
| String | `String` | `String` | `string` |
| Int | `Int` / `Long` | `Int` / `Int64` | `number` |
| Float | `Float` / `Double` | `Float` / `Double` | `number` |
| Bool | `Boolean` | `Bool` | `boolean` |
| Date | `Long` (timestamp) | `Date` | `number` (timestamp) |
| List | `List<T>` | `Array<T>` | `Array<T>` |
| Map | `Map<K,V>` | `Dictionary<K,V>` | `Record<K,V>` |

#### 2.2 网络请求归一化

| 维度 | 描述要求 |
|------|----------|
| 接口路径 | RPC 方法名或 HTTP 路径 |
| 请求参数 | 使用归一化数据模型描述 |
| 响应结构 | 使用归一化数据模型描述 |
| 调用时机 | 在什么业务场景下调用 |
| 错误处理 | 网络失败/超时/业务错误的处理方式 |
| 重试策略 | 是否有重试，重试条件是什么 |

平台网络层映射：

| 通用概念 | Android | iOS | HarmonyOS |
|----------|---------|-----|-----------|
| RPC 客户端 | `Retrofit` interface | `Moya` TargetType / `RPCClient` | `http` module |
| 请求构造 | `@POST` / `@GET` 注解 | `Task.request` / 方法签名 | `httpRequest` |
| 响应解析 | `Response<T>` | `Result<T, Error>` | `Promise<T>` |
| 错误处理 | `onFailure` / try-catch | `catch` / `Result.failure` | `catch` / `onError` |

#### 2.3 状态管理归一化

| 维度 | 描述要求 |
|------|----------|
| 状态定义 | 用业务语言描述状态含义 |
| 初始值 | 状态的初始值 |
| 变更触发 | 什么操作会改变状态 |
| 派生逻辑 | 是否有派生/计算状态 |
| 持久化 | 状态是否持久化，持久化方式 |

平台状态管理映射：

| 通用概念 | Android | iOS | HarmonyOS |
|----------|---------|-----|-----------|
| 视图状态 | `ViewModel` + `StateFlow` / `LiveData` | `ObservableObject` + `@Published` | `@State` / `@Provide` |
| 全局状态 | `Singleton` / `DataStore` | `EnvironmentObject` / `Singleton` | `AppStorage` / `PersistentStorage` |
| 副作用 | `LaunchedEffect` / `viewModelScope.launch` | `.onAppear` / `.task` | `aboutToAppear` / `async` |
| 状态订阅 | `collectAsState` / `observe` | `@ObservedObject` / `@StateObject` | `@Watch` / `@Consume` |

#### 2.4 UI 组件归一化

| 维度 | 描述要求 |
|------|----------|
| 组件名称 | 业务功能名（如“礼物面板”而非“GiftBottomSheet”） |
| 展示条件 | 在什么条件下展示 |
| 数据来源 | 展示数据从哪来 |
| 用户交互 | 用户可以做什么操作 |
| 交互反馈 | 操作后的反馈行为 |

平台 UI 组件映射：

| 通用概念 | Android | iOS | HarmonyOS |
|----------|---------|-----|-----------|
| 页面 | `Activity` / `Fragment` / `Composable` | `ViewController` / `View` | `Ability` / `@Entry` `@Component` |
| 弹窗 | `Dialog` / `BottomSheetDialog` | `UIAlertController` / `.sheet` | `AlertDialog` / `CustomDialog` |
| 列表 | `LazyColumn` / `RecyclerView` | `List` / `UICollectionView` | `List` / `Grid` |
| 导航 | `NavController` / `Intent` | `NavigationStack` / `Coordinator` | `Router` / `Navigation` |
| 图片 | `Image` / `Coil` / `Glide` | `Image` / `Kingfisher` | `Image` |

#### 2.5 生命周期归一化

| 通用概念 | Android | iOS | HarmonyOS |
|----------|---------|-----|-----------|
| 创建 | `onCreate` / `init` | `viewDidLoad` / `init` | `aboutToAppear` |
| 可见 | `onStart` / `onResume` | `viewWillAppear` | `onPageShow` |
| 不可见 | `onPause` / `onStop` | `viewWillDisappear` | `onPageHide` |
| 销毁 | `onDestroy` / `onCleared` | `deinit` | `aboutToDisappear` |
| 后台 | `onPause` | `applicationDidEnterBackground` | `onBackground` |
| 前台 | `onResume` | `applicationWillEnterForeground` | `onForeground` |

#### 2.6 开关/Feature Flag 归一化

| 维度 | 描述要求 |
|------|----------|
| 开关名称 | 业务语义化的开关名 |
| 开关来源 | 本地配置 / 远程配置 / AB 实验 |
| 默认值 | 各端默认状态是否一致 |
| 生效范围 | 全局生效 / 页面级 / 用户级 |
| 灰度逻辑 | 是否有版本号/用户白名单/时间窗口等灰度条件 |

#### 2.7 埋点/日志归一化

| 维度 | 描述要求 |
|------|----------|
| 埋点事件名 | 统一的事件标识 |
| 触发时机 | 在什么业务动作后触发 |
| 参数字段 | 埋点携带的参数列表及含义 |
| 采样策略 | 是否采样、采样率 |
| 日志级别 | 普通埋点 / 关键转化 / 错误日志 |

#### 2.8 降级/兜底策略归一化

| 维度 | 描述要求 |
|------|----------|
| 触发条件 | 什么情况下进入降级/兜底态 |
| 兜底内容 | 展示什么（空态/默认数据/静态页面/旧版本） |
| 恢复逻辑 | 降级后如何恢复 |
| 用户提示 | 是否 toast/弹窗提示用户 |

#### 2.9 缓存策略归一化

| 维度 | 描述要求 |
|------|----------|
| 缓存层级 | 内存缓存 / 磁盘缓存 / 数据库 |
| 缓存key | 统一的缓存标识规则 |
| 过期策略 | TTL / LRU / 手动清理 |
| 更新触发 | 什么时候刷新缓存 |
| 一致性保证 | 多端缓存数据是否可能不一致 |

#### 2.10 超时/重试/并发策略归一化

| 维度 | 描述要求 |
|------|----------|
| 超时时间 | 连接超时、读取超时 |
| 重试次数 | 失败后的重试次数 |
| 重试间隔 | 固定间隔 / 指数退避 |
| 并发限制 | 最大并发请求数、队列策略 |
| 取消策略 | 页面退出时是否取消未完成的请求 |

#### 2.11 安全/权限归一化

| 维度 | 描述要求 |
|------|----------|
| 权限声明 | 需要哪些系统权限 |
| 权限申请时机 | 首次使用时申请 / 预申请 / 按需申请 |
| 敏感数据处理 | 加密存储 / 内存中是否明文 |
| 鉴权方式 | Token 传递方式、刷新机制 |

#### 2.12 性能/加载策略归一化

| 维度 | 描述要求 |
|------|----------|
| 预加载策略 | 是否预加载、触发条件 |
| 懒加载策略 | 分页/分段加载的触发阈值 |
| 图片/资源策略 | 压缩规则、占位图、降级策略 |
| 渲染优化 | 是否有骨架屏、延迟渲染、局部刷新 |

### 第三层：差异对比

对归一化后的功能点列表进行对比：

1. **功能点集合对比**：列出 A 平台有但 B 平台没有的功能点
2. **同功能点逐维度对比**：对两/三端都有的功能点，逐维度（数据模型、网络请求、状态管理、UI、生命周期）对比
3. **差异标记**：对每个差异标记类型和严重程度

---

## 特殊场景处理

### 场景 1：平台特有功能

- 某功能因平台限制无法实现（如 Android 特有权限、iOS 特有框架）→ 标记为“平台限制”，不作为差异报告
- 某功能因平台策略有意不实现（如鸿蒙端暂不上线某功能）→ 标记为“策略差异”，降低严重程度

### 场景 2：实现方式不同但行为等价

- 两端用不同的技术方案实现了相同的业务行为（如 Android 用 ViewModel、iOS 用 Coordinator）→ 标记为“实现差异”，P3 级别
- 只在行为确实不同时报为 P1/P2 差异

### 场景 3：一端有完整实现，另一端是桩实现

- 先判断是否为有意为之（渐进式上线、灰度策略）
- 如果不是有意为之，标记为 P1 功能缺失

### 场景 4：无法直接映射的变更

- 某端变更只涉及平台特有的基础设施（如 Android ProGuard 规则、iOS Info.plist 配置）→ 不纳入跨平台对比
- 但如果这些变更影响了功能行为（如新增权限影响功能可用性），需要纳入对比
