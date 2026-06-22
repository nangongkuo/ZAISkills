#!/usr/bin/env node

/**
 * tick - 流水线主循环驱动
 *
 * 用法: node lib/tick.js <repo_path>
 *
 * 输入: state.md 现状 + pipeline-config.md 阶段表
 * 输出: JSON，告诉调用方下一步动作
 *
 * action 取值:
 *   - "complete"             流程已完成 (status=completed)
 *   - "fail"                 流程已失败 (status=failed)
 *   - "skip-conditional"     条件未满足，应调用 advance --skip 后再 tick
 *   - "dispatch-agent"       agent 阶段待派发 (含 dispatch_text + task_indicator)
 *   - "execute-inline"       inline 阶段待执行 (调用方 Read skill_file 后内联执行)
 *   - "process-agent-result" agent 阶段已派发、刚收到 notification，应处理返回值
 *   - "needs-init"           state.md 不存在或缺 frontmatter
 */

const path = require('path');
const fs = require('fs');
const core = require('./junior-core');

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    process.stderr.write('Usage: node tick.js <repo_path>\n');
    process.exit(1);
  }
  return { repo_path: args[0] };
}

function buildResult(action, extras = {}) {
  return JSON.stringify({ action, ...extras }, null, 2);
}

function main() {
  const { repo_path } = parseArgs();

  if (!fs.existsSync(core.getStatePath(repo_path))) {
    console.log(buildResult('needs-init', {
      repo_path,
      reason: 'state.md not found',
      next_step: 'Read stages/intent-router.md and execute inline'
    }));
    return;
  }

  const fm = core.readStateFrontmatter(repo_path);
  if (!fm) {
    console.log(buildResult('needs-init', {
      repo_path,
      reason: 'state.md missing YAML frontmatter (legacy)',
      next_step: 'Prompt user to restart or exit'
    }));
    return;
  }

  // 埋点: intent (stage 0 不经 advance，在此补写；CLI 内部幂等)
  if (fm.task_type) {
    core.emitTraceIntent(fm.task_type);
  }

  const status = fm.status;
  const currentStage = fm.current_stage;

  if (status === 'completed') {
    core.emitTraceEnd('completed');
    console.log(buildResult('complete', {
      repo_path,
      current_stage: currentStage,
      next_step: 'Output completion panel and stop loop'
    }));
    return;
  }

  if (status === 'failed') {
    const failReason = fm[`stage_${currentStage}_skip_reason`] || 'pipeline marked failed';
    core.emitTraceEnd('failed', failReason);
    console.log(buildResult('fail', {
      repo_path,
      current_stage: currentStage,
      reason: failReason,
      next_step: 'Output failure reason and stop loop'
    }));
    return;
  }

  const pipeline = core.parsePipelineConfig();
  const stage = pipeline[currentStage];
  if (!stage) {
    const stageMissingReason = `unknown stage ${currentStage} in pipeline-config`;
    core.emitTraceEnd('failed', stageMissingReason);
    console.log(buildResult('fail', {
      repo_path,
      current_stage: currentStage,
      reason: stageMissingReason,
      next_step: 'Inspect pipeline-config.md'
    }));
    return;
  }

  // stage 1 按 task_type 路由 agent 文件，由 abilities/<task_type>.md 的
  // spec_enhance_agent 字段决定 (feature -> will.md, bugfix -> dave.md, ...)
  // 这是 pipeline-config.md 的唯一动态分支点，加新 ability 不需要改本文件
  if (currentStage === 1 && fm.task_type) {
    const abilities = require('./abilities');
    stage.skill_file = abilities.resolveSpecEnhanceAgent(fm.task_type);
  }

  const stageStatus = fm[`stage_${currentStage}_status`];

  // 已派发的 agent 阶段，notification 到达 -> 处理结果
  if (stageStatus === 'in_progress' && stage.execution_mode === 'agent') {
    console.log(buildResult('process-agent-result', {
      repo_path,
      current_stage: currentStage,
      stage: currentStage,
      stage_name: stage.name,
      role_label: core.getRoleLabel(currentStage, fm).role,
      action_label: core.getRoleLabel(currentStage, fm).action,
      next_step: 'Read agent return value, then call advance with outputs'
    }));
    return;
  }

  // ability 级 skip_stages (stage 0 永不跳)
  if (currentStage >= 1 && fm.task_type) {
    const abilities = require('./abilities');
    const skipStages = abilities.resolveSkipStages(fm.task_type);
    if (skipStages.includes(currentStage)) {
      const skipReason = `ability=${fm.task_type} 声明跳过本阶段`;
      console.log(buildResult('skip-conditional', {
        repo_path,
        current_stage: currentStage,
        stage: currentStage,
        stage_name: stage.name,
        skip_reason: skipReason,
        next_stage_after_skip: stage.next_stage,
        next_step: `Call advance --skip --stage ${currentStage} --skip-reason "${skipReason}", then tick again`
      }));
      return;
    }
  }

  // 条件检查
  if (stage.conditional) {
    const cond = core.evaluateCondition(currentStage, fm);
    if (!cond.met) {
      console.log(buildResult('skip-conditional', {
        repo_path,
        current_stage: currentStage,
        stage: currentStage,
        stage_name: stage.name,
        skip_reason: cond.skip_reason,
        next_stage_after_skip: stage.next_stage,
        next_step: `Call advance --skip --stage ${currentStage} --skip-reason "${cond.skip_reason}", then tick again`
      }));
      return;
    }
  }

  // inline 阶段
  if (stage.execution_mode === 'inline') {
    console.log(buildResult('execute-inline', {
      repo_path,
      current_stage: currentStage,
      stage: currentStage,
      stage_name: stage.name,
      skill_file: stage.skill_file,
      skill_file_abs: path.join(core.SKILL_BASE, stage.skill_file),
      next_step: `Read ${stage.skill_file} and execute its steps inline; call advance after`
    }));
    return;
  }

  // agent 阶段 (pending) — tick 附带写入 in_progress + 内置渲染 prompt (决策见 CONTRACTS.md)
  const agentPath = path.join(core.SKILL_BASE, stage.skill_file);
  const meta = core.getRoleLabel(currentStage, fm);
  const dispatchText = core.buildDispatchText(currentStage, fm);
  const taskIndicator = core.buildTaskIndicator(currentStage, fm);

  // 内置 render: tick 直接渲染 prompt，避免调度方再调一次 Bash
  // renderAgentPrompt 内部已 parseAgentFrontmatter, agent_name / model 直接复用其返回值
  let rendered;
  try {
    rendered = core.renderAgentPrompt(repo_path, currentStage);
  } catch (e) {
    const renderFailReason = `render agent prompt failed: ${e.message}`;
    core.emitTraceEnd('failed', renderFailReason);
    console.log(buildResult('fail', {
      repo_path,
      current_stage: currentStage,
      reason: renderFailReason,
      next_step: 'Fix agent file or state.md and rerun tick'
    }));
    return;
  }

  // 副作用: 标记 in_progress (避免 LLM 重写)
  core.markStageInProgress(repo_path, currentStage);

  // 副作用: stage 1 dispatch 前清理上次运行残留的 enhanced-spec.md,
  // 避免子 agent Write 时触发“必须先 Read”守卫导致 Write/Read 循环
  if (currentStage === 1 && fm.task_type !== 'trans') {
    const specPath = path.join(repo_path, '.acs-junior-engineer', 'enhanced-spec.md');
    if (fs.existsSync(specPath)) {
      fs.unlinkSync(specPath);
    }
  }

  // 埋点: sub-agent 阶段起始 (用 agent 名 will/dave/james/sean/tess/vera)
  core.emitTraceStage(rendered.agent_name || stage.name, 'start');

  // 看门狗: agent 阶段附带一次性定时器参数，作为 notification 之外的第二唤醒源
  // （inline 阶段不到这里）。LLM 派发后据此 CronCreate(recurring:false) + 记 task_id/job.
  const watchdogMinutes = core.getWatchdogMinutes(currentStage, fm);
  const watchdog = watchdogMinutes ? {
    minutes: watchdogMinutes,
    cron: core.buildWatchdogCron(watchdogMinutes),
    prompt: core.buildWatchdogPrompt(currentStage, repo_path, meta)
  } : null;

  console.log(buildResult('dispatch-agent', {
    repo_path,
    current_stage: currentStage,
    stage: currentStage,
    stage_name: stage.name,
    skill_file: stage.skill_file,
    skill_file_abs: agentPath,
    agent_name: rendered.agent_name || stage.name,
    model: rendered.model || null,
    role_label: meta.role,
    action_label: meta.action,
    estimated_duration: meta.estimated,
    dispatch_text: dispatchText,
    task_indicator: taskIndicator,
    prompt: rendered.prompt,
    inputs_resolved: rendered.inputs_resolved,
    missing_inputs: rendered.missing_inputs,
    state_marked_in_progress: true,
    watchdog,
    next_step: [
      `1. Print dispatch_text to user`,
      `2. TaskCreate using task_indicator`,
      `3. Call Agent tool with run_in_background=true, model=${rendered.model || 'inherit'}, prompt=<this JSON's "prompt" field>`,
      `4. Record returned agentId: acs-junior state ${repo_path} set stage_${currentStage}_task_id=<agentId>`,
      `5. Set watchdog: CronCreate(recurring=false, durable=false, cron=<watchdog.cron>, prompt=<watchdog.prompt>) → record jobId: acs-junior state ${repo_path} set stage_${currentStage}_watchdog_job=<jobId>`,
      `6. After notification: read agent return; call advance with --duration --outputs --summary; then CronDelete(stage_${currentStage}_watchdog_job)`
    ]
  }));
}

main();
