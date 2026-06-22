#!/usr/bin/env node

/**
 * watchdog-check - 看门狗超时探测（只读，决策交 LLM）
 *
 * 用法：node lib/watchdog-check.js <repo_path> --stage N
 *
 * 看门狗 cron fire 后，Alex 收到自包含 prompt，第一步调本命令。
 * 本命令只读 state.md，不写任何状态、不调 TaskOutput（探测由 LLM 用 task_id 自行发起）。
 *
 * 输出 JSON：
 *   - stage                本看门狗对应的阶段号
 *   - stage_status         state.md 里该阶段当前状态
 *   - expired              true 表示该阶段已不在 in_progress（notification 路径已收尾），
 *                          看门狗应静默 no-op；false 表示仍 in_progress，疑似超时需探测
 *   - task_id              该阶段 background 派发的 agentId（探测/重派用），可能为 null
 *   - redispatch_count     真死重派计数（默认 0）
 *   - next_watchdog_cron   running 续等时重设看门狗用的新 one-shot cron
 *   - decision_hint        "noop"（expired） | "probe"（仍 in_progress，按 SKILL.md 探测决策树）
 *
 * 幂等锚点 = 该阶段自己的 stage_N_status，不看 current_stage，不盲 tick。
 */

const core = require('./junior-core');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { repo_path: '', stage: null };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--stage') opts.stage = parseInt(args[++i], 10);
    else if (!a.startsWith('-')) opts.repo_path = a;
  }
  if (!opts.repo_path || opts.stage === null || Number.isNaN(opts.stage)) {
    process.stderr.write('Usage: node watchdog-check.js <repo_path> --stage N\n');
    process.exit(1);
  }
  return opts;
}

function main() {
  const opts = parseArgs();

  const fm = core.readStateFrontmatter(opts.repo_path);
  if (!fm) {
    // state.md 不可读 -> 视为已过期（无可探测对象），看门狗静默结束
    console.log(JSON.stringify({
      stage: opts.stage,
      stage_status: null,
      expired: true,
      task_id: null,
      redispatch_count: 0,
      next_watchdog_cron: null,
      decision_hint: 'noop',
      note: 'state.md not readable'
    }, null, 2));
    return;
  }

  const stageStatus = fm[`stage_${opts.stage}_status`] || null;
  // in_progress 才算「疑似超时、需探测」；其它状态说明 notification 路径已推进 -> 静默
  const expired = stageStatus !== 'in_progress';

  const taskId = fm[`stage_${opts.stage}_task_id`] || null;
  const redispatchCount = fm[`stage_${opts.stage}_redispatch_count`] || 0;

  const minutes = core.getWatchdogMinutes(opts.stage, fm);
  const nextWatchdogCron = minutes ? core.buildWatchdogCron(minutes) : null;

  console.log(JSON.stringify({
    stage: opts.stage,
    stage_status: stageStatus,
    expired,
    task_id: taskId,
    redispatch_count: redispatchCount,
    next_watchdog_cron: nextWatchdogCron,
    decision_hint: expired ? 'noop' : 'probe'
  }, null, 2));
}

main();
