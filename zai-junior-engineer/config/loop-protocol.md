# 流水线循环协议（内部执行，禁止用户面输出）
状态机流转是静默执行，只输出派发文案和返回摘要，不宣布流转动作。
# 主循环
每轮循环的续接锚点是 tick 命令：
```bash
acs-junior tick <repo_path>
```

tick 已自动处理：状态读取、阶段路由、条件检查、`stage_N_status: pending -> in-progress` 写入。LLM 仅按返回 JSON 的 `action` 字段分流。

# action 分流表

| action | 含义 | LLM 行为 |
| --- | --- | --- |
| complete | 流程已完成 | 输出终览面板，停止循环 |
| fail | 流程失败 | 输出失败摘要，停止循环 |
| skip-conditional | 条件未满足 | 调 `advance --skip`，回到 tick |
| execute-inline | inline 阶段待执行 | Read `skill_file` 并按其内容 inline 执行；完成后调 advance，回到 tick |
| dispatch-agent | agent 阶段待派发 | 见下方派发流程 |

# 派发流程（dispatch-agent）

tick 已自动写 `stage_N_status: in-progress`，并返回派发所需全部字段（含 `watchdog`）。LLM 顺序：

1. **输出 `dispatch_text`**：直接打印 tick 返回的字符串，前后不得有任何附加文字（禁止“进入 SN 阶段”等前置/后置标记）。
2. **TaskCreate**：用 `task_indicator.subject` / `active_form` / `description` 三个字段。
3. **记录 task_id**：Agent 工具返回 `agentId` 后写入 state：

```bash
acs-junior state <repo> set stage_<N>_task_id=<agentId>
```

4. **设看门狗**（tick 返回 `watchdog` 非 null 时）：用 `watchdog.cron` / `watchdog.prompt` 调 `CronCreate(recurring=false, durable=false, cron=<watchdog.cron>, prompt=<watchdog.prompt>)`，把返回的 `jobId` 写入 state：

```bash
acs-junior state <repo> set stage_<N>_watchdog_job=<jobId>
```

5. **当前 turn 结束**，等 notification 或看门狗 fire（两个唤醒源，靠 `stage_N_status` 幂等去重）。

## 阶段完成（advance）

Inline 完成 / agent 返回 DONE 后，统一通过 advance 收尾：

```bash
acs-junior advance <repo> \
  --stage <N> \
  --duration <秒数> \
  --outputs "key=value,key=value,..." \
  --summary "## <角色显示> - <业务动作>\n\n<摘要>"
```

advance 自动：

- 写 `stage_N_status: done` + `stage_N_duration`
- 写所有 outputs 字段
- 推进 `current_stage` 到 next_stage（next_stage = COMPLETE 时改写 `status: completed`）
- append body 摘要

`<角色显示>` 与 `<业务动作>` 查 `config/user-facing-names.md` 表 A。

**收尾后取消看门狗**：agent 阶段（`stage_N_watchdog_job` 有值）advance 成功后，立即 `CronDelete(stage_N_watchdog_job)`，取消未 fire 的看门狗，避免事后误触发。

# 条件跳过（skip-conditional）

tick 返回 `action: skip-conditional`、`skip_reason` 时：

```bash
acs-junior advance <repo> --stage <N> --skip --skip-reason "<skip_reason>"
```

完成后回到 tick。

## 不变式

- 只有 `action: complete` 或 `action: fail` 才能终止循环。
- agent 模式有两个续接唤醒源：notification（正常）与看门狗 cron fire（超时兜底）。任一到达后据 `stage_N_status` 幂等处理，正常路径重新调 tick。
- 状态机字段 `stage_N_status` / `current_stage` / `status` 由 tick / advance 自动管理，禁止 LLM 用 update-state 直接改。
- 其他 frontmatter 字段（输出字段、内部 flag、计数器等）允许通过 update-state 写入。

## 看门狗超时恢复（watchdog fire）

看门狗到点 fire 时，Alex 收到自包含 prompt（不依赖 REPL 历史），静默执行（勿打扰用户，除非需升级）：

1. **探测状态**：

```bash
acs-junior watchdog-check <repo>
```

返回 `{ stage, stage_status, expired, task_id, redispatch_count, next_watchdog_cron, decision_hint }`。

2. 按 `expired` 分流：

- `expired: true`（`stage_N_status != in-progress`）：notification 路径已收尾，静默 no-op 结束。
- `expired: false` 但 `task_id` 为 null：派发后漏记 task_id，无可探测对象，直接按“真死重派/升级”处理。
- `expired: false` 且 `task_id` 有：用 `TaskOutput(task_id, block=false)` 探测真实状态。

| TaskOutput 结果 | 处理 |
| --- | --- |
| completed | 假死（任务完成但 notification 丢失），从 transcript 提取子结果，按 DONE 路径 advance，取消 watchdog，回 tick |
| running | 仍在跑，用 `next_watchdog_cron` 更新看门狗，结束 turn |
| failed | 任务找不到或真死，进入重派/升级 |

3. 真死重派/升级：

- `redispatch_count < 2`：`stage_N_redispatch_count` 自增，重新调 Agent（background）派发同一 stage，prompt 用 `acs-junior render <repo> --stage N` 渲染或复用原 prompt，记新 `stage_N_task_id`，设新看门狗，结束 turn。
- `redispatch_count >= 2`：AskUserQuestion 升级，选项为重试 / 换模型重试 / 用户接管 / 退出。

看门狗探测路径（异常路径）才会调 TaskOutput，会把完整 transcript 灌回 context（约 18K token）；正常 notification 路径避免污染。仅在 `expired: false` 时才探测。

## 预估耗时参考

| 阶段 | 执行者 | 预估时间 |
| --- | --- | --- |
| 1 | Will（Analyst）/ Dave（Detective）/ Rex（Reviewer）/ Echo（Mirror） | 3-10 分钟 |
| 3 | James（Worker） | 10-30 分钟 |
| 4 | Sean（Auditor） | 3-5 分钟 |
| 5 | Tess（QA） | 5-10 分钟 |
| 7 | Vera（Gatekeeper） | 5 分钟 |
