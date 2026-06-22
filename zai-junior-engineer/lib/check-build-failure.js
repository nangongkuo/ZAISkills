#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const MAX_ATTEMPTS = 3;

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { repo_path: '', base: '', attempts: 0 };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--base' && i + 1 < args.length) {
      options.base = args[++i];
    } else if (args[i] === '--attempts' && i + 1 < args.length) {
      options.attempts = parseInt(args[++i], 10) || 0;
    } else if (!args[i].startsWith('--')) {
      options.repo_path = args[i];
    }
  }

  return options;
}

function readStdin() {
  let input = '';
  try {
    const fd = fs.openSync('/dev/stdin', 'r');
    const buf = Buffer.alloc(65536);
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length)) > 0) {
      input += buf.slice(0, bytesRead).toString('utf-8');
    }
    fs.closeSync(fd);
  } catch (e) {
    // empty stdin acceptable; let caller handle
  }
  return input;
}

function detectPlatform(repoPath) {
  const exists = (rel) => fs.existsSync(path.join(repoPath, rel));
  if (exists('hvigorfile.ts') || exists('build-profile.json5')) return 'harmony';
  if (exists('build.gradle') || exists('build.gradle.kts') || exists('settings.gradle')) return 'android';
  if (exists('Podfile') || exists('Package.swift')) return 'ios';
  // fallback: scan top-level for .xcodeproj / .xcworkspace
  try {
    const entries = fs.readdirSync(repoPath);
    for (const e of entries) {
      if (e.endsWith('.xcodeproj') || e.endsWith('.xcworkspace')) return 'ios';
    }
  } catch (_) {}
  return 'unknown';
}

// 错误解析: 尽量给返回 [{file, line, symbol, message}, ...]
const ERROR_PATTERNS = {
  ios: [
    // Clang/Swift: /abs/path/Foo.swift:42:8: error: use of undeclared identifier 'fooBar'
    /^(?<file>[^:\n]+):(?<line>\d+):(?:\d+:)?\s*error:\s*(?<message>.+)$/i,
    // ld: linker error
    /^(?:Undefined symbols|duplicate symbol|ld:)\s*(?<message>.+)$/i,
  ],
  android: [
    // Kotlin: e: file:///abs/path/Foo.kt:42:8 Unresolved reference: fooBar
    /^e:\s*file:\/\/(?<file>[^:\n]+):(?<line>\d+):\d+\s+(?<message>.+)$/i,
    // Kotlin (alt): /abs/path/Foo.kt:42:8: error: ...
    /^(?<file>[^:\n]+\.(?:kt|java)):(?<line>\d+):(?:\d+:)?\s*error:\s*(?<message>.+)$/i,
    // Java javac: /abs/path/Foo.java:42: error: cannot find symbol
    /^(?<file>[^:\n]+\.java):(?<line>\d+):\s*error:\s*(?<message>.+)$/i,
    // Gradle dependency resolution
    /^(?:FAILURE:|>\s*Could not (?:resolve|find))\s*(?<message>.+)$/i,
  ],
  harmony: [
    // ArkTS: ERROR: ArkTS:ERROR File: /abs/path/Foo.ets:42:8 message
    /^(?:ERROR|Error):\s*(?:ArkTS:\w+\s*)?File:\s*(?<file>[^:\n]+):(?<line>\d+):\d+\s+(?<message>.+)$/i,
    // Generic: /abs/path/Foo.ets:42:8 - error: ...
    /^(?<file>[^:\n]+\.ets):(?<line>\d+):(?:\d+:)?\s*-?\s*error:?\s*(?<message>.+)$/i,
  ],
};

const D_KEYWORDS = [
  /coldstart.*turbo?\s*(?:invalid|failed)/i,
  /OutOfMemoryError/i,
  /Java heap space/i,
  /No space left on device/i,
  /gradle daemon disappeared/i,
  /could not reserve enough space/i,
  /xcrun: error: unable to find utility/i,
];

function extractSymbol(message) {
  if (!message) return null;
  // 优先抓反引号 / 单引号 / 双引号 包裹的标识符
  const m = message.match(/[`'"]([A-Za-z_]\w*)[`'"]/);
  if (m) return m[1];
  // Kotlin "Unresolved reference: fooBar"
  const m2 = message.match(/Unresolved reference:\s*([A-Za-z_]\w*)/);
  if (m2) return m2[1];
  // "cannot find symbol\n  symbol: variable fooBar"
  const m3 = message.match(/symbol:\s*\w+\s+([A-Za-z_]\w*)/);
  if (m3) return m3[1];
  return null;
}

function parseErrors(log, platform) {
  const patterns = ERROR_PATTERNS[platform] || [];
  const lines = log.split(/\r?\n/);
  const errors = [];
  const seen = new Set();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    for (const pat of patterns) {
      const m = trimmed.match(pat);
      if (m && m.groups) {
        const file = m.groups.file ? m.groups.file.trim() : null;
        const lineNum = m.groups.line ? parseInt(m.groups.line, 10) : null;
        const message = (m.groups.message || trimmed).trim();
        const symbol = extractSymbol(message);
        const key = `${file || ''}|${lineNum || ''}|${message}`;
        if (!seen.has(key)) {
          seen.add(key);
          errors.push({ file, line: lineNum, symbol, message });
        }
        break;
      }
    }
  }

  return errors;
}

function hasDClassError(log) {
  for (const re of D_KEYWORDS) {
    if (re.test(log)) return true;
  }
  return false;
}

function getChangedFiles(repoPath, base) {
  if (!base) return [];
  try {
    const out = execSync(`git diff --name-only ${base}...HEAD`, {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.split('\n').map(s => s.trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function normalizeFile(file, repoPath) {
  if (!file) return null;
  // 绝对路径 -> 转为相对 repo 的路径
  if (path.isAbsolute(file)) {
    const rel = path.relative(repoPath, file);
    return rel.startsWith('..') ? file : rel;
  }
  return file;
}

function classifyRelevance(errors, changedFiles, repoPath) {
  const changedSet = new Set(changedFiles);
  return errors.map(err => {
    const relFile = normalizeFile(err.file, repoPath);
    if (relFile && changedSet.has(relFile)) {
      return { ...err, file: relFile, related: true, reason: 'file in diff' };
    }
    if (!relFile) {
      // 无文件信息（如 linker error / gradle 顶层错误） -> unclear
      return { ...err, file: null, related: 'unclear', reason: 'no file location, needs review' };
    }
    if (err.symbol) {
      // 文件不在 diff, 但有 symbol -> 让 LLM 判（可能是新增 protocol/extension 影响到老文件）
      return { ...err, file: relFile, related: 'unclear',
        reason: 'file not in diff, symbol relation needs review' };
    }
    return { ...err, file: relFile, related: false, reason: 'unrelated to current changes' };
  });
}

function decide(classified, attemptsAfterThis, hasDError) {
  if (hasDError) {
    return { decision: 'BLOCKED_UNRELATED', reason: 'environment/toolchain error detected' };
  }
  const unclear = classified.filter(e => e.related === 'unclear').length;
  const related = classified.filter(e => e.related === true).length;
  const unrelated = classified.filter(e => e.related === false).length;

  if (related === 0 && unclear === 0 && unrelated === 0) {
    // 解析失败，无法判定
    return { decision: 'NEEDS_LLM_REVIEW', reason: 'no errors parsed, manual review' };
  }
  // unclear 优先: 只要有 unclear 项，先让 LLM 把它判成 related/unrelated 再统一决策
  // （否则 related>0 时直接 RETRY 会漏掉潜在相关的 unclear 项，下次编译仍会失败）
  if (unclear > 0) {
    return { decision: 'NEEDS_LLM_REVIEW', reason: 'unclear errors require LLM judgement' };
  }
  if (related === 0 && unrelated > 0) {
    return { decision: 'BLOCKED_UNRELATED', reason: 'all errors unrelated to current changes' };
  }
  if (attemptsAfterThis >= MAX_ATTEMPTS) {
    return { decision: 'BLOCKED_LOOP',
      reason: `reached max attempts (${MAX_ATTEMPTS}) without passing` };
  }
  return { decision: 'RETRY', reason: 'related errors found, retry after fixing' };
}

function main() {
  const opts = parseArgs();
  if (!opts.repo_path) {
    process.stderr.write(
      'Usage: cat <build_log> | node check-build-failure.js <repo_path> ' +
      '--base <base_branch> [--attempts <N>]\n');
    process.exit(1);
  }

  const log = readStdin();
  if (!log.trim()) {
    process.stderr.write('Error: empty build log from stdin\n');
    process.exit(1);
  }

  const platform = detectPlatform(opts.repo_path);
  const errors = parseErrors(log, platform);
  const changedFiles = getChangedFiles(opts.repo_path, opts.base);
  const classified = classifyRelevance(errors, changedFiles, opts.repo_path);
  const dClass = hasDClassError(log);
  const attemptsAfterThis = opts.attempts + 1;
  const { decision, reason } = decide(classified, attemptsAfterThis, dClass);

  const result = {
    platform,
    errors: classified,
    summary: {
      total: classified.length,
      related: classified.filter(e => e.related === true).length,
      unrelated: classified.filter(e => e.related === false).length,
      unclear: classified.filter(e => e.related === 'unclear').length,
      attempts_after_this: attemptsAfterThis,
      max_attempts: MAX_ATTEMPTS,
      d_class_detected: dClass,
      decision,
      decision_reason: reason,
    },
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

if (require.main === module) {
  main();
}

module.exports = { parseErrors, classifyRelevance, decide, detectPlatform };
