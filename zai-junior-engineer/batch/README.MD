# acs-junior-batch

批量驱动 `acs-junior-engineer`，并在每个 case 独立 worktree 中运行流水线。

这个工具的定位是“给一批仓库/需求做无人值守验证”，尤其适合：

- 多个 feature 系分文档批量编码
- 多个 bugfix 缺陷批量修复
- 长时间并行跑流水线并收集状态
- 对比不同 case 的耗时、失败阶段与失败原因

核心原则：

- 不改流水线本身
- 不修改业务仓库之外的状态文件
- 每个 case 独立 worktree，避免互相污染
- 所有汇总数据来自流水线自己落盘的产物：每个 worktree 下的 `state.md`、worker 写的 `meta.json`、以及 `session.log`

## 快速开始

1. 写一份 `cases.yaml`（最小可用示例见 `fixtures/demo-cases.yaml`）：

```yaml
run_name: demo-run
defaults:
  repo: /path/to/repo
  base_branch: master
  timeout_sec: 5400
cases:
  - id: F001
    title: 新增 banner
    ability: feature
    yuque_url: https://yuque/xxx
  - id: B001
    title: 修复白屏
    ability: bugfix
    defect_id: DIMA-1
    defect_source: dima
```

2. 运行：

```bash
acs-junior-batch run cases.yaml -c 4
```

YAML 结构固定为：顶层 `run_name`、`defaults`（扁平 kv）、`cases`（对象数组）。`cases[]` 里的字段会覆盖 `defaults`。

## 命令

### `run`

```bash
acs-junior-batch run <cases.yaml> [-c N] [-o DIR] [--force] [--cleanup] [--clean-prev] [--dry-run]
```

参数：

- `-c, --concurrency`：并发数。默认按 repo 数量并发。
- `-o, --output-dir`：输出目录，默认 `./runs`。
- `--cli CMD`：实际调用的 AI CLI，默认 `acs-cfuse`。
- `--cleanup`：结束后删除 worktree。
- `--clean-prev`：运行前清理旧 worktree。
- `--dry-run`：只构建任务与目录，不实际运行 CLI。

### `summary <run_id>`

```bash
acs-junior-batch summary <run_id> [-o DIR]
```

基于 run 目录下已有的 `cases.yaml.snapshot`、`meta.json` 与 `state.md` 重新生成 `summary.csv` 和 `summary.md`。

## 输出目录

```text
runs/
  <run_id>/
    cases.yaml.snapshot
    summary.csv
    summary.md
    cases/
      <case_id>/
        worktree-path
        session.log
        state.md
        meta.json
```

字段说明：

- `cases.yaml.snapshot`：本次 run 的 cases.yaml 原样快照，summary 命令据此重建。
- `session.log`：CLI 标准输出/错误日志。
- `state.md`：流水线状态文件快照。
- `meta.json`：worker 元信息：start/end/wall_clock_sec/exit_code/status/...
- `summary.csv`：机器可读汇总。
- `summary.md`：人可读汇总。

## 汇总字段

`summary.csv` 与 `summary.md` 包含：

- case_id / title / ability / status
- wall_clock_sec / final_stage
- compile_passed / compile_attempts
- spec_review / test_result / code_review
- commit_sha / pr_url
- exit_code / error_summary

`summary.md` 顶部还会给出“总 / completed / 其他 / 平均总耗时”概览，以及聚合 Top 5 的「失败/BLOCKED 原因」。

## 状态来源

优先取 worker/runner 写入 `meta.json` 的兜底状态；若 worker 正常退出（`meta.status` 为空），则以 `state.md` 的 `status` 为准。

常见兜底状态：

- `TIMEOUT`：case 超过 `timeout_sec`
- `CRASHED`：CLI 异常退出
- `WORKTREE_FAIL`：初始化 state 或 worktree 失败
- `NO_STATE`：没有找到 state.md
- `DRY_RUN`：dry-run 预演
















































































## 注意

- Android / iOS 的实际编译、测试、提交都仍由 `acs-junior` 流水线负责。
- batch 只负责调度、隔离、超时控制与汇总。
- 如果某个 case 卡住，优先看该 case 的 `session.log` 和 `state.md`。
