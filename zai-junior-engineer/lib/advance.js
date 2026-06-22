#!/usr/bin/env node

/**
 * advance - 阶段流转（成功路径）
 *
 * 用法:
 *   node lib/advance.js <repo_path> --stage N \
 *     [--duration seconds] \
 *     [--outputs key=value,...] \
 *     [--summary "## Will - 系分增强\n\n摘要..."] \
 *     [--skip --skip-reason "..."]
 *
 * 行为（原子）:
 *  - 读 pipeline-config 拿 stage N 的 next_stage
 *  - 校验 state.md.current_stage == N（防漏防错位）
 *  - 写 stage_N_status = done | skipped
 *  - 写 stage_N_duration (done 时)
 *  - 写所有 --outputs 字段
 *  - 写 stage_N_skip_reason (skip 时)
 *  - 推进 current_stage (next_stage = COMPLETE 时改写 status=completed)
 *  - append body 摘要（若提供 --summary）
 *
 * 失败/BLOCKED 路径不在本命令范围（由后续 route/fix-loop 命令处理）。
 */

const core = require('./junior-core');
const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    repo_path: '',
    stage: null,
    duration: null,
    outputs: [],
    summary: null,
    skip: false,
    skip_reason: null
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--stage') opts.stage = parseInt(args[++i], 10);
    else if (a === '--duration') opts.duration = parseInt(args[++i], 10);
    else if (a === '--outputs') opts.outputs = args[++i].split(',').filter(Boolean);
    else if (a === '--summary') opts.summary = args[++i];
    else if (a === '--skip') opts.skip = true;
    else if (a === '--skip-reason') opts.skip_reason = args[++i];
    else if (!a.startsWith('--')) opts.repo_path = a;
  }
  if (!opts.repo_path || opts.stage === null) {
    process.stderr.write(
      'Usage: node advance.js <repo_path> --stage N [--duration S] ' +
      '[--outputs k=v,...] [--summary md] [--skip --skip-reason "..."]\n'
    );
    process.exit(1);
  }
  if (opts.skip && !opts.skip_reason) {
    process.stderr.write('Error: --skip requires --skip-reason\n');
    process.exit(1);
  }
  return opts;
}

function parseOutputPairs(outputs) {
  const pairs = [];
  for (const item of outputs) {
    const eqIdx = item.indexOf('=');
    if (eqIdx === -1) {
      process.stderr.write(`Error: invalid output "${item}", expected key=value\n`);
      process.exit(1);
    }
    pairs.push([item.slice(0, eqIdx).trim(), item.slice(eqIdx + 1)]);
  }
  return pairs;
}

function main() {
  const opts = parseArgs();

  const pipeline = core.parsePipelineConfig();
  const stageDef = pipeline[opts.stage];
  if (!stageDef) {
    process.stderr.write(`Error: stage ${opts.stage} not found in pipeline-config\n`);
    process.exit(1);
  }

  const fm = core.readStateFrontmatter(opts.repo_path);
  if (!fm) {
    process.stderr.write('Error: state.md not readable\n');
    process.exit(1);
  }
  if (fm.current_stage !== opts.stage) {
    process.stderr.write(
      `Error: state.md.current_stage=${fm.current_stage} but advance called with --stage ${opts.stage}\n`
    );
    process.exit(1);
  }

  const stagePairs = [];
  if (opts.skip) {
    stagePairs.push([`stage_${opts.stage}_status`, 'skipped']);
    stagePairs.push([`stage_${opts.stage}_skip_reason`, opts.skip_reason]);
  } else {
    stagePairs.push([`stage_${opts.stage}_status`, 'done']);
    if (opts.duration !== null) {
      stagePairs.push([`stage_${opts.stage}_duration`, opts.duration]);
    }
    for (const [k, v] of parseOutputPairs(opts.outputs)) {
      stagePairs.push([k, v]);
    }
  }

  const next = stageDef.next_stage;
  let newStatus = fm.status || 'running';
  if (next === 'COMPLETE') {
    newStatus = 'completed';
    stagePairs.push(['status', 'completed']);
    // current_stage 保留为最后一个 stage（便于断点定位）
  } else {
    stagePairs.push(['current_stage', next]);
  }

  core.rewriteFrontmatter(opts.repo_path, stagePairs);

  // 埋点: sub-agent 阶段结束。仅 agent 模式 + 非 skip 才记，与 tick.js 的 start 配对
  // agent 名从 skill_file 推导（stage 1 走 ability 路由覆盖默认 skill_file）
  if (stageDef.execution_mode === 'agent' && !opts.skip) {
    let skillFile = stageDef.skill_file;
    if (opts.stage === 1 && fm.task_type) {
      try {
        const abilities = require('./abilities');
        skillFile = abilities.resolveSpecEnhanceAgent(fm.task_type) || skillFile;
      } catch {}
    }
    const agentName = skillFile.replace(/^.*\//, '').replace(/\.md$/, '');
    core.emitTraceStage(agentName, 'end');
  }


  // 埋点: 知识命中列表（stage 2 spec-confirm 在 .acs-junior-engineer/knowledge_paths.json 落盘）
  // 时机选 stage 2 done: 此时 knowledge_paths.json 已写入，且 ability 已确定
  if (opts.stage === 2 && !opts.skip && fm.task_type) {
    try {
      const kpPath = path.join(opts.repo_path, '.acs-junior-engineer', 'knowledge_paths.json');
      if (fs.existsSync(kpPath)) {
        const kp = JSON.parse(fs.readFileSync(kpPath, 'utf8'));
        const files = [
          ...((kp.matched && kp.matched.repo_knowledge) || []),
          ...((kp.matched && kp.matched.common_knowledge) || []),
        ].map(p => path.basename(p));
        core.emitTraceBusinessJSON(fm.task_type, 'knowledge', files);
      }
    } catch {
      // 埋点失败不阻塞主链路
    }
  }

  if (opts.summary) {
    const md = opts.summary.replace(/\\n/g, '\n');
    core.appendBody(opts.repo_path, md);
  }

  console.log(JSON.stringify({
    ok: true,
    stage_completed: opts.stage,
    stage_status: opts.skip ? 'skipped' : 'done',
    next_stage: next,
    current_status: newStatus
  }, null, 2));
}

main();
