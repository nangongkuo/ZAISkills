#!/usr/bin/env node

/**
 * render - 渲染 agent prompt（CLI 薄壳）
 *
 * 用法：
 *   node lib/render.js <repo_path> --stage N             输出 JSON（含 prompt + 替换映射）
 *   node lib/render.js <repo_path> --stage N --raw       仅输出 prompt 文本到 stdout（便于 piping）
 *
 * 注意：tick 在 dispatch-agent 分支已内置 render，主流水线无需调用本 CLI。
 *       本 CLI 仅供调试 / 独立查看 prompt 渲染结果。
 *
 * 实现：调用 junior-core.renderAgentPrompt，行为与 tick 内置渲染保持一致。
 */

const core = require('./junior-core');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { repo_path: '', stage: null, raw: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stage' && i + 1 < args.length) {
      opts.stage = parseInt(args[++i], 10);
    } else if (args[i] === '--raw') {
      opts.raw = true;
    } else if (!args[i].startsWith('-')) {
      opts.repo_path = args[i];
    }
  }
  if (!opts.repo_path || opts.stage === null) {
    process.stderr.write('Usage: node render.js <repo_path> --stage N [--raw]\n');
    process.exit(1);
  }
  return opts;
}

function main() {
  const { repo_path, stage, raw } = parseArgs();

  let result;
  try {
    result = core.renderAgentPrompt(repo_path, stage);
  } catch (e) {
    process.stderr.write(`Error: ${e.message}\n`);
    process.exit(1);
  }

  if (raw) {
    process.stdout.write(result.prompt);
    return;
  }

  console.log(JSON.stringify({
    stage: result.stage,
    stage_name: result.stage_name,
    agent_file: result.agent_file,
    agent_name: result.agent_name,
    model: result.model,
    inputs_declared: result.inputs_declared,
    inputs_resolved: result.inputs_resolved,
    missing_inputs: result.missing_inputs,
    prompt: result.prompt
  }, null, 2));
}

main();
