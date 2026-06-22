// acs-junior-engineer/batch/runner.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runCase } = require('./worker');

async function createPool(repo, runId, baseBranch, outputDir, opts = {}) {
  const poolDir = path.join(outputDir, runId, 'worktrees');
  fs.mkdirSync(poolDir, { recursive: true });
  const worktree = path.join(poolDir, path.basename(repo).replace(/[^\w.-]+/g, '_') + '-' + Date.now());
  if (opts.dryRun) return worktree;
  execFileSync('git', ['-C', repo, 'worktree', 'add', '-B', `batch/${runId}`, worktree, baseBranch], { stdio: 'ignore' });
  return worktree;
}

function destroyPool(repo, worktree, opts = {}) {
  if (!worktree || opts.dryRun) return;
  try {
    execFileSync('git', ['-C', repo, 'worktree', 'remove', '--force', worktree], { stdio: 'ignore' });
  } catch {
    fs.rmSync(worktree, { recursive: true, force: true });
  }
}

function resetWorktree(worktree, branchName) {
  execFileSync('git', ['-C', worktree, 'checkout', '-B', branchName], { stdio: 'ignore' });
  execFileSync('git', ['-C', worktree, 'reset', '--hard'], { stdio: 'ignore' });
  execFileSync('git', ['-C', worktree, 'clean', '-fd'], { stdio: 'ignore' });
}

function cleanPrevWorktrees(outputDir) {
  const root = path.join(outputDir, 'worktrees');
  fs.rmSync(root, { recursive: true, force: true });
}

async function createPoolForRepo(repo, repoCases, runId, outputDir, opts) {
  const baseBranch = repoCases[0].base_branch;
  const mismatched = repoCases.find(c => c.base_branch !== baseBranch);
  if (mismatched) throw new Error(`同一 repo 下 base_branch 不一致：${repo}`);
  const worktree = await createPool(repo, runId, baseBranch, outputDir, opts);
  return { repo, worktree };
}

async function runAll(cases, opts, onResult) {
  const outputDir = opts.outputDir || './runs';
  const runId = opts.runId;
  const byRepo = new Map();
  for (const c of cases) {
    if (!byRepo.has(c.repo)) byRepo.set(c.repo, []);
    byRepo.get(c.repo).push(c);
  }

  const pools = [];
  try {
    for (const [repo, repoCases] of byRepo) {
      pools.push(await createPoolForRepo(repo, repoCases, runId, outputDir, opts));
    }

    const queue = [...cases];
    const metas = [];

    async function worker() {
      while (queue.length) {
        const c = queue.shift();
        const pool = pools.find(p => p.repo === c.repo);
        const worktree = pool.worktree;
        if (!opts.dryRun) resetWorktree(worktree, c.branch_name);
        const caseDir = path.join(outputDir, runId, 'cases', c.id);
        const meta = opts.dryRun
          ? { case_id: c.id, status: 'DRY_RUN', wall_clock_sec: 0, exit_code: 0 }
          : await runCase(c, worktree, caseDir, opts);
        metas.push(meta);
        if (onResult) onResult(c, meta);
      }
    }

    const workers = Array.from({ length: Math.max(1, opts.concurrency || 1) }, () => worker());
    await Promise.all(workers);
    return metas;
  } finally {
    if (opts.cleanup) {
      for (const p of pools) destroyPool(p.repo, p.worktree, opts);
    }
  }
}




































module.exports = { runAll, createPool, destroyPool, resetWorktree, cleanPrevWorktrees };
