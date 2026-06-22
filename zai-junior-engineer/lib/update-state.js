#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function parseArgs() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    printUsage();
    process.exit(1);
  }

  const repoPath = args[0];
  const command = args[1];
  const rest = args.slice(2);

  return { repoPath, command, rest };
}

function printUsage() {
  process.stderr.write(
    'Usage:\n' +
    '  node update-state.js <repo_path> set key1=value1 key2=value2 ...\n' +
    '  node update-state.js <repo_path> append "markdown text"\n' +
    '  node update-state.js <repo_path> init\n' +
    '  node update-state.js <repo_path> reset     # 删除 state.md (自动备份为 state.md.bak)\n'
  );
}

function getStatePath(repoPath) {
  return path.join(repoPath, '.acs-junior-engineer', 'state.md');
}

function splitFrontmatterAndBody(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return null;
  return { frontmatter: match[1], body: match[2] };
}

function parseFrontmatterLines(frontmatter) {
  return frontmatter.split('\n');
}

function parseValue(raw) {
  if (raw === '' || raw === 'null') return { formatted: '', type: 'null' };
  if (raw === 'true') return { formatted: 'true', type: 'boolean' };
  if (raw === 'false') return { formatted: 'false', type: 'boolean' };
  if (/^-?\d+(\.\d+)?$/.test(raw)) return { formatted: raw, type: 'number' };
  if (raw.startsWith('"') && raw.endsWith('"')) return { formatted: raw, type: 'string' };
  if (raw.includes('"') || raw.includes(' ') || raw.includes(':') || raw.includes('#') || raw.includes(',')) {
    const escaped = raw.replace(/"/g, '\\"');
    return { formatted: `"${escaped}"`, type: 'string' };
  }
  return { formatted: raw, type: 'string' };
}

function formatValue(raw) {
  const { formatted } = parseValue(raw);
  return formatted;
}

function findInsertPosition(lines, key) {
  const stageMatch = key.match(/^stage_(\d+)_/);
  if (stageMatch) {
    const stageNum = stageMatch[1];
    const prefix = `stage_${stageNum}_`;
    let lastIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith(prefix)) lastIdx = i;
    }
    if (lastIdx >= 0) return lastIdx + 1;
  }
  return lines.length;
}

function commandSet(repoPath, pairs) {
  if (pairs.length === 0) {
    process.stderr.write('Error: set requires at least one key=value pair\n');
    process.exit(1);
  }

  const statePath = getStatePath(repoPath);
  if (!fs.existsSync(statePath)) {
    process.stderr.write(`Error: ${statePath} not found\n`);
    process.exit(1);
  }

  const content = fs.readFileSync(statePath, 'utf-8');
  const parts = splitFrontmatterAndBody(content);
  if (!parts) {
    process.stderr.write('Error: no YAML frontmatter found in state.md\n');
    process.exit(1);
  }

  const lines = parseFrontmatterLines(parts.frontmatter);

  for (const pair of pairs) {
    const eqIdx = pair.indexOf('=');
    if (eqIdx === -1) {
      process.stderr.write(`Error: invalid pair "${pair}", expected key=value\n`);
      process.exit(1);
    }

    const key = pair.slice(0, eqIdx).trim();
    const rawValue = pair.slice(eqIdx + 1);
    const formattedValue = formatValue(rawValue);
    const newLine = formattedValue === '' ? `${key}:` : `${key}: ${formattedValue}`;

    let found = false;
    for (let i = 0; i < lines.length; i++) {
      const colonIdx = lines[i].indexOf(':');
      if (colonIdx === -1) continue;
      const lineKey = lines[i].slice(0, colonIdx).trim();
      if (lineKey === key) {
        lines[i] = newLine;
        found = true;
        break;
      }
    }

    if (!found) {
      const insertIdx = findInsertPosition(lines, key);
      lines.splice(insertIdx, 0, newLine);
    }
  }

  const newContent = `---\n${lines.join('\n')}\n---\n${parts.body}`;
  fs.writeFileSync(statePath, newContent, 'utf-8');
}

function commandAppend(repoPath, texts) {
  if (texts.length === 0) {
    process.stderr.write('Error: append requires text argument\n');
    process.exit(1);
  }

  const statePath = getStatePath(repoPath);
  if (!fs.existsSync(statePath)) {
    process.stderr.write(`Error: ${statePath} not found\n`);
    process.exit(1);
  }

  const content = fs.readFileSync(statePath, 'utf-8');
  const text = texts.join(' ').replace(/\\n/g, '\n');
  const separator = content.endsWith('\n') ? '\n' : '\n\n';
  fs.writeFileSync(statePath, content + separator + text + '\n', 'utf-8');
}

function commandInit(repoPath) {
  const statePath = getStatePath(repoPath);
  const dir = path.dirname(statePath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let input = '';
  try {
    const fd = fs.openSync('/dev/stdin', 'r');
    const buf = Buffer.alloc(4096);
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length)) > 0) {
      input += buf.slice(0, bytesRead).toString('utf-8');
    }
    fs.closeSync(fd);
  } catch (e) {
    process.stderr.write('Error: init requires piped stdin (e.g. echo "..." | node update-state.js <path> init)\n');
    process.exit(1);
  }

  if (!input.trim()) {
    process.stderr.write('Error: no input received from stdin\n');
    process.exit(1);
  }

  fs.writeFileSync(statePath, input, 'utf-8');
}

function commandReset(repoPath) {
  const statePath = getStatePath(repoPath);
  if (!fs.existsSync(statePath)) {
    process.stdout.write(JSON.stringify({ ok: true, reset: false, reason: 'state.md not found, nothing to reset' }) + '\n');
    return;
  }
  const backupPath = statePath + '.bak';
  fs.copyFileSync(statePath, backupPath);
  fs.unlinkSync(statePath);
  process.stdout.write(JSON.stringify({ ok: true, reset: true, removed: statePath, backup: backupPath }) + '\n');
}

function main() {
  const { repoPath, command, rest } = parseArgs();

  switch (command) {
    case 'set':
      commandSet(repoPath, rest);
      break;
    case 'append':
      commandAppend(repoPath, rest);
      break;
    case 'init':
      commandInit(repoPath);
      break;
    case 'reset':
      commandReset(repoPath);
      break;
    default:
      process.stderr.write(`Error: unknown command "${command}"\n`);
      printUsage();
      process.exit(1);
  }
}

main();
