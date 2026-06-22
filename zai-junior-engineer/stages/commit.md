# Commit 阶段（inline）

代码已通过规格校验（Sean）和自动化测试（Tess），现在提交到 git。

## 前置条件

- stage_4_status = done（Sean 规格校验通过）
- stage_5_status = done 或 skipped（Tess 测试通过或跳过）
- 工作树有变更（`git status --short` 非空）

## 执行步骤

### Step 1: 确认变更存在

```bash
cd {{repo_path}}
CHANGES=$(git status --short)
[ -n "$CHANGES" ] || { echo "BLOCKED: 工作树无变更，无需提交"; exit 1; }
```

### Step 2: Stage 所有变更

```bash
cd {{repo_path}}
git add -A
```

### Step 3: 生成 commit message 并提交

基于 `stage_2_core_change` 生成约定式提交消息：

```bash
cd {{repo_path}}
git commit -m "feat: {{stage_2_core_change}}"
```

规则：
- 默认前缀 `feat:`，若 core_change 明确是修复则用 `fix:`
- 消息简洁，一行即可
- 不添加 body（详细信息在 spec/design 文档中）

### Step 4: 记录输出

```bash
COMMIT_SHA=$(git rev-parse --short HEAD)
COMMIT_MSG=$(git log -1 --pretty=format:"%s")
```

将 `COMMIT_SHA` 和 `COMMIT_MSG` 写入 state.md frontmatter。

## 输出字段

| 字段 | 写入 state.md key |
|------|--------------------|
| Commit SHA | `stage_6_commit_sha` |
| Commit Message | `stage_6_commit_message` |

## 完成前验证

- `git log -1` 显示刚创建的 commit
- 工作树干净（`git status --short` 为空）
