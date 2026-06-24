# PRD → 代码定位协议 (prd-code-locator)

> 跨越"产品语言 ↔ 技术语言"语义鸿沟的可复用检索协议。
> 主流程阶段 3 对**每个原子需求点**调用本协议。本文件可独立迭代优化。

## 输入

单个原子需求点:
```
{
  id: "R1",
  做什么: "用户点击领取后展示优惠券弹窗",
  功能场景: ["首页", "活动页"],
  技术领域关键词: ["优惠券", "领取", "弹窗"],
  UI文案: ["立即领取", "已抢光"],
  涉及字段: ["couponId", "amount"]
}
```

## 输出

定位结果对象:
```
{
  需求点: "R1",
  定位状态: 命中 | 部分命中 | 未定位,
  锚点来源: 知识索引 | UI文案 | 路由 | 术语grep,
  入口: [{文件路径, 类/方法, 已验证: true}],
  调用链: [...],          // 仅关键改动点追 1-2 跳
  约束: [...],            // 来自知识文档的 Preferred/Avoid
  置信度: 高 | 中 | 低
}
```

## 分层兜底检索策略

核心思想: **先用结构化高信号锚点"查字典",最后才退化到模糊语义搜索, 全程不编造。**
按顺序执行, 命中即可短路进入验证; 未命中下沉到下一层。

```
① 知识索引匹配 ——命中—— Preferred Entry,最高置信(查字典,不用猜)
   | 未命中
   ▼
② UI文案原样 grep ——命中—— 反查使用方, 高置信
   | (原编码: 原文案核心子串容错, 而非全等匹配)
   | 未命中
   ▼
③ 路由/页面 + 相似功能锚定 ——命中—— 模板参照, 高置信
   | 未命中
   ▼
④ 术语翻译后多词 grep ——命中—— 候选线,中置信,需读码确认
   | 未命中
   ▼
⑤ 标注[未定位] —— 交给对抗式自审和人审, 绝不编造
```

### ① 知识索引匹配（最高优先）

**索引文件真实结构** (`knowledge/knowledge-index.json`, 顶层是 dict 而非数组):
```json
{
  "platform": "iOS",
  "repoKnowledgePath": ".../knowledge/project",
  "commonKnowledgePath": ".../knowledge/common/<platform>",
  "repoKnowledge": [ {id, title, description, keywords, path, source}, ... ],
  "commonKnowledge": [ {id, title, description, keywords, path, source}, ... ]
}
```
- **`repoKnowledge`**: 本仓库专属的业务/功能知识(对应 `knowledge/project/`), 跟随仓库, **优先匹配**(最贴近需求).
- **`commonKnowledge`**: 跨仓库通用的平台规范知识(对应 `knowledge/common/<platform>/`, 如 `ios-rpc`/`ios-tracking`/`ios-logging`/`ios-antui`/`ios-coding-rules`), 匹配后用于**约束**(如埋点规范 `ios-tracking` 的 Preferred Entry).
- **`_` 开头的条目**(如 `_repo-overview`): 分离出来作**全局上下文**, 不参与 feature 匹配.

**匹配步骤**:
1. 遍历 `repoKnowledge` + `commonKnowledge` **两个数组**(跳过 id 以 `_` 开头者), 对每条判断与需求点的相关性: keywords 与技术领域关键词是否相关, title/description 与"做什么"是否匹配.
2. 命中后读取该知识文档完整内容(路径 = 对应的 `repoKnowledgePath`/`commonKnowledgePath` + `path`), 提取: **Preferred Entry**(推荐入口类), **Avoid Native Or Raw Usage**, **Import**, **Code Example**, **Constraints**.
3. Preferred Entry 即为入口锚点, 置信度=高。

**降级**: 索引不存在, 或顶层缺 `repoKnowledge`/`commonKnowledge` 字段 → 跳过本层(进入第②层)。

### ② UI 文案原样 grep（硬编码仓库命中率最高）
- 拿需求点的 `UI文案` 字段, 取**核心子串**(去掉标点/占位符, 如 "立即领取XX" → "立即领取")做全局 grep.
- 命中的位置往往就是渲染 UI 的类/方法 → 反查为入口锚点.
- 模糊容错: 文案可能动态拼接, 用最长稳定子串而非全等匹配.
- 中文文案直接 grep 中文; 若代码用英文文案+运行时翻译, 转入第 ④ 层用术语翻译后的英文线.

搜索示例:
```bash
grep -rn "立即领取" <repo_path> --include="*.swift" --include="*.m" --include="*.kt" --include="*.java" --include="*.ets"
```

### ③ 路由/页面 + 相似功能锚定
- 按 `功能场景` 找路由表 / Scheme 注册 / 页面注册表(grep "Scheme", "Route", "register", 页面名).
- PRD 若提到"和 X 功能类似", 直接定位 X 的实现作为模板参照.

### ④ 术语翻译后多词 grep（解决语义鸿沟）
- 把 `技术领域关键词`(产品词)扩展为技术词同义词矩阵, 用多词 grep:
  - 业务名词: 优惠券 → coupon / voucher / promotion / benefit
  - 动作: 领取 → fetch / receive / claim / acquire / draw
  - UI 元素: 弹窗 → dialog / popup / alert / sheet
- 命中=候选线, 置信度=中, **必须 Read 该文件确认**与需求点相关后才写入口.

### ⑤ 标注未定位
- 四层全部落空 → 定位状态=未定位, 标注 `[未定位到现有代码——可能是全新模块]`, 置信度留空.
- **绝不编造**不存在的类/文件.

## 短路与验证规则

- 需求点应产出"入口 + 调用模式 + 约束"即停止该点搜索, 不发散.
- 调用链最多追 1-2 跳(从入口到其调用的 service/数据层), 不做全量分析; 仅对关键改动点追.
- **强制验证**: 所有写入"入口"的文件路径必须 `test -f` 通过; 类/方法名必须 `grep` 能搜到, 验证不过的不写入结果.

## 降级行为

| 情况 | 行为 |
|------|------|
| 知识索引不存在 | 跳过第①层, 从第②层开始, 最终置信度上限降为"高/中" |
| UI 文案字段为空 | 跳过第②层 |
| 需求点四层全落空 | 标注未定位, 不阻塞其他需求点 |
