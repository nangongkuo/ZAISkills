// acs-junior-engineer/batch/cli.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { parseCasesYaml, validateCases } = require('./cases');
const { runAll, cleanPrevWorktrees } = require('./runner');
const { readObservations } = require('./state-reader');
const { toCsv, toMarkdown } = require('./summary');

const VERSION = '1.0.0';

function parseArgv(argv) {
  const out = { _: [], concurrency: 0, outputDir: './runs', force: false,
    cleanup: false, cleanPrev: false, dryRun: false, cli: 'acs-cfuse' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-c' || a === '--concurrency') out.concurrency = Number(argv[++i]);
    else if (a === '-o' || a === '--output-dir') out.outputDir = argv[++i];
    else if (a === '--cli') out.cli = argv[++i];
    else if (a === '--force') out.force = true;
    else if (a === '--cleanup') out.cleanup = true;
    else if (a === '--clean-prev') out.cleanPrev = true;
    else if (a === '--dry-run') out.dryRun = true;
    else out._.push(a);
  }
  return out;
}

function preflight() {
  for (const cmd of ['acs-junior', 'git']) {
    try {
      execFileSync('which', [cmd], { stdio: 'ignore' });
    } catch {
      throw new Error(`preflight 失败：${cmd} 不在 PATH。请先运行 bash $HOME/.codefuse/ClientSkills/acs-install.sh`);
    }
  }
}

function tsRunId() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `run-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function grepError(logPath) {
  try {
    const lines = fs.readFileSync(logPath, 'utf-8').trim().split('\n');
    const tail = lines.slice(-20);
    const hit = tail.find(l => /(BLOCKED|ERROR|FAIL)/.test(l));
    return hit ? hit.trim().slice(0, 200) : '';
  } catch {
    return '';
  }
}

function buildRows(cases, metas, runDir) {
  return cases.map(c => {
    const meta = metas.get(c.id) || {};
    const obs = readObservations(path.join(runDir, 'cases', c.id, 'state.md'));
    // worker 兜底 status（TIMEOUT/CRASHED/NO_WORKTREE/...）优先；否则用 state.md status。
    const status = meta.status || obs.status || 'NO_STATE';
    let errorSummary = meta.error || '';
    if (!errorSummary && status !== 'completed') {
      errorSummary = grepError(path.join(runDir, 'cases', c.id, 'session.log'));
    }
    return {
      case_id: c.id,
      title: c.title,
      ability: c.ability,
      status,
      wall_clock_sec: meta.wall_clock_sec,
      final_stage: obs.final_stage,
      compile_passed: obs.compile_passed,
      compile_attempts: obs.compile_attempts,
      spec_review: obs.spec_review,
      test_result: obs.test_result,
      code_review: obs.code_review,
      commit_sha: obs.commit_sha,
      pr_url: obs.pr_url,
      exit_code: meta.exit_code,
      error_summary: errorSummary,
    };
  });
}

function writeSummary(cases, metas, runDir, runId) {
  const rows = buildRows(cases, metas, runDir);
  fs.writeFileSync(path.join(runDir, 'summary.csv'), toCsv(rows));
  fs.writeFileSync(path.join(runDir, 'summary.md'), toMarkdown(rows, { run_id: runId }));
}

async function cmdRun(args) {
  const casesFile = args._[1];
  if (!casesFile) throw new Error('用法：acs-junior-batch run <cases.yaml>');
  if (!args.dryRun) preflight();
  const text = fs.readFileSync(casesFile, 'utf-8');
  const parsed = parseCasesYaml(text);
  const cases = validateCases(parsed);
  const runId = parsed.run_name || tsRunId();
  const runDir = path.join(args.outputDir, runId);
  fs.mkdirSync(runDir, { recursive: true });
  fs.copyFileSync(casesFile, path.join(runDir, 'cases.yaml.snapshot'));

  if (args.cleanPrev) cleanPrevWorktrees(args.outputDir);

  const repos = [...new Set(cases.map(c => c.repo))];
  console.log(`[any-run] run_id=${runId}, ${cases.length} cases, concurrency=${args.concurrency || repos.length}`);
  const metas = await runAll(cases, {
    ...args,
    runId,
    concurrency: args.concurrency || repos.length,
  }, (c, meta) => {
    console.log(`[case] ${c.id} status=${meta.status || 'completed'}`);
  });

  const metaMap = new Map();
  for (const m of metas) metaMap.set(m.case_id, m);
  writeSummary(cases, metaMap, runDir, runId);
  console.log(`完成，汇总：${path.join(runDir, 'summary.md')}`);
}

function cmdSummary(args) {
  const runId = args._[1];
  if (!runId) throw new Error('用法：acs-junior-batch summary <run_id>');
  const runDir = path.join(args.outputDir, runId);
  const snapshot = path.join(runDir, 'cases.yaml.snapshot');
  const parsed = parseCasesYaml(fs.readFileSync(snapshot, 'utf-8'));
  const cases = validateCases(parsed);
  const metas = new Map();
  for (const c of cases) {
    const p = path.join(runDir, 'cases', c.id, 'meta.json');
    try {
      metas.set(c.id, JSON.parse(fs.readFileSync(p, 'utf-8')));
    } catch {
      metas.set(c.id, {});
    }
  }
  writeSummary(cases, metas, runDir, runId);
  console.log(`summary 已重新生成：${path.join(runDir, 'summary.md')}`);
}

function usage() {
  return `acs-junior-batch ${VERSION}

用法：
  acs-junior-batch run <cases.yaml> [-c N] [-o DIR] [--cli CMD] [--force] [--cleanup] [--clean-prev] [--dry-run]
  acs-junior-batch summary <run_id> [-o DIR]
`;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgv(argv);
  const sub = args._[0];
  if (!sub || sub === '-h' || sub === '--help') {
    console.log(usage());
    return;
  }
  if (sub === 'run') return cmdRun(args);
  if (sub === 'summary') return cmdSummary(args);
  throw new Error(`unknown subcommand: ${sub}`);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err.stack || err.message || String(err));
    process.exit(1);
  });
}































module.exports = { parseArgv, buildRows, writeSummary, main };
