# Risk Detection Checklist

本文件为 acs-code-review 风险扫描提供逐项检测指引。
扫描时按风险类型从 A 到 G 顺序执行，每类只报有证据的问题。

## A. 不可回滚风险 (Rollback Risk)

### 数据库 Migration

- Android: 搜索 `Migration`、`@Migration`、`ALTER TABLE`、`DROP TABLE`、`Room.databaseBuilder` 中的 `addMigrations`
- iOS: 搜索 `NSMigrationManager`、`NSMappingModel`、`lightweightMigration`、`.xcdatamodeld` 版本变更
- HarmonyOS: 搜索 `@Table`、`@Column`、`relationalStore`、`rdb` 相关变更

### 不可逆数据变更

- 搜索批量删除、UPDATE 不带 WHERE、数据格式转换
- 搜索 `DELETE FROM`、`TRUNCATE`、批量 `remove` / `delete`
- 关注迁移脚本中的数据清洗逻辑

### 协议/接口变更

- 搜索 Thrift/Proto 文件修改（字段删除、类型变更、required 变 optional）
- 搜索 API 接口签名变更
- 搜索序列化/反序列化格式变更

### 状态机单向流转

- 搜索状态枚举新增/修改
- 搜索状态转换逻辑，检查是否有回退路径

---

## B. 逻辑风险 (Logic Risk)

### 并发/竞态条件

- 搜索 `synchronized`、`@Synchronized`、`Lock`、`DispatchQueue`、`@Lock`、`mutex`
- 搜索 `async` / `await`、`Launch`、`withAsync`、`Task`、`DispatchQueue.async`
- 搜索共享可变状态（`var` 在多线程上下文中、`static` 可变属性）
- 检查回调中的状态依赖顺序

### 边界条件

- 搜索数组/列表索引操作（`[0]`、`first!`、`last!`、`get(index)`）
- 搜索分页逻辑（`offset`、`limit`、`pageSize`、`cursor`）
- 搜索数值计算（除法、取模、类型转换）
- 搜索时间比较和超时逻辑

### 空值/Optional

- Android: 搜索 `!!`（Kotlin 非空断言）、`NullPointerException`、`@NonNull`/`@Nullable` 不一致
- iOS: 搜索 `!`（强制解包）、`as!`（强制转换）、Implicitly Unwrapped Optional
- HarmonyOS: 搜索 `!` 非空断言、`as` 类型断言
- 搜索未检查返回值可能为空的函数调用

### 状态管理

- 搜索状态重置逻辑（页面退出、Fragment 销毁、ViewController deinit）
- 搜索生命周期回调中的状态同步
- 搜索多个状态变量之间的联动关系

### 异步流程

- 搜索回调嵌套（回调地狱、Promise 链断裂）
- 搜索协程/Task 泄漏（未取消的 Job、未 await 的 Task）
- 搜索异步操作的取消逻辑

---

## C. 代码缺陷 (Code Bug)

### 类型错误

- 搜索强制类型转换（`as!`、`asInstanceOf`、`cast`）
- 搜索泛型擦除后的不安全操作
- 搜索 JSON 解析中的类型假设

### Off-by-one

- 搜索 `for (int i = 0; i <=` 或 `for i in 0...count`（含上界）
- 搜索 `size() - 1`、`count - 1` 在索引访问中的使用
- 搜索分页边界（最后一页是否特殊处理）

### 条件判断

- 搜索 `||` 和 `&&` 的组合（检查运算符优先级）
- 搜索 `!` 取反逻辑（双重否定、De Morgan 定律违反）
- 搜索 `==` vs `===`、`equals` vs `==`

### 资源泄漏

- Android: 搜索 `registerListener`/`addObserver` 无对应 unregister/remove
- iOS: 搜索 `NotificationCenter.addObserver` 无对应 `removeObserver`
- 搜索 `File`/`Stream`/`Connection` 的打开但未在 finally/defer 中关闭
- 搜索 `Timer`/`ScheduledTask` 未取消

### 复制粘贴错误

- 搜索与上下文相似但变量名/常量/路径未修改的代码块
- 搜索变量名拼写错误（与声明处不一致）

---

## D. 性能风险 (Performance Risk)

### 热路径复杂度

- 搜索嵌套循环（在 `onBindViewHolder`、`cellForRowAt`、`aboutToAppear`、`onDraw` 中）
- 搜索递归调用（无终止条件或终止条件可能不触发）
- 搜索在列表渲染中的对象创建

### 内存

- 搜索 `static` 集合（可能只增不减）
- 搜索缓存无上限的实现
- Android: 搜索 `Context` 泄漏（静态持有 Activity Context）
- iOS: 搜索 `strong` 引用循环（闭包捕获 self、delegate 声明为 strong）
- HarmonyOS: 搜索 `@Local`/`@State` 大对象持有

### 主线程阻塞

- Android: 搜索主线程同步操作（`StrictMode` 违规）
- iOS: 搜索主线程同步 `DispatchQueue.main.sync`
- HarmonyOS: 搜索主线程同步操作
- 搜索大文件 I/O、网络同步请求

---

## E. 安全风险 (Security Risk)

### 敏感数据

- 搜索硬编码密钥/Token/密码（`key =`、`token =`、`password =`、`secret =`）
- 搜索明文存储到 SharedPreferences/UserDefaults/AppStorage
- 搜索日志中打印的敏感字段（手机号、身份证、银行卡号）

### 注入

- 搜索 SQL 拼接（`+ " WHERE "`、字符串插值构造 SQL）
- 搜索 WebView JS 桥接未做参数校验
- 搜索动态代码执行（`eval`、`JavaScriptCore`、`runJavascript`）

### 权限

- 搜索新增权限请求（`<uses-permission>`、`Info.plist` 权限键、`module.json5` 权限）
- 搜索 API 端点缺少鉴权检查

---

## F. 兼容性风险 (Compatibility Risk)

### API Level / OS 版本

- Android: 搜索 `Build.VERSION`、`@RequiresApi`、`minSdkVersion` 变更
- iOS: 搜索 `@available`、`if #available`、`Deployment Target` 变更
- HarmonyOS: 搜索 API 版本标注

### 依赖变更

- 搜索 `build.gradle`/`build.gradle.kts` 依赖版本变更
- 搜索 `Podfile`/`Package.swift` 依赖变更
- 搜索 `oh-package.json5` 依赖变更

### 数据格式兼容

- 搜索序列化/反序列化格式变更
- 搜索本地存储格式变更
- 搜索接口字段新增（旧版本客户端是否兼容）

### 设备适配

- 搜索屏幕尺寸相关逻辑
- 搜索新机型/折叠屏适配
- 搜索不同厂商 ROM 差异处理

---

## G. 架构违规 (Architecture Violation)

### 层级越界

- 搜索 UI 层直接调用数据层/网络层
- 搜索跨模块直接引用内部类（绕过公开接口）
- 检查 import 路径是否符合模块边界

### 绕过项目封装

- 对比 `knowledge/` 目录中的 feature 文档推荐入口
- 搜索直接使用原生 API 而非项目封装的调用
- 搜索新增的 util/helper 与已有封装功能重叠

### 职责错误放置

- 搜索业务逻辑写在 View 层
- 搜索 UI 逻辑写在 Model 层
- 搜索数据转换逻辑散落在多个层级

### 依赖方向

- 搜索底层模块 import 上层模块
- 搜索循环依赖（A import B, B import A）
