// acs-junior-engineer/batch/worker.js
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { buildStateMd, buildDefectContext } = require('./state-builder');

const PROMPT = [
  '你现在处于 autopilot 模式，无人值守。',
  '当前仓库已经初始化好 state.md，请：',
  '1. 调 acs-junior boot <仓库路径> 启动流水线',
  '2. 进入 resume_menu 时直接选 continue',
  '3. 全程跑到 COMPLETE 或 fail 为止，不询问任何确认',
  '4. autopilot=true，不需要用户复核',
].join('\n');

function nowIso() { return new Date().toISOString(); }

// 紧凑时间戳 YYYYMMDD-HHMMSS，用于默认分支名。
function compactStamp(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// 确保 case 有 branch_name（validateCases 不保证），缺省按 ability 约定生成。
function ensureBranchName(caseObj) {
  if (caseObj.branch_name) return caseObj;
  const stamp = compactStamp(new Date());
  const branch_name = caseObj.ability === 'bugfix'
    ? `bot/fix/${stamp}`
    : `feat/coding-pipeline-${stamp}`;
  return { ...caseObj, branch_name };
}

// 铺 stage 0 state.md（经 acs-junior state init，从 stdin 写入）。
function seedState(worktree, caseObj) {
  const md = buildStateMd(caseObj, nowIso());
  execFileSync('acs-junior', ['state', worktree, 'init'], { input: md });
  if (caseObj.ability === 'bugfix') {
    const ctxPath = path.join(worktree, '.acs-junior-engineer', 'defect_context.md');
    fs.writeFileSync(ctxPath, buildDefectContext(caseObj));
  }
}

// 单条 case（独占 worktree），返回 meta 结构，同时将每条 case 的产物写入 caseDir。
async function runCase(rawCase, worktree, caseDir, opts = {}) {
  const cli = opts.cli || 'acs-cfuse';
  const caseObj = ensureBranchName(rawCase);
  fs.mkdirSync(caseDir, { recursive: true });
  fs.writeFileSync(path.join(caseDir, 'worktree-path'), worktree + '\n');

  const start = Date.now();
  let exitCode = null;
  let status = null;
  let spawnError = null;
  let signal = null;

  try {
    seedState(worktree, caseObj);
  } catch (e) {
    status = 'WORKTREE_FAIL';
    const meta = { case_id: caseObj.id, start: nowIso(), end: nowIso(),
      wall_clock_sec: 0, exit_code: null, status, error: String(e.message || e) };
    fs.writeFileSync(path.join(caseDir, 'meta.json'), JSON.stringify(meta, null, 2));
    return meta;
  }

  const logPath = path.join(caseDir, 'session.log');
  const logFd = fs.openSync(logPath, 'w');
  try {
    const spawnArgs = ['-p', PROMPT, '--dangerously-skip-permissions', '--add-dir', worktree];
    if (caseObj.model) spawnArgs.push('--model', caseObj.model);

    const result = await new Promise(resolve => {
      const child = spawn(cli, spawnArgs, {
        cwd: worktree,
        stdio: ['ignore', logFd, logFd],
      });
      let killed = false;
      const timer = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
      }, caseObj.timeout_sec * 1000);
      child.on('close', (code, sig) => {
        clearTimeout(timer);
        resolve({ code, signal: sig, killed });
      });
      child.on('error', (err) => {
        clearTimeout(timer);
        resolve({ code: null, signal: null, killed, error: err });
      });
    });

    if (result.killed) {
      status = 'TIMEOUT';
      exitCode = 124;
    } else if (result.error) {
      status = 'CRASHED';
      exitCode = null;
      spawnError = String(result.error.message || result.error);
    } else if (result.code !== 0) {
      status = 'CRASHED';
      exitCode = result.code;
      signal = result.signal || null;
    } else {
      exitCode = 0;
      status = null;
    }
  } finally {
    fs.closeSync(logFd);
  }

  const end = Date.now();

  // 拷 state.md（无论成败都尽量保持）。
  const srcState = path.join(worktree, '.acs-junior-engineer', 'state.md');
  try {
    fs.copyFileSync(srcState, path.join(caseDir, 'state.md'));
  } catch {
    if (!status) status = 'NO_STATE';
  }

  const meta = {
    case_id: caseObj.id,
    start: new Date(start).toISOString(),
    end: new Date(end).toISOString(),
    wall_clock_sec: Math.round((end - start) / 1000),
    exit_code: exitCode,
    status,
    ...(signal ? { signal } : {}),
    ...(spawnError ? { spawn_error: spawnError } : {}),
  };
  fs.writeFileSync(path.join(caseDir, 'meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}

module.exports = { runCase, PROMPT, ensureBranchName };
