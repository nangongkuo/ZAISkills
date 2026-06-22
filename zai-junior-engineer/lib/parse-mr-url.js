#!/usr/bin/env node

/**
 * parse-mr-url - MR URL 解析、diff 获取与评论发布 CLI 模块
 *
 * 用法:
 *   acs-junior mr probe
 *     — 探测 SSH 连通性 + antcode CLI 认证状态
 *
 *   acs-junior mr parse <mr_url>
 *     — 解析 AntCode MR URL + 通过 antcode CLI 获取 MR 元信息
 *
 *   acs-junior mr fetch-diff <mr_url> [--workdir <path>]
 *     — 通过 SSH shallow fetch 获取 diff (不依赖 antcode token 读 diff)
 *
 *   acs-junior mr comment <mr_url> --message <text>
 *     — 通过 antcode CLI 在 MR 上发布评论
 *
 *   acs-junior mr comment <mr_url> --message <text> --path <file> --line <num>
 *     — 通过 antcode CLI 在 MR 指定文件行发布 inline 评论
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function parseArgs() {
  const args = process.argv.slice(2);
  const sub = args[0];
  const opts = { sub, url: '', workdir: '', message: '', filePath: '', line: '' };
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--workdir') opts.workdir = args[++i];
    else if (args[i] === '--message' || args[i] === '-m') opts.message = args[++i];
    else if (args[i] === '--path') opts.filePath = args[++i];
    else if (args[i] === '--line') opts.line = args[++i];
    else if (!args[i].startsWith('-')) opts.url = opts.url || args[i];
  }
  if (!sub || !['probe', 'parse', 'fetch-diff', 'comment'].includes(sub)) {
    process.stderr.write('Usage:\n');
    process.stderr.write('  parse-mr-url probe\n');
    process.stderr.write('  parse-mr-url parse <mr_url>\n');
    process.stderr.write('  parse-mr-url fetch-diff <mr_url> [--workdir <path>]\n');
    process.stderr.write('  parse-mr-url comment <mr_url> --message <text> [--path <file> --line <num>]\n');
    process.exit(1);
  }
  return opts;
}

function emit(obj) {
  console.log(JSON.stringify(obj, null, 2));
}

function run(cmd, options = {}) {
  const timeout = options.timeout || 60000;
  const cwd = options.cwd || process.cwd();
  try {
    const out = execSync(cmd, {
      encoding: 'utf-8',
      timeout,
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { ok: true, stdout: out.trim(), stderr: '' };
  } catch (e) {
    return {
      ok: false,
      stdout: (e.stdout || '').toString().trim(),
      stderr: (e.stderr || '').toString().trim() || String(e.message),
      exitCode: e.status || 1
    };
  }
}

// ---------- URL parsing ----------

function parseMrUrl(url) {
  // AntCode URL: https://code.alipay.com/<group>/<repo>/pull_requests/<id>
  const m = url.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull_requests\/(\d+)/);
  if (!m) return null;
  const host = m[1];
  const group = m[2];
  const repo = m[3];
  const prId = m[4];
  return {
    host,
    group,
    repo,
    pr_id: prId,
    project: `${group}/${repo}`,
    ssh_url: `git@${host}:${group}/${repo}.git`,
    pr_ref: `refs/pull/${prId}/merge`,
    head_ref: `refs/pull/${prId}/head`,
    iid: `#${prId}`
  };
}

// ---------- probe ----------

function cmdProbe() {
  // Check SSH
  const ssh = run('ssh -T git@code.alipay.com 2>&1', { timeout: 15000 });
  const sshOutput = ssh.stdout || '';
  const sshOk = ssh.ok || sshOutput.includes('Welcome') || sshOutput.includes('successfully authenticated');

  // Check antcode CLI auth
  const antcode = run('antcode auth status 2>&1', { timeout: 10000 });
  const antcodeOutput = antcode.stdout || '';
  const antcodeOk = antcodeOutput.includes('Logged in');

  emit({
    ssh_available: sshOk,
    antcode_authenticated: antcodeOk,
    can_read_diff: sshOk,
    can_post_comments: antcodeOk
  });
}

// ---------- parse ----------

function cmdParse(url) {
  if (!url) {
    emit({ ok: false, error: 'missing mr_url argument' });
    process.exit(1);
  }

  const parsed = parseMrUrl(url);
  if (!parsed) {
    emit({ ok: false, error: 'unrecognized MR URL format', url });
    process.exit(1);
  }

  // Get MR metadata via antcode CLI
  const showResult = run(`antcode pr show "${parsed.iid}" -p "${parsed.project}" -o json`, { timeout: 30000 });
  let meta = {};
  if (showResult.ok) {
    try { meta = JSON.parse(showResult.stdout); } catch (_) {}
  }

  // Verify ref exists via SSH
  const lsResult = run(`git ls-remote "${parsed.ssh_url}" "${parsed.pr_ref}"`, { timeout: 30000 });
  const refExists = lsResult.ok && lsResult.stdout.length > 0;

  emit({
    ok: true,
    ...parsed,
    ref_exists: refExists,
    title: meta.title || '',
    description: meta.description || '',
    state: meta.state || '',
    source_branch: meta.source_branch || '',
    target_branch: meta.target_branch || 'master',
    author: (meta.author && meta.author.name) || meta.author || ''
  });
}

// ---------- fetch-diff ----------

function cmdFetchDiff(url, workdir) {
  if (!url) {
    emit({ ok: false, error: 'missing mr_url argument' });
    process.exit(1);
  }

  const parsed = parseMrUrl(url);
  if (!parsed) {
    emit({ ok: false, error: 'unrecognized MR URL format', url });
    process.exit(1);
  }

  // Create temp workdir if not specified
  const tmpDir = workdir || fs.mkdtempSync(path.join(os.tmpdir(), 'cr-diff-'));

  // Init bare repo for minimal fetch
  const bareDir = path.join(tmpDir, `${parsed.repo}.git`);
  if (!fs.existsSync(bareDir)) {
    const initResult = run(`git init --bare "${bareDir}"`);
    if (!initResult.ok) {
      emit({ ok: false, error: 'git init failed', detail: initResult.stderr });
      process.exit(1);
    }
  }

  // Fetch the PR merge ref and base branch (shallow)
  const fetchPr = run(
    `git fetch --depth=100 "${parsed.ssh_url}" "${parsed.pr_ref}:refs/pr/merge" "+refs/heads/master:refs/heads/master" "+refs/heads/main:refs/heads/main"`,
    { cwd: bareDir, timeout: 60000 }
  );
  if (!fetchPr.ok) {
    const fetchRetry = run(
      `git fetch --depth=100 "${parsed.ssh_url}" "${parsed.pr_ref}:refs/pr/merge" "+refs/heads/master:refs/heads/master"`,
      { cwd: bareDir, timeout: 60000 }
    );
    if (!fetchRetry.ok) {
      emit({ ok: false, error: 'git fetch failed', detail: fetchRetry.stderr });
      process.exit(1);
    }
  }

  // Detect base branch
  let baseBranch = 'master';
  const checkMain = run('git rev-parse --verify refs/heads/main', { cwd: bareDir });
  const checkMaster = run('git rev-parse --verify refs/heads/master', { cwd: bareDir });
  if (checkMain.ok && !checkMaster.ok) baseBranch = 'main';

  // Get merge-base
  const mergeBase = run(`git merge-base refs/heads/${baseBranch} refs/pr/merge`, { cwd: bareDir });
  if (!mergeBase.ok) {
    emit({ ok: false, error: 'merge-base failed (history too shallow?)', detail: mergeBase.stderr });
    process.exit(1);
  }

  // Generate outputs
  const stat = run(`git diff --stat ${mergeBase.stdout}..refs/pr/merge`, { cwd: bareDir });
  const diff = run(`git diff ${mergeBase.stdout}..refs/pr/merge`, { cwd: bareDir, timeout: 30000 });
  const commits = run(`git log --oneline ${mergeBase.stdout}..refs/pr/merge`, { cwd: bareDir });
  const files = run(`git diff --name-only ${mergeBase.stdout}..refs/pr/merge`, { cwd: bareDir });

  emit({
    ok: true,
    project: parsed.project,
    pr_id: parsed.pr_id,
    ssh_url: parsed.ssh_url,
    base_branch: baseBranch,
    merge_base: mergeBase.stdout,
    bare_repo: bareDir,
    stats: stat.ok ? stat.stdout : '',
    commits: commits.ok ? commits.stdout : '',
    changed_files: files.ok ? files.stdout.split('\n').filter(Boolean) : [],
    diff: diff.ok ? diff.stdout : '',
    diff_truncated: diff.ok && diff.stdout.length > 500000
  });
}

// ---------- comment ----------

function cmdComment(url, message, filePath, line) {
  if (!url) {
    emit({ ok: false, error: 'missing mr_url argument' });
    process.exit(1);
  }
  if (!message) {
    emit({ ok: false, error: 'missing --message argument' });
    process.exit(1);
  }

  const parsed = parseMrUrl(url);
  if (!parsed) {
    emit({ ok: false, error: 'unrecognized MR URL format', url });
    process.exit(1);
  }

  // Write message to temp file to avoid shell escaping issues
  const tmpFile = path.join(os.tmpdir(), `cr-comment-${Date.now()}.md`);
  fs.writeFileSync(tmpFile, message, 'utf-8');

  let cmd;
  if (filePath && line) {
    // Inline comment on specific file:line
    cmd = `antcode review comments add "${parsed.iid}" -p "${parsed.project}" -m "$(cat '${tmpFile}')" --file "${filePath}" --line ${line}`;
  } else {
    // General review comment (no file/line = top-level comment)
    cmd = `antcode review comments add "${parsed.iid}" -p "${parsed.project}" -m "$(cat '${tmpFile}')"`;
  }

  const result = run(cmd, { timeout: 30000 });

  // Cleanup temp file
  try { fs.unlinkSync(tmpFile); } catch (_) {}

  emit({
    ok: result.ok,
    project: parsed.project,
    pr_id: parsed.pr_id,
    comment_type: (filePath && line) ? 'inline' : 'general',
    file: filePath || null,
    line: line || null,
    stdout: result.ok ? result.stdout : null,
    error: result.ok ? null : result.stderr
  });
}

// ---------- main ----------

const opts = parseArgs();
if (opts.sub === 'probe') cmdProbe();
else if (opts.sub === 'parse') cmdParse(opts.url);
else if (opts.sub === 'fetch-diff') cmdFetchDiff(opts.url, opts.workdir);
else if (opts.sub === 'comment') cmdComment(opts.url, opts.message, opts.filePath, opts.line);
